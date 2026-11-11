import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoPlusClient,
  goplusEnabled,
  parseAddressSecurity,
  parseApprovalSecurity,
  parseEvmTokenSecurity,
  parsePhishingSite,
  parseSolanaTokenSecurity,
  RateLimiter,
  unwrapGoPlus,
  worstRisk,
} from './security/goplus';
import { tokenRiskLabel } from './security/scam-warnings';

test('EVM token: trust-listed tokens are never flagged (USDT has owner/blacklist powers)', () => {
  const usdt = { trust_list: '1', is_blacklisted: '1', owner_change_balance: '1', is_honeypot: '0', sell_tax: '0' };
  assert.deepEqual(parseEvmTokenSecurity(usdt), { level: 'trusted', reasons: [] });
  assert.equal(tokenRiskLabel(parseEvmTokenSecurity(usdt)), null);
});

test('EVM token: honeypot / airdrop scam / fake / tax rules', () => {
  const honeypot = parseEvmTokenSecurity({ is_honeypot: '1', sell_tax: '1', is_open_source: '0' });
  assert.equal(honeypot?.level, 'danger');
  assert.match(honeypot?.reasons[0] ?? '', /Honeypot/);
  assert.ok(honeypot?.reasons.some((r) => r.includes('100%')));
  assert.equal(parseEvmTokenSecurity({ is_airdrop_scam: '1' })?.level, 'danger');
  assert.equal(parseEvmTokenSecurity({ fake_token: { true_token_address: '0xabc', value: 1 } })?.level, 'danger');
  assert.equal(parseEvmTokenSecurity({ sell_tax: '0.15' })?.level, 'warn');
  assert.equal(parseEvmTokenSecurity({ sell_tax: '', buy_tax: '', is_open_source: '1' })?.level, 'ok');
  assert.equal(parseEvmTokenSecurity(undefined), null);
  assert.match(tokenRiskLabel(honeypot)?.text ?? '', /^Possible scam token/);
  assert.equal(tokenRiskLabel(parseEvmTokenSecurity({ sell_tax: '0.15' }))?.danger, false);
});

test('Solana token: trusted, malicious authority, balance-mutable, non-transferable, freezable', () => {
  assert.equal(parseSolanaTokenSecurity({ trusted_token: 1, freezable: { status: '1' } })?.level, 'trusted');
  const evil = parseSolanaTokenSecurity({ mintable: { status: '1', authority: [{ address: 'x', malicious_address: 1 }] } });
  assert.equal(evil?.level, 'danger');
  assert.equal(parseSolanaTokenSecurity({ balance_mutable_authority: { status: '1', authority: [] } })?.level, 'danger');
  assert.equal(parseSolanaTokenSecurity({ non_transferable: '1' })?.level, 'danger');
  assert.equal(parseSolanaTokenSecurity({ freezable: { status: '1', authority: [] } })?.level, 'warn');
  assert.equal(parseSolanaTokenSecurity({ freezable: { status: '0' }, transfer_hook: [] })?.level, 'ok');
});

test('address / approval-contract / phishing-site parsing', () => {
  const addr = parseAddressSecurity({ stealing_attack: '1', sanctioned: '1', blacklist_doubt: '1', number_of_malicious_contracts_created: '0' });
  assert.equal(addr?.level, 'danger');
  assert.match(addr?.reasons[0] ?? '', /stealing funds, sanctions/);
  assert.equal(parseAddressSecurity({ blacklist_doubt: '1' })?.level, 'warn');
  assert.equal(parseAddressSecurity({ number_of_malicious_contracts_created: '2' })?.level, 'danger');
  assert.equal(parseAddressSecurity({ cybercrime: '0' })?.level, 'ok');

  assert.equal(parseApprovalSecurity({ trust_list: 1, is_contract: 1, doubt_list: 0, malicious_behavior: [] })?.level, 'trusted');
  assert.equal(parseApprovalSecurity({ doubt_list: 1, trust_list: 1 })?.level, 'danger');
  assert.match(parseApprovalSecurity({ malicious_behavior: ['approval_abuse'] })?.reasons[0] ?? '', /approval abuse/);
  assert.match(parseApprovalSecurity({ is_contract: 0 })?.reasons[0] ?? '', /personal wallet/);

  assert.equal(parsePhishingSite({ phishing_site: 1, website_contract_security: [] })?.level, 'danger');
  assert.equal(parsePhishingSite({ phishing_site: 0, website_contract_security: [] })?.level, 'ok');
  assert.equal(parsePhishingSite({ phishing_site: 0, website_contract_security: [{ is_malicious: 1 }] })?.level, 'danger');
});

test('envelope + worstRisk', () => {
  assert.equal(unwrapGoPlus({ code: 4029, message: 'too many requests', result: {} }), null);
  assert.equal(unwrapGoPlus({ code: 1, result: null }), null);
  assert.deepEqual(unwrapGoPlus({ code: 1, result: { a: 1 } }), { a: 1 });
  assert.equal(unwrapGoPlus('nope'), null);
  assert.equal(worstRisk(null, { level: 'ok', reasons: [] }, { level: 'warn', reasons: ['w'] })?.level, 'warn');
  assert.equal(worstRisk(null, undefined), null);
});

test('rate limiter: per-minute and per-day caps, back-off', () => {
  let now = 0;
  const limiter = new RateLimiter(3, 5, () => now);
  assert.equal([limiter.tryTake(), limiter.tryTake(), limiter.tryTake(), limiter.tryTake()].join(), 'true,true,true,false');
  now = 61_000;
  assert.equal([limiter.tryTake(), limiter.tryTake(), limiter.tryTake()].join(), 'true,true,false', 'day cap of 5');
  now = 86_400_000 + 1;
  assert.equal(limiter.tryTake(), true);
  limiter.backOff();
  assert.equal(limiter.tryTake(), false);
});

function fakeFetch(handler: (url: string, init?: { headers?: Record<string, string> }) => unknown) {
  const urls: string[] = [];
  const headers: (Record<string, string> | undefined)[] = [];
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    urls.push(url);
    headers.push(init?.headers);
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    if (typeof body === 'number') return { ok: body < 400, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }) as never;
  return { fetchImpl, urls, headers };
}

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

test('client: batches tokens, caches 24h, de-dupes in-flight calls, skips unsupported chains', async () => {
  let now = 0;
  const f = fakeFetch(() => ({ code: 1, result: { [A]: { is_honeypot: '1' }, [B.toUpperCase().replace('0X', '0x')]: { trust_list: '1' } } }));
  const client = new GoPlusClient({ fetchImpl: f.fetchImpl, clock: () => now });
  const [r1, r2] = await Promise.all([client.tokenRisks(1, [A, B]), client.tokenRisks(1, [A, B])]);
  assert.equal(f.urls.length, 1, 'one batched, de-duplicated request');
  assert.match(f.urls[0], /\/token_security\/1\?contract_addresses=0xa+,0xb+$/);
  assert.equal(r1.get(A)?.level, 'danger');
  assert.equal(r1.get(B)?.level, 'trusted');
  assert.equal(r2.get(A)?.level, 'danger');
  await client.tokenRisks(1, [A.toUpperCase().replace('0X', '0x')]);
  assert.equal(f.urls.length, 1, 'cache hit (case-insensitive)');
  now = 25 * 3600_000;
  await client.tokenRisks(1, [A]);
  assert.equal(f.urls.length, 2, 'expired after 24h');
  const ape = await client.tokenRisks(33139, [A]);
  assert.equal(ape.get(A), null);
  assert.equal(f.urls.length, 2, 'ApeChain is not covered: no call');
});

test('client: fails open on errors, 429 and code 4029, and retries unknowns after 2 minutes', async () => {
  let now = 0;
  let mode: 'error' | '429' | '4029' | 'ok' = 'error';
  const f = fakeFetch(() => (mode === 'error' ? new Error('net') : mode === '429' ? 429 : mode === '4029' ? { code: 4029, message: 'limit' } : { code: 1, result: { phishing_site: 1 } }));
  const client = new GoPlusClient({ fetchImpl: f.fetchImpl, clock: () => now });
  assert.equal(await client.siteRisk('https://evil.example/path'), null);
  now += 3 * 60_000;
  mode = '429';
  assert.equal(await client.siteRisk('https://evil.example/other'), null);
  // 429 backs off for a minute: no request is sent, even for another site.
  const sent = f.urls.length;
  assert.equal(await client.siteRisk('https://other-site.example'), null);
  assert.equal(f.urls.length, sent, 'backed off');
  now += 3 * 60_000;
  mode = '4029';
  assert.equal(await client.siteRisk('https://evil.example'), null);
  now += 3 * 60_000 + 61_000;
  mode = 'ok';
  assert.equal((await client.siteRisk('https://EVIL.example/x?y=1'))?.level, 'danger');
  assert.match(f.urls.at(-1) ?? '', /phishing_site\?url=https%3A%2F%2Fevil\.example$/);
  assert.equal(await client.siteRisk('javascript:alert(1)'), null);
  assert.equal(await client.addressRisk('not-an-address', 1), null);
});

test('client: optional access token is sent as Bearer; flag can switch GoPlus off', async () => {
  const f = fakeFetch(() => ({ code: 1, result: { cybercrime: '0' } }));
  const client = new GoPlusClient({ fetchImpl: f.fetchImpl, accessToken: 'tok' });
  assert.equal((await client.addressRisk(A, 1))?.level, 'ok');
  assert.equal(f.headers[0]?.Authorization, 'Bearer tok');
  assert.match(f.urls[0], /address_security\/0xa+\?chain_id=1$/);
  const keyless = fakeFetch(() => ({ code: 1, result: {} }));
  await new GoPlusClient({ fetchImpl: keyless.fetchImpl }).addressRisk(B, 1);
  assert.equal(keyless.headers[0]?.Authorization, undefined);
  assert.equal(goplusEnabled(undefined), true);
  assert.equal(goplusEnabled('0'), false);
  assert.equal(goplusEnabled('1'), true);
});

test('client: Solana mint batch', async () => {
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const f = fakeFetch(() => ({ code: 1, result: { [mint]: { trusted_token: 1 } } }));
  const client = new GoPlusClient({ fetchImpl: f.fetchImpl });
  const out = await client.solanaTokenRisks([mint, 'bad mint!']);
  assert.equal(out.get(mint)?.level, 'trusted');
  assert.equal(out.has('bad mint!'), false);
  assert.match(f.urls[0], /\/solana\/token_security\?contract_addresses=EPj/);
});

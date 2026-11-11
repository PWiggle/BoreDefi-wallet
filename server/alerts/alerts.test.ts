import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { classifyTransfers, type Transfer } from './activity';
import { alchemyTransfers, hmacSha256Hex, verifyAlchemySignature, ALCHEMY_FREE_PLAN_NETWORKS } from './alchemy';
import { SubrequestBudget } from './budget';
import { NEXT_PRICE_CHECK, runCron, syncHelius } from './cron';
import { padTopic, pollChain, TRANSFER_TOPIC } from './evm-poll';
import { handleRequest, sha256Hex, type HandlerDeps } from './handler';
import { heliusTransfers } from './helius';
import { boreDashPricesUrl, fetchAlertPrices, parseBoreDashPrices } from './prices';
import { MemoryStore } from './store';

const EVM = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const OTHER = '0x1111111111111111111111111111111111111111';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const SOL_OTHER = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';
const DEVICE = 'device-0000-0000-0001';
const SECRET = 'a'.repeat(64);
const AUTH = `Device ${DEVICE}:${SECRET}`;

type Call = { url: string; init?: RequestInit };

function fakeFetch(route: (url: string, init?: RequestInit) => unknown | Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = route(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

function expoOk(_url: string, init?: RequestInit) {
  const batch = JSON.parse(String(init?.body ?? '[]')) as unknown[];
  return { data: batch.map(() => ({ status: 'ok' })) };
}

async function registered(store = new MemoryStore(), incoming = true, evm = [EVM], sol: string[] = []) {
  await store.upsertDevice(
    { id: DEVICE, secretHash: await sha256Hex(SECRET), pushToken: TOKEN, platform: 'android', incomingEnabled: incoming, createdAt: 1, updatedAt: 1 },
    [...evm.map((address) => ({ kind: 'evm' as const, address })), ...sol.map((address) => ({ kind: 'solana' as const, address }))],
  );
  return store;
}

// ---- Prices: BoreDash only -----------------------------------------------------------------------------------

test('price URL is BoreDash only, with ids de-duplicated and sorted for a stable cache key', () => {
  assert.equal(
    boreDashPricesUrl(['solana', 'ethereum', 'SOLANA', 'apecoin']),
    'https://www.boredash.com/api/wallet/prices?ids=apecoin%2Cethereum%2Csolana',
  );
});

test('BoreDash 429, error bodies, CoinGecko-style error status and bad JSON all count as failure; no other host is called', async () => {
  const cases: Array<[Response, string]> = [
    [new Response('{"error":"CoinGecko rate limit"}', { status: 429 }), 'rate-limited'],
    [new Response('{"error":"CoinGecko rate limit"}', { status: 200 }), 'error-body'],
    [new Response('{"status":{"error_code":429}}', { status: 200 }), 'error-body'],
    [new Response('not json', { status: 200 }), 'bad-json'],
    [new Response('oops', { status: 502 }), 'http-error'],
  ];
  for (const [response, reason] of cases) {
    const { calls, fetchImpl } = fakeFetch(() => response);
    const result = await fetchAlertPrices(['ethereum'], fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, reason);
    assert.equal(calls.length, 1);
    assert.ok(calls.every((call) => call.url.startsWith('https://www.boredash.com/')));
  }
  assert.deepEqual(parseBoreDashPrices({ ethereum: { usd: 2062.81 }, junk: { usd: 'x' } }), { ethereum: 2062.81 });
});

test('the alert checker never talks to CoinGecko directly', () => {
  for (const file of ['prices.ts', 'cron.ts', 'handler.ts', 'worker.ts', 'wrangler.toml']) {
    const text = readFileSync(join(__dirname, file), 'utf8');
    assert.ok(!/api\.coingecko\.com|pro-api\.coingecko\.com|x-cg-demo-api-key/i.test(text), file);
  }
});

test('cron: one batched BoreDash call every 10 minutes by default, fires one-shot alerts and pushes them', async () => {
  const store = await registered();
  await store.addAlert(DEVICE, { id: 'a1', coinId: 'ethereum', symbol: 'ETH', direction: 'above', targetUsd: 2000, active: true, createdAt: 1, firedAt: null });
  await store.addAlert(DEVICE, { id: 'a2', coinId: 'solana', symbol: 'SOL', direction: 'below', targetUsd: 100, active: true, createdAt: 1, firedAt: null });
  const { calls, fetchImpl } = fakeFetch((url, init) =>
    url.startsWith('https://www.boredash.com/') ? { ethereum: { usd: 2062.81 }, solana: { usd: 150 } } : expoOk(url, init),
  );
  let now = 1_000_000;
  const env = { POLL_CHAIN_IDS: '' };
  const first = await runCron({ store, env, now: () => now, fetchImpl });
  assert.equal(first.priceCheck, 'ok');
  assert.equal(first.priceCalls, 1);
  assert.equal(first.fired, 1);
  const boreDashCalls = calls.filter((c) => c.url.includes('boredash'));
  assert.equal(boreDashCalls.length, 1);
  assert.ok(boreDashCalls[0]?.url.endsWith('ids=ethereum%2Csolana'));
  const pushed = JSON.parse(String(calls.find((c) => c.url.includes('exp.host'))?.init?.body)) as Array<{ to: string; title: string }>;
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]?.to, TOKEN);
  assert.equal(pushed[0]?.title, 'ETH rose above $2,000.00');
  assert.equal((await store.listAlerts(DEVICE)).find((a) => a.id === 'a1')?.active, false);

  now += 5 * 60_000;
  assert.equal((await runCron({ store, env, now: () => now, fetchImpl })).priceCheck, 'not-due');
  now += 5 * 60_000;
  const third = await runCron({ store, env, now: () => now, fetchImpl });
  assert.equal(third.priceCheck, 'ok');
  assert.ok(calls.filter((c) => c.url.includes('boredash')).at(-1)?.url.endsWith('ids=solana'));
});

test('cron: BoreDash 429 skips the cycle and retries next cycle; no alerts means no call at all', async () => {
  const store = await registered();
  let now = 5_000_000;
  const env = { POLL_CHAIN_IDS: '' };
  const empty = fakeFetch(() => ({}));
  assert.equal((await runCron({ store, env, now: () => now, fetchImpl: empty.fetchImpl })).priceCheck, 'no-alerts');
  assert.equal(empty.calls.length, 0);

  await store.addAlert(DEVICE, { id: 'a1', coinId: 'ethereum', symbol: 'ETH', direction: 'below', targetUsd: 3000, active: true, createdAt: 1, firedAt: null });
  await store.setMeta(NEXT_PRICE_CHECK, '0');
  let limited = true;
  const { calls, fetchImpl } = fakeFetch((url, init) => {
    if (url.includes('boredash')) return limited ? new Response('{"error":"CoinGecko rate limit"}', { status: 429 }) : { ethereum: { usd: 2000 } };
    return expoOk(url, init);
  });
  const skipped = await runCron({ store, env, now: () => now, fetchImpl });
  assert.equal(skipped.priceCheck, 'skipped');
  assert.equal(skipped.priceReason, 'rate-limited');
  assert.equal(calls.length, 1);
  assert.equal((await store.listAlerts(DEVICE))[0]?.active, true);
  limited = false;
  now += 10 * 60_000;
  const retried = await runCron({ store, env, now: () => now, fetchImpl });
  assert.equal(retried.priceCheck, 'ok');
  assert.equal(retried.fired, 1);
});

// ---- Incoming funds and swaps ------------------------------------------------------------------------------------

test('Alchemy free webhooks are Ethereum, Base, ApeChain, Arbitrum, Polygon', () => {
  assert.deepEqual([...ALCHEMY_FREE_PLAN_NETWORKS], ['ETH_MAINNET', 'BASE_MAINNET', 'APECHAIN_MAINNET', 'ARB_MAINNET', 'MATIC_MAINNET']);
});

test('Alchemy signature is checked against the raw body', async () => {
  const body = '{"x":1}';
  const sig = await hmacSha256Hex('whsec_test', body);
  assert.equal(await verifyAlchemySignature(body, sig, ['other', 'whsec_test']), true);
  assert.equal(await verifyAlchemySignature(body, sig, ['other']), false);
  assert.equal(await verifyAlchemySignature('{"x":2}', sig, ['whsec_test']), false);
  assert.equal(await verifyAlchemySignature(body, null, ['whsec_test']), false);
});

test('Alchemy activity: native receive, known-token receive, swap, and spam/outgoing stay silent', () => {
  const base = (activity: unknown[]) => alchemyTransfers({ webhookId: 'wh', type: 'ADDRESS_ACTIVITY', event: { network: 'BASE_MAINNET', activity: activity as never } });
  const watched = new Set([EVM]);
  const native = base([{ fromAddress: OTHER, toAddress: EVM, hash: '0x1', value: 0.5, asset: 'ETH', category: 'external' }]);
  assert.equal(native.chainId, 8453);
  assert.deepEqual(classifyTransfers(native.transfers, watched, true).map((e) => e.title), ['Received 0.5 ETH']);

  const usdc = base([{ fromAddress: OTHER, toAddress: EVM, hash: '0x2', value: 25, asset: 'USDC', category: 'token', rawContract: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' } }]);
  assert.deepEqual(classifyTransfers(usdc.transfers, watched, true).map((e) => e.title), ['Received 25 USDC']);

  const spam = base([{ fromAddress: OTHER, toAddress: EVM, hash: '0x3', value: 1000, asset: 'USDC', category: 'token', rawContract: { address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead' } }]);
  assert.deepEqual(classifyTransfers(spam.transfers, watched, true), []);

  const sent = base([{ fromAddress: EVM, toAddress: OTHER, hash: '0x4', value: 1, asset: 'ETH', category: 'external' }]);
  assert.deepEqual(classifyTransfers(sent.transfers, watched, true), []);

  const swap = base([
    { fromAddress: EVM, toAddress: OTHER, hash: '0x5', value: 0.1, asset: 'ETH', category: 'external' },
    { fromAddress: OTHER, toAddress: EVM, hash: '0x5', value: 300, asset: 'USDC', category: 'token', rawContract: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' } },
  ]);
  const events = classifyTransfers(swap.transfers, watched, true);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'swap');
  assert.equal(events[0]?.title, 'Swap finished on Base');
  assert.equal(events[0]?.body, '0.1 ETH → 300 USDC');

  const ape = alchemyTransfers({ type: 'ADDRESS_ACTIVITY', event: { network: 'APECHAIN_MAINNET', activity: [{ fromAddress: OTHER, toAddress: EVM, hash: '0x6', value: 12, asset: 'APE', category: 'external' }] } });
  assert.deepEqual(classifyTransfers(ape.transfers, watched, true).map((e) => `${e.title} | ${e.body}`), ['Received 12 APE | On ApeChain. Open BoreDefi to see it.']);
});

test('Helius enhanced payload: SOL receive and a Jupiter-style swap', () => {
  const transfers = heliusTransfers([
    { signature: 's1', type: 'TRANSFER', nativeTransfers: [{ fromUserAccount: SOL_OTHER, toUserAccount: SOL, amount: 1_500_000_000 }] },
    {
      signature: 's2',
      type: 'SWAP',
      nativeTransfers: [],
      tokenTransfers: [
        { fromUserAccount: SOL, toUserAccount: SOL_OTHER, tokenAmount: 1, mint: 'So11111111111111111111111111111111111111112' },
        { fromUserAccount: SOL_OTHER, toUserAccount: SOL, tokenAmount: 150, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      ],
    },
  ]);
  const events = classifyTransfers(transfers, new Set([SOL]), false);
  assert.deepEqual(events.map((e) => `${e.kind}: ${e.title} | ${e.body}`), [
    'received: Received 1.5 SOL | On Solana. Open BoreDefi to see it.',
    'swap: Swap finished on Solana | 1 SOL → 150 USDC',
  ]);
});

// ---- HTTP API ------------------------------------------------------------------------------------------------------

function deps(store: MemoryStore, extra: Partial<HandlerDeps> = {}): HandlerDeps {
  let n = 0;
  return { store, env: {}, now: () => 42, randomId: () => `alert-${++n}`, ...extra };
}

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = { authorization: AUTH }) {
  return new Request(`https://alerts.example${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('device registration stores only token, platform, toggle and public addresses; secret is hashed', async () => {
  const store = new MemoryStore();
  const d = deps(store);
  assert.equal((await handleRequest(req('GET', '/v1/alerts', undefined, {}), d)).status, 401);
  assert.equal((await handleRequest(req('GET', '/v1/alerts'), d)).status, 404);
  const ok = await handleRequest(
    req('PUT', '/v1/device', { pushToken: TOKEN, platform: 'ios', incomingEnabled: true, evmAddresses: [EVM.toUpperCase().replace('0X', '0x')], solanaAddresses: [SOL], mnemonic: 'never stored' }),
    d,
  );
  assert.equal(ok.status, 200);
  const row = await store.getDevice(DEVICE);
  assert.ok(row);
  assert.equal(row.secretHash, await sha256Hex(SECRET));
  assert.ok(!JSON.stringify([...store.devices.values(), ...store.addresses.values()]).includes(SECRET));
  assert.ok(!JSON.stringify([...store.devices.values()]).includes('never stored'));
  assert.deepEqual(store.addresses.get(DEVICE), [{ kind: 'evm', address: EVM }, { kind: 'solana', address: SOL }]);

  const wrong = await handleRequest(req('GET', '/v1/alerts', undefined, { authorization: `Device ${DEVICE}:${'b'.repeat(64)}` }), d);
  assert.equal(wrong.status, 401);
  assert.equal((await handleRequest(req('PUT', '/v1/device', { pushToken: 'nope', platform: 'ios' }), d)).status, 400);
});

test('price alerts: create, list, cap at 20, delete', async () => {
  const store = await registered();
  const d = deps(store);
  const created = await handleRequest(req('POST', '/v1/alerts', { coinId: 'solana', symbol: 'sol', direction: 'above', targetUsd: 250 }), d);
  assert.equal(created.status, 201);
  const { alert } = (await created.json()) as { alert: { id: string; symbol: string } };
  assert.equal(alert.symbol, 'SOL');
  assert.equal((await handleRequest(req('POST', '/v1/alerts', { coinId: 'solana', symbol: 'SOL', direction: 'sideways', targetUsd: 1 }), d)).status, 400);
  for (let i = 1; i < 20; i += 1) {
    await handleRequest(req('POST', '/v1/alerts', { coinId: 'ethereum', symbol: 'ETH', direction: 'below', targetUsd: 1000 + i }), d);
  }
  assert.equal((await handleRequest(req('POST', '/v1/alerts', { coinId: 'ethereum', symbol: 'ETH', direction: 'below', targetUsd: 1 }), d)).status, 409);
  const list = (await (await handleRequest(req('GET', '/v1/alerts'), d)).json()) as { alerts: unknown[] };
  assert.equal(list.alerts.length, 20);
  assert.equal((await handleRequest(req('DELETE', `/v1/alerts/${alert.id}`), d)).status, 200);
  assert.equal((await handleRequest(req('DELETE', `/v1/alerts/${alert.id}`), d)).status, 404);
  assert.equal((await handleRequest(req('DELETE', '/v1/device'), d)).status, 200);
  assert.equal(await store.getDevice(DEVICE), null);
});

test('Alchemy webhook: bad signature rejected; signed delivery pushes once even if Alchemy retries', async () => {
  const store = await registered();
  const { calls, fetchImpl } = fakeFetch(expoOk);
  const pending: Promise<unknown>[] = [];
  const env = { ALCHEMY_SIGNING_KEYS: 'whsec_test', ALCHEMY_WEBHOOKS: 'BASE_MAINNET=wh_base' };
  const d = deps(store, { env, fetchImpl, waitUntil: (p) => pending.push(p) });
  const body = JSON.stringify({ webhookId: 'wh_base', type: 'ADDRESS_ACTIVITY', event: { network: 'BASE_MAINNET', activity: [{ fromAddress: OTHER, toAddress: EVM, hash: '0xabc', value: 0.25, asset: 'ETH', category: 'external' }] } });
  assert.equal((await handleRequest(req('POST', '/v1/webhooks/alchemy', body, { 'x-alchemy-signature': '00' }), d)).status, 401);
  const sig = await hmacSha256Hex('whsec_test', body);
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await handleRequest(req('POST', '/v1/webhooks/alchemy', body, { 'x-alchemy-signature': sig }), d)).status, 200);
  }
  await Promise.all(pending);
  const pushes = calls.filter((c) => c.url.includes('exp.host'));
  assert.equal(pushes.length, 1);
  assert.match(String(pushes[0]?.init?.body), /Received 0.25 ETH/);
});

test('incoming alerts off = no push; Helius webhook needs its auth header', async () => {
  const store = await registered(new MemoryStore(), false, [], [SOL]);
  const { calls, fetchImpl } = fakeFetch(expoOk);
  const pending: Promise<unknown>[] = [];
  const d = deps(store, { env: { HELIUS_AUTH_HEADER: 'Bearer test-helius' }, fetchImpl, waitUntil: (p) => pending.push(p) });
  const body = [{ signature: 's9', nativeTransfers: [{ fromUserAccount: SOL_OTHER, toUserAccount: SOL, amount: 1e9 }] }];
  assert.equal((await handleRequest(req('POST', '/v1/webhooks/helius', body, { authorization: 'Bearer nope' }), d)).status, 401);
  assert.equal((await handleRequest(req('POST', '/v1/webhooks/helius', body, { authorization: 'Bearer test-helius' }), d)).status, 200);
  await Promise.all(pending);
  assert.equal(calls.length, 0);
});

// ---- Address syncing and public-RPC polling ----------------------------------------------------------------------

test('Helius address edits are batched: at most once per hour, and only when the list changed', async () => {
  const store = await registered(new MemoryStore(), true, [], [SOL]);
  const { calls, fetchImpl } = fakeFetch(() => ({}));
  const env = { HELIUS_API_KEY: 'k', HELIUS_WEBHOOK_ID: 'wh', HELIUS_AUTH_HEADER: 'h', PUBLIC_BASE_URL: 'https://alerts.example' };
  let now = 10_000_000;
  const report = () => ({ priceCheck: 'not-due' as const, priceCalls: 0, fired: 0, alchemyUpdates: 0, heliusUpdated: false, polledChains: [], activityPushed: 0 });
  await syncHelius({ store, env, now: () => now, fetchImpl }, new SubrequestBudget(), report());
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(String(calls[0]?.init?.body)).webhookURL, 'https://alerts.example/v1/webhooks/helius');
  await syncHelius({ store, env, now: () => now, fetchImpl }, new SubrequestBudget(), report());
  assert.equal(calls.length, 1, 'no change, no edit');
  await registered(store, true, [], [SOL, SOL_OTHER]);
  now += 30 * 60_000;
  await syncHelius({ store, env, now: () => now, fetchImpl }, new SubrequestBudget(), report());
  assert.equal(calls.length, 1, 'changed, but within the hour');
  now += 31 * 60_000;
  await syncHelius({ store, env, now: () => now, fetchImpl }, new SubrequestBudget(), report());
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)).accountAddresses, [SOL_OTHER, SOL].sort());
});

test('Alchemy address sync only patches what changed, per webhook', async () => {
  const store = await registered();
  const { calls, fetchImpl } = fakeFetch(() => ({}));
  const env = { ALCHEMY_AUTH_TOKEN: 't', ALCHEMY_WEBHOOKS: 'ETH_MAINNET=wh1,APECHAIN_MAINNET=wh2', POLL_CHAIN_IDS: '' };
  const first = await runCron({ store, env, now: () => 1, fetchImpl });
  assert.equal(first.alchemyUpdates, 2);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { webhook_id: 'wh1', addresses_to_add: [EVM], addresses_to_remove: [] });
  const second = await runCron({ store, env, now: () => 2, fetchImpl });
  assert.equal(second.alchemyUpdates, 0);
});

test('BNB polling over free public RPC: known-token log and native balance increase notify; first sight is silent', async () => {
  const store = await registered();
  let block = 100;
  let balance = 10n ** 18n;
  const { calls, fetchImpl } = fakeFetch((url, init) => {
    if (url.includes('exp.host')) return expoOk(url, init);
    const body = JSON.parse(String(init?.body));
    if (Array.isArray(body)) return body.map((r: { id: number }) => ({ jsonrpc: '2.0', id: r.id, result: `0x${balance.toString(16)}` }));
    if (body.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: 1, result: `0x${block.toString(16)}` };
    if (body.method === 'eth_getLogs') {
      const toFilter = body.params[0].topics[2];
      return {
        jsonrpc: '2.0',
        id: 2,
        result: toFilter && block === 110
          ? [{ address: '0x55d398326f99059ff775485246999027b3197955', topics: [TRANSFER_TOPIC, padTopic(OTHER), padTopic(EVM)], data: `0x${(5n * 10n ** 18n).toString(16)}`, transactionHash: '0xbnb1', logIndex: '0x0' }]
          : [],
      };
    }
    return {};
  });
  const budget = new SubrequestBudget();
  const first = await pollChain(56, [EVM], store, budget, fetchImpl);
  assert.deepEqual(first, []);
  block = 110;
  balance = 3n * 10n ** 18n;
  const env = { POLL_CHAIN_IDS: '56' };
  const report = await runCron({ store, env, now: () => 1, fetchImpl });
  assert.deepEqual(report.polledChains, [56]);
  assert.equal(report.activityPushed, 2);
  const titles = calls.filter((c) => c.url.includes('exp.host')).flatMap((c) => (JSON.parse(String(c.init?.body)) as Array<{ title: string }>).map((m) => m.title));
  assert.deepEqual(titles.sort(), ['Received 2 BNB', 'Received 5 USDT']);
  assert.ok(calls.every((c) => c.url.includes('exp.host') || !c.url.includes('alchemy')));
});

test('polling respects the Workers free-plan 50-subrequest cap', async () => {
  const store = new MemoryStore();
  const many = Array.from({ length: 2000 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
  const { calls, fetchImpl } = fakeFetch(() => ({ jsonrpc: '2.0', id: 1, result: '0x1' }));
  const budget = new SubrequestBudget();
  assert.equal(await pollChain(10, many, store, budget, fetchImpl), null);
  assert.equal(calls.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { memoryStore } from './security/kv';
import {
  allowSiteForSession,
  checkPhishing,
  checkSite,
  domainHash,
  hydratePhishingCache,
  isKnownGoodSite,
  parsePhantomBlocklist,
  PHISHING_CACHE_PREFIX,
  refreshPhantomList,
  refreshPhishingList,
  resetPhishingSessionState,
} from './security/phishing';
import { siteWarning } from './security/scam-warnings';

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? init.etag ?? null : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('domain matcher: exact host, subdomains and paths match; unrelated and parent-only hosts do not', async () => {
  await refreshPhishingList((async () => jsonResponse({ blacklist: ['drain-matcher.example'] })) as never);
  for (const u of ['drain-matcher.example', 'https://drain-matcher.example/claim?x=1', 'http://a.b.drain-matcher.example', 'DRAIN-MATCHER.EXAMPLE.']) {
    const v = checkPhishing(u);
    assert.equal(v.blocked, true, u);
    assert.equal(v.source, 'blocklist', u);
    assert.equal(v.canContinue, true, u);
  }
  for (const u of ['example', 'notdrain-matcher.example', 'drain-matcher.example.org', 'https://app.uniswap.org']) {
    assert.equal(checkPhishing(u).blocked, false, u);
  }
});

test('domain matcher: code links can never be continued; lookalikes can', () => {
  const code = checkPhishing('javascript:alert(1)');
  assert.equal(code.blocked, true);
  assert.equal(code.canContinue, false);
  assert.equal(siteWarning(code, 'browser').canContinue, false);
  const look = checkPhishing('https://uniswap-airdrop.com');
  assert.equal(look.source, 'lookalike');
  assert.equal(look.host, 'uniswap-airdrop.com');
  const w = siteWarning(look, 'browser');
  assert.equal(w.canContinue, true);
  assert.match(w.summary, /uniswap-airdrop\.com/);
});

test('"Continue anyway" allows only that host for the session; code links stay blocked', () => {
  resetPhishingSessionState();
  assert.equal(checkSite('https://opensea-claim.xyz').blocked, true);
  allowSiteForSession('https://opensea-claim.xyz/whatever');
  assert.equal(checkSite('https://opensea-claim.xyz/x').blocked, false);
  assert.equal(checkPhishing('https://opensea-claim.xyz/x').blocked, true, 'raw check unaffected');
  assert.equal(checkSite('https://other.opensea-claim.xyz').blocked, true, 'other hosts still warn');
  allowSiteForSession('javascript:alert(1)');
  assert.equal(checkSite('javascript:alert(1)').blocked, true);
  resetPhishingSessionState();
});

test('allowlisted official domains are known-good (no remote lookup needed)', () => {
  assert.equal(isKnownGoodSite('https://app.uniswap.org/swap'), true);
  assert.equal(isKnownGoodSite('https://uniswap-airdrop.com'), false);
});

test('domainHash is fixed width and stable', () => {
  assert.equal(domainHash('example.com').length, 10);
  assert.equal(domainHash('Example.com'), domainHash('example.com'));
  assert.notEqual(domainHash('example.com'), domainHash('example.org'));
});

test('refresh persists hashes, honours the 12h TTL and ETag, and a cold start reads the cache', async () => {
  const storage = memoryStore();
  let calls = 0;
  let lastHeaders: Record<string, string> | undefined;
  const fetchImpl = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    calls += 1;
    lastHeaders = init?.headers;
    if (init?.headers?.['If-None-Match'] === 'v1') return jsonResponse(null, { status: 304 });
    return jsonResponse({ blacklist: ['cached-drainer.example', 'second-drainer.example'], whitelist: ['good.example'] }, { etag: 'v1' });
  }) as never;

  assert.equal(await refreshPhishingList(fetchImpl, { storage, now: 1_000 }), true);
  assert.equal(calls, 1);
  const meta = JSON.parse(storage.data.get(`${PHISHING_CACHE_PREFIX}meta`) ?? '{}');
  assert.equal(meta.etag, 'v1');
  assert.ok(meta.chunks >= 1);
  assert.ok((storage.data.get(`${PHISHING_CACHE_PREFIX}chunk.0`) ?? '').includes(domainHash('cached-drainer.example')));

  // Fresh: no download.
  assert.equal(await refreshPhishingList(fetchImpl, { storage, now: 1_000 + 60_000 }), true);
  assert.equal(calls, 1);
  // Stale: conditional request, 304 keeps the cache and bumps fetchedAt.
  assert.equal(await refreshPhishingList(fetchImpl, { storage, now: 1_000 + 13 * 3600_000 }), true);
  assert.equal(calls, 2);
  assert.equal(lastHeaders?.['If-None-Match'], 'v1');

  // A brand-new process would only have the persisted hashes: hydrate into a store and check a hashed domain.
  const cold = memoryStore(Object.fromEntries(storage.data));
  assert.equal(await hydratePhishingCache(cold), true);
  assert.equal(checkPhishing('https://x.second-drainer.example').blocked, true);
});

test('a domain known only from the persisted hash cache is flagged after hydrate', async () => {
  assert.equal(checkPhishing('https://hash-only-drainer.example').blocked, false);
  const cold = memoryStore({
    [`${PHISHING_CACHE_PREFIX}meta`]: JSON.stringify({ chunks: 1, fetchedAt: 1 }),
    [`${PHISHING_CACHE_PREFIX}chunk.0`]: domainHash('unrelated.example') + domainHash('hash-only-drainer.example'),
  });
  assert.equal(await hydratePhishingCache(cold), true);
  const v = checkPhishing('https://app.hash-only-drainer.example/claim');
  assert.equal(v.blocked, true);
  assert.equal(v.source, 'blocklist');
});

test('refresh fails open: offline, HTTP errors and junk never throw', async () => {
  const storage = memoryStore({ [`${PHISHING_CACHE_PREFIX}meta`]: '{not json' });
  assert.equal(await refreshPhishingList((async () => { throw new Error('offline'); }) as never, { storage }), false);
  assert.equal(await refreshPhishingList((async () => jsonResponse({}, { status: 500 })) as never), false);
  assert.equal(await refreshPhishingList((async () => jsonResponse('garbage')) as never), true);
  assert.equal(await hydratePhishingCache({ getItem: async () => { throw new Error('disk'); }, setItem: async () => undefined }), false);
  assert.equal(checkPhishing('https://app.uniswap.org').blocked, false);
});

test("Phantom blocklist.yaml parsing and refresh (Solana scam sites)", async () => {
  const yaml = ['---', '  - url: solana-drainer-test.example', '  - url: "quoted-sol-scam.example"', '  - url: https://with-scheme.example/path', '# - url: commented.example', '  - url: "*.github.io"', 'junk'].join('\n');
  assert.deepEqual(parsePhantomBlocklist(yaml).sort(), ['quoted-sol-scam.example', 'solana-drainer-test.example', 'with-scheme.example']);
  const storage = memoryStore();
  assert.equal(await refreshPhantomList((async () => jsonResponse(yaml)) as never, { storage, now: 5 }), true);
  const v = checkPhishing('https://solana-drainer-test.example/connect');
  assert.equal(v.blocked, true);
  assert.equal(v.source, 'phantom');
  assert.equal(await refreshPhantomList((async () => { throw new Error('x'); }) as never), false);
});

test('WalletConnect proposal from a flagged origin carries host + continue flag for the warning sheet', async () => {
  const { summarizeProposal } = await import('./wc-session');
  const flagged = summarizeProposal({ proposer: { metadata: { name: 'Uniswap', url: 'https://uniswap-airdrop.com' } } }, null, { solanaEnabled: false });
  assert.equal(flagged.blockedHost, 'uniswap-airdrop.com');
  assert.equal(flagged.blockedCanContinue, true);
  assert.match(flagged.blockedReason ?? '', /imitates uniswap/);
  const seen = summarizeProposal(
    { proposer: { metadata: { name: 'Fine', url: 'https://app.uniswap.org' } } },
    { verified: { origin: 'https://opensea-claim.xyz', validation: 'INVALID' } },
    { solanaEnabled: false },
  );
  assert.equal(seen.blockedHost, 'opensea-claim.xyz');
  const code = summarizeProposal({ proposer: { metadata: { name: 'x', url: 'javascript:alert(1)' } } }, null, { solanaEnabled: false });
  assert.equal(code.blockedCanContinue, false);
  const clean = summarizeProposal({ proposer: { metadata: { name: 'Uniswap', url: 'https://app.uniswap.org' } } }, null, { solanaEnabled: false });
  assert.equal(clean.blockedReason, null);
});

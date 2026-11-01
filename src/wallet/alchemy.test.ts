import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchActivity } from './activity';
import { ALCHEMY_CHAINS, alchemyEnabledFor, fetchAlchemyActivity, fetchAlchemyNfts, getAlchemyKey, parseAlchemyNfts } from './alchemy';
import { fetchNfts } from './nfts';

const OWNER = '0x5886ed74c54522a460f78515b8af4451cda18994';
const KEY = 'test_key';

type Call = { url: string; init?: { method?: string; body?: string } };

function router(handler: (call: Call) => { status: number; body: unknown }, calls: Call[] = []) {
  return async (url: string, init?: { method?: string; body?: string }) => {
    const call = { url, init };
    calls.push(call);
    const { status, body } = handler(call);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

const ownedNfts = {
  ownedNfts: [
    {
      contract: { address: '0x0000000000000000000000000000000000000abc', name: 'Base Punks', tokenType: 'ERC721' },
      tokenId: '42',
      tokenType: 'ERC721',
      name: 'Punk #42',
      image: { cachedUrl: 'https://nft-cdn.alchemy.com/42.png' },
    },
    { contract: { address: 'bad' }, tokenId: '1', tokenType: 'ERC721' },
    { contract: { address: '0x0000000000000000000000000000000000000def', tokenType: 'ERC1155' }, tokenId: '7', tokenType: 'ERC1155' },
  ],
};

test('config: key comes only from EXPO_PUBLIC_ALCHEMY_KEY and only Base, Polygon, Arbitrum, BNB use it', () => {
  assert.equal(getAlchemyKey({}), null);
  assert.equal(getAlchemyKey({ EXPO_PUBLIC_ALCHEMY_KEY: '  ' }), null);
  assert.equal(getAlchemyKey({ EXPO_PUBLIC_ALCHEMY_KEY: ' abc ' }), 'abc');
  assert.deepEqual([...ALCHEMY_CHAINS].sort((a, b) => a - b), [56, 137, 8453, 42161]);
  assert.equal(alchemyEnabledFor(8453, KEY), true);
  assert.equal(alchemyEnabledFor(1, KEY), false);
  assert.equal(alchemyEnabledFor(8453, null), false);
});

test('parses Alchemy NFTs and skips malformed rows', () => {
  const items = parseAlchemyNfts(ownedNfts.ownedNfts, 8453);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    chainId: 8453,
    contract: '0x0000000000000000000000000000000000000aBc',
    tokenId: '42',
    standard: 'ERC-721',
    name: 'Punk #42',
    collection: 'Base Punks',
    imageUrl: 'https://nft-cdn.alchemy.com/42.png',
  });
  assert.equal(items[1]?.standard, 'ERC-1155');
});

test('Alchemy NFT URL per chain, empty and 404 are empty, errors are unavailable', async () => {
  const calls: Call[] = [];
  const ok = await fetchAlchemyNfts(OWNER, 137, KEY, router(() => ({ status: 200, body: ownedNfts }), calls));
  assert.equal(ok.autodetect, 'ok');
  assert.equal(ok.items.length, 2);
  assert.equal(calls[0]?.url, `https://polygon-mainnet.g.alchemy.com/nft/v3/${KEY}/getNFTsForOwner?owner=${OWNER}&withMetadata=true&pageSize=100`);
  assert.deepEqual(await fetchAlchemyNfts(OWNER, 8453, KEY, router(() => ({ status: 200, body: { ownedNfts: [] } }))), { items: [], autodetect: 'ok' });
  assert.deepEqual(await fetchAlchemyNfts(OWNER, 8453, KEY, router(() => ({ status: 404, body: null }))), { items: [], autodetect: 'ok' });
  for (const status of [401, 403, 429, 500]) {
    assert.deepEqual(await fetchAlchemyNfts(OWNER, 8453, KEY, router(() => ({ status, body: null }))), { items: [], autodetect: 'unavailable' });
  }
});

test('fetchNfts uses Alchemy when keyed, falls back to Blockscout when Alchemy fails', async () => {
  const calls: Call[] = [];
  const viaAlchemy = await fetchNfts(OWNER, 8453, router(() => ({ status: 200, body: ownedNfts }), calls) as never, 1000, KEY);
  assert.equal(viaAlchemy.items.length, 2);
  assert.match(calls[0]!.url, /base-mainnet\.g\.alchemy\.com/);

  const fallbackCalls: Call[] = [];
  const fallback = await fetchNfts(
    OWNER,
    8453,
    router((call) => (call.url.includes('alchemy') ? { status: 503, body: null } : { status: 200, body: { items: [] } }), fallbackCalls) as never,
    1000,
    KEY,
  );
  assert.deepEqual(fallback, { items: [], autodetect: 'ok' });
  assert.match(fallbackCalls[1]!.url, /base\.blockscout\.com/);

  const noKeyCalls: Call[] = [];
  await fetchNfts(OWNER, 8453, router(() => ({ status: 200, body: { items: [] } }), noKeyCalls) as never, 1000, null);
  assert.match(noKeyCalls[0]!.url, /blockscout/);

  const ethCalls: Call[] = [];
  await fetchNfts(OWNER, 1, router(() => ({ status: 200, body: { items: [] } }), ethCalls) as never, 1000, KEY);
  assert.match(ethCalls[0]!.url, /eth\.blockscout\.com/, 'Ethereum keeps Blockscout');
});

const transfersFrom = {
  result: {
    transfers: [
      { hash: '0xaaa', from: OWNER, to: '0x0000000000000000000000000000000000000001', rawContract: { value: '0xde0b6b3a7640000' }, metadata: { blockTimestamp: '2026-10-30T10:00:00.000Z' } },
    ],
  },
};
const transfersTo = {
  result: {
    transfers: [
      { hash: '0xbbb', from: '0x0000000000000000000000000000000000000002', to: OWNER, rawContract: { value: '0x0' }, metadata: { blockTimestamp: '2026-10-31T10:00:00.000Z' } },
      { hash: '0xaaa', from: OWNER, to: '0x0000000000000000000000000000000000000001', rawContract: { value: '0xde0b6b3a7640000' }, metadata: { blockTimestamp: '2026-10-30T10:00:00.000Z' } },
    ],
  },
};

test('Alchemy activity merges both directions, dedupes and sorts newest first', async () => {
  const calls: Call[] = [];
  const items = await fetchAlchemyActivity(
    OWNER,
    56,
    KEY,
    25,
    router((call) => ({ status: 200, body: JSON.parse(call.init!.body!).params[0].fromAddress ? transfersFrom : transfersTo }), calls),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, `https://bnb-mainnet.g.alchemy.com/v2/${KEY}`);
  assert.equal(JSON.parse(calls[0]!.init!.body!).method, 'alchemy_getAssetTransfers');
  assert.deepEqual(items.map((i) => i.hash), ['0xbbb', '0xaaa']);
  assert.equal(items[0]?.inbound, true);
  assert.equal(items[1]?.valueWei, 10n ** 18n);
  assert.equal(items[1]?.timestamp, Date.parse('2026-10-30T10:00:00.000Z') / 1000);
});

test('fetchActivity falls back to Blockscout when Alchemy errors', async () => {
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('alchemy')) {
      return { ok: true, status: 200, json: async () => ({ error: { message: 'Must be authenticated!' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: '0', message: 'No transactions found', result: [] }) };
  }) as unknown as typeof fetch;
  const items = await fetchActivity(OWNER, 42161, 25, KEY, fake);
  assert.deepEqual(items, []);
  assert.ok(calls.some((u) => u.includes('arbitrum.blockscout.com')));
});

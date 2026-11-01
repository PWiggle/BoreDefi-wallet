import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyNftHttpStatus,
  fetchNfts,
  groupNftsByCollection,
  mergeNftLists,
  normalizeNftStandard,
  parseBlockscoutNfts,
} from './nfts';

const catalog = parseBlockscoutNfts(
  [
    {
      id: '7',
      token: {
        type: 'ERC-721',
        name: 'Example',
        address_hash: '0x0000000000000000000000000000000000000001',
      },
      metadata: { name: 'One' },
    },
    { id: 'x', token: { type: 'ERC-20' } },
  ],
  1,
);

test('parses Blockscout NFT payloads', () => {
  assert.equal(normalizeNftStandard('ERC-721'), 'ERC-721');
  assert.equal(normalizeNftStandard('ERC1155'), 'ERC-1155');
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.tokenId, '7');
  assert.equal(catalog[0]?.name, 'One');
});

test('groups collectibles by collection contract', () => {
  const grouped = groupNftsByCollection([
    { item: catalog[0]! },
    {
      item: {
        ...catalog[0]!,
        tokenId: '8',
        name: 'Two',
      },
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.entries.length, 2);
});

test('merges imported collectibles under fetched catalog rows', () => {
  const imported = {
    chainId: 1 as const,
    contract: catalog[0]!.contract,
    tokenId: '9',
    standard: 'ERC-721' as const,
    name: 'Imported',
    collection: 'Example',
  };
  const merged = mergeNftLists(catalog, [imported]);
  assert.equal(merged.length, 2);
});

const OWNER = '0x5886ed74c54522a460f78515b8af4451cda18994';

function fakeFetch(status: number, body: unknown, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body instanceof Error) {
          throw body;
        }
        return body;
      },
    };
  };
}

test('classifies catalog HTTP statuses', () => {
  assert.equal(classifyNftHttpStatus(200), 'json');
  assert.equal(classifyNftHttpStatus(404), 'empty');
  for (const status of [402, 403, 429, 500, 502, 503]) {
    assert.equal(classifyNftHttpStatus(status), 'unavailable');
  }
});

test('an empty Blockscout list is a normal empty wallet, not an error', async () => {
  const calls: string[] = [];
  const result = await fetchNfts(OWNER, 8453, fakeFetch(200, { items: [], next_page_params: null }, calls));
  assert.deepEqual(result, { items: [], autodetect: 'ok' });
  assert.equal(calls[0], `https://base.blockscout.com/api/v2/addresses/${OWNER}/nft?type=ERC-721,ERC-1155`);
});

test('a 404 for an unseen address is treated as empty', async () => {
  const result = await fetchNfts(OWNER, 137, fakeFetch(404, 'not found'));
  assert.deepEqual(result, { items: [], autodetect: 'ok' });
});

test('missing or malformed items is empty, not a crash', async () => {
  assert.deepEqual(await fetchNfts(OWNER, 1, fakeFetch(200, {})), { items: [], autodetect: 'ok' });
  assert.deepEqual(await fetchNfts(OWNER, 1, fakeFetch(200, null)), { items: [], autodetect: 'ok' });
  assert.deepEqual(await fetchNfts(OWNER, 1, fakeFetch(200, { items: 'nope' })), { items: [], autodetect: 'ok' });
});

test('Cloudflare 403 challenge, rate limits and outages mark autodetect unavailable without throwing', async () => {
  for (const status of [402, 403, 429, 503]) {
    const result = await fetchNfts(OWNER, 8453, fakeFetch(status, '<html>Just a moment...</html>'));
    assert.deepEqual(result, { items: [], autodetect: 'unavailable' }, `status ${status}`);
  }
});

test('a non-JSON 200 body or network error marks autodetect unavailable without throwing', async () => {
  const html = await fetchNfts(OWNER, 42161, fakeFetch(200, new SyntaxError('Unexpected token <')));
  assert.deepEqual(html, { items: [], autodetect: 'unavailable' });
  const offline = await fetchNfts(OWNER, 42161, async () => {
    throw new TypeError('Network request failed');
  });
  assert.deepEqual(offline, { items: [], autodetect: 'unavailable' });
});

test('slow catalogs time out instead of hanging the screen', async () => {
  const hanging = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const result = await fetchNfts(OWNER, 1, hanging, 20);
  assert.deepEqual(result, { items: [], autodetect: 'unavailable' });
});

test('chains without a public catalog skip the request', async () => {
  const calls: string[] = [];
  for (const chainId of [56, 43114] as const) {
    assert.deepEqual(await fetchNfts(OWNER, chainId, fakeFetch(500, null, calls)), { items: [], autodetect: 'ok' });
  }
  assert.equal(calls.length, 0);
});

test('parses a real NFT list into items', async () => {
  const result = await fetchNfts(
    OWNER,
    10,
    fakeFetch(200, {
      items: [{ id: '2849', token: { type: 'ERC-721', name: 'Nouns', address_hash: '0x0000000000000000000000000000000000000002' } }],
    }),
  );
  assert.equal(result.autodetect, 'ok');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.chainId, 10);
});

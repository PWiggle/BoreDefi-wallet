import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAlchemyNfts } from './alchemy';
import { protectedNftImageUrl } from './nft-media';
import {
  clearProtectedNftImageCache,
  expandErc1155Uri,
  resolveProtectedNftImage,
  resolveProtectedNftImageCached,
} from './nft-protected-image';

const LIL_MUTANTS = '0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED';
const IMAGE_PATH = 'QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28/4632.png';
const META_PATH = 'QmTxEZuuWgWEfDRg4NqYs6PSuJ15GuatxEivMud7TrBXE6/4632.json';
const EXPECTED = `https://ipfs.filebase.io/ipfs/${IMAGE_PATH}`;

// Alchemy getNFTsForOwner for Patrick's wallet, Nov 4 2026 (the build 15 data path: EXPO_PUBLIC_ALCHEMY_KEY is set).
const ALCHEMY_4632 = {
  contract: { address: LIL_MUTANTS.toLowerCase(), name: 'LMACEXPERIMENT', tokenType: 'ERC721' },
  tokenId: '4632',
  tokenType: 'ERC721',
  name: '#4632',
  tokenUri: `ipfs://${META_PATH}`,
  image: {
    cachedUrl: 'https://nft2-cdn.alchemy.com/eth-mainnet/f12b2513a926bd518ef99b4d1eea2f7c',
    originalUrl: 'https://i2c.seadn.io/ethereum/0x3b45542f6c97fe7f7aa3bb055c95e93b2c0437ed/bb30a3664d1b7d388181187d11cc5368.png',
  },
  raw: { tokenUri: `ipfs://${META_PATH}`, metadata: {} },
};

// The token's own metadata at ipfs://QmTxEZ…/4632.json (trimmed).
const METADATA_4632 = JSON.stringify({
  name: '#4632',
  image: `https://gateway.pinata.cloud/ipfs/${IMAGE_PATH}`,
});

function fakeFetch(routes: Record<string, { status: number; body: string }>, seen: string[] = []) {
  return async (url: string) => {
    seen.push(url);
    const route = routes[url];
    if (!route) {
      throw new Error(`network down: ${url}`);
    }
    return { ok: route.status >= 200 && route.status < 300, status: route.status, text: async () => route.body };
  };
}

test('reproduces build 15: Alchemy gives Lil Mutants #4632 only CDN URLs, so the protected rule finds no image', () => {
  const [item] = parseAlchemyNfts([ALCHEMY_4632], 1);
  assert.ok(item);
  assert.equal(item.imageUrl, ALCHEMY_4632.image.cachedUrl);
  assert.equal(item.imageOriginal, ALCHEMY_4632.image.originalUrl);
  assert.equal(protectedNftImageUrl(item), null);
  assert.equal(item.tokenUri, `ipfs://${META_PATH}`);
});

test('resolves the IPFS image from tokenURI metadata, through our gateways, with ipfs.io 429 text skipped', async () => {
  const [item] = parseAlchemyNfts([ALCHEMY_4632], 1);
  assert.ok(item);
  const seen: string[] = [];
  const url = await resolveProtectedNftImage(item, {
    fetchImpl: fakeFetch(
      {
        [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 504, body: 'gateway timeout' },
        [`https://gateway.pinata.cloud/ipfs/${META_PATH}`]: { status: 200, body: METADATA_4632 },
      },
      seen,
    ),
    readTokenUri: async () => assert.fail('indexer tokenURI is content-addressed; no RPC read needed'),
  });
  assert.equal(url, EXPECTED);
  assert.deepEqual(seen, [`https://ipfs.filebase.io/ipfs/${META_PATH}`, `https://gateway.pinata.cloud/ipfs/${META_PATH}`]);
});

test('skips a non-JSON gateway answer (ipfs.io service-worker page)', async () => {
  const url = await resolveProtectedNftImage(
    { chainId: 1, contract: LIL_MUTANTS, tokenId: '4632', standard: 'ERC-721', tokenUri: `ipfs://${META_PATH}` },
    {
      fetchImpl: fakeFetch({
        [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 200, body: 'switching to a service worker gateway' },
        [`https://gateway.pinata.cloud/ipfs/${META_PATH}`]: { status: 200, body: METADATA_4632 },
      }),
    },
  );
  assert.equal(url, EXPECTED);
});

test('reads tokenURI on-chain (read-only) when the indexer did not report one', async () => {
  let reads = 0;
  const url = await resolveProtectedNftImage(
    { chainId: 1, contract: LIL_MUTANTS, tokenId: '4632', standard: 'ERC-721', imageUrl: 'https://i2c.seadn.io/x.png' },
    {
      fetchImpl: fakeFetch({ [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 200, body: METADATA_4632 } }),
      readTokenUri: async () => {
        reads += 1;
        return `ipfs://${META_PATH}`;
      },
    },
  );
  assert.equal(reads, 1);
  assert.equal(url, EXPECTED);
});

test('keeps the protected rule: https tokenURI or https metadata image gives no image', async () => {
  assert.equal(
    await resolveProtectedNftImage(
      { chainId: 1, contract: LIL_MUTANTS, tokenId: '1', standard: 'ERC-721', tokenUri: 'https://api.example.com/1.json' },
      { fetchImpl: fakeFetch({}), readTokenUri: async () => 'https://api.example.com/1.json' },
    ),
    null,
  );
  assert.equal(
    await resolveProtectedNftImage(
      { chainId: 1, contract: LIL_MUTANTS, tokenId: '1', standard: 'ERC-721', tokenUri: `ipfs://${META_PATH}` },
      {
        fetchImpl: fakeFetch({
          [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 200, body: JSON.stringify({ image: 'https://evil.example/claim.png' }) },
        }),
      },
    ),
    null,
  );
  assert.equal(
    await resolveProtectedNftImage(
      { chainId: 1, contract: LIL_MUTANTS, tokenId: '1', standard: 'ERC-721', tokenUri: `ipfs://${META_PATH}` },
      {
        fetchImpl: fakeFetch({
          [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 200, body: JSON.stringify({ image: `ipfs://${'Qm'.padEnd(46, 'a')}/x.svg` }) },
        }),
      },
    ),
    null,
  );
});

test('an indexer image that is already content-addressed is used directly (no fetch)', async () => {
  const url = await resolveProtectedNftImage(
    { chainId: 1, contract: LIL_MUTANTS, tokenId: '4632', standard: 'ERC-721', imageOriginal: `ipfs://${IMAGE_PATH}` },
    { fetchImpl: async () => assert.fail('no fetch'), readTokenUri: async () => assert.fail('no rpc') },
  );
  assert.equal(url, EXPECTED);
});

test('transient failure is not cached; success is', async () => {
  clearProtectedNftImageCache();
  const item = { chainId: 1 as const, contract: LIL_MUTANTS, tokenId: '4632', standard: 'ERC-721' as const, tokenUri: `ipfs://${META_PATH}` };
  assert.equal(await resolveProtectedNftImageCached(item, { fetchImpl: fakeFetch({}) }), null);
  let calls = 0;
  const ok = fakeFetch({ [`https://ipfs.filebase.io/ipfs/${META_PATH}`]: { status: 200, body: METADATA_4632 } });
  const counting = async (url: string) => {
    calls += 1;
    return ok(url);
  };
  assert.equal(await resolveProtectedNftImageCached(item, { fetchImpl: counting }), EXPECTED);
  assert.equal(await resolveProtectedNftImageCached(item, { fetchImpl: counting }), EXPECTED);
  assert.equal(calls, 1);
  clearProtectedNftImageCache();
});

test('ERC-1155 {id} substitution', () => {
  assert.equal(expandErc1155Uri('ipfs://Qm/{id}.json', '10'), `ipfs://Qm/${'a'.padStart(64, '0')}.json`);
  assert.equal(expandErc1155Uri('ipfs://Qm/1.json', '10'), 'ipfs://Qm/1.json');
});

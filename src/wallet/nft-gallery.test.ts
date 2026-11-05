import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAlchemyNfts } from './alchemy';
import { buildNftGallery, reconcileNftFetch } from './nft-gallery';
import { nftImageCandidates, protectedNftImageUrl } from './nft-media';
import { nftStorageKey } from './nft-spam';
import { fetchNfts, parseBlockscoutNfts, type NftItem } from './nfts';

const OWNER = '0x640Ebc069e89e5691AaD192420D22a4B92443387';
const LIL_MUTANTS = '0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED';

// Exact eth.blockscout.com /addresses/0x640E…3387/nft item for Lil Mutants #4632 (read Nov 4 2026).
const BLOCKSCOUT_4632 = {
  id: '4632',
  image_url: 'https://gateway.pinata.cloud/ipfs/QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28/4632.png',
  animation_url: '',
  external_app_url: 'https://lilmutantapeclub.com',
  token_type: 'ERC-721',
  metadata: { name: '#4632', image: 'https://gateway.pinata.cloud/ipfs/QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28/4632.png' },
  token: { address_hash: LIL_MUTANTS, name: 'LMACEXPERIMENT', symbol: 'LMAC', type: 'ERC-721' },
};

// Alchemy shape for the same token: CDN-only image, no raw metadata, tokenUri on IPFS.
const ALCHEMY_4632 = {
  contract: { address: LIL_MUTANTS, name: 'LMACEXPERIMENT', tokenType: 'ERC721' },
  tokenId: '4632',
  tokenType: 'ERC721',
  name: null,
  image: { cachedUrl: 'https://nft-cdn.alchemy.com/eth-mainnet/abc', originalUrl: 'https://i2c.seadn.io/ethereum/abc/4632.png' },
  tokenUri: 'ipfs://QmPmMzbSLMBhs4bRQmJp4LbMFvbAqRj1tHhR3dJd7N5Jgk/4632.json',
  raw: { tokenUri: 'ipfs://QmPmMzbSLMBhs4bRQmJp4LbMFvbAqRj1tHhR3dJd7N5Jgk/4632.json', metadata: {} },
};

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function findOwned(items: NftItem[]) {
  return items.find((i) => i.contract.toLowerCase() === LIL_MUTANTS.toLowerCase() && i.tokenId === '4632');
}

test('#4632 Blockscout shape: fetched, visible, with an IPFS image', async () => {
  const result = await fetchNfts(OWNER, 1, async () => json({ items: [BLOCKSCOUT_4632] }), 1000, null);
  const item = findOwned(result.items);
  assert.ok(item, 'owned protected NFT dropped by the parser');
  const gallery = buildNftGallery(result.items, new Set(), new Set());
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].risk.hidden, false);
  assert.equal(gallery[0].risk.verified, true);
  assert.match(protectedNftImageUrl(item) ?? '', /QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28\/4632\.png$/);
});

test('#4632 Alchemy shape (CDN-only image, no metadata, null name): kept and visible', () => {
  const items = parseAlchemyNfts([ALCHEMY_4632] as never, 1);
  const item = findOwned(items);
  assert.ok(item, 'owned protected NFT dropped by the Alchemy parser');
  assert.equal(buildNftGallery(items, new Set(), new Set())[0].risk.hidden, false);
});

test('a manually hidden protected NFT stays listed in the labeled Hidden section', () => {
  const items = parseBlockscoutNfts([BLOCKSCOUT_4632] as never, 1);
  const gallery = buildNftGallery(items, new Set(), new Set([nftStorageKey(items[0])]));
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].risk.hidden, true);
  assert.equal(gallery[0].risk.hiddenByYou, true);
  assert.equal(gallery[0].risk.verified, true);
  assert.match(gallery[0].risk.reasons[0], /Hidden by you/);
});

test('a protected NFT with no usable image still shows (placeholder), not hidden or dropped', () => {
  const bare = { ...BLOCKSCOUT_4632, image_url: undefined, metadata: { name: '#4632' } };
  const items = parseBlockscoutNfts([bare] as never, 1);
  assert.equal(items.length, 1);
  assert.equal(buildNftGallery(items, new Set(), new Set())[0].risk.hidden, false);
  assert.equal(protectedNftImageUrl(items[0]), null);
  assert.deepEqual(nftImageCandidates(undefined), []); // SafeNftImage renders the NFT placeholder
});

test('unverified tokens still follow the spam rules', () => {
  const junk = { ...BLOCKSCOUT_4632, id: '1', token: { ...BLOCKSCOUT_4632.token, address_hash: '0x0000000000000000000000000000000000000001', name: 'Airdrop' } };
  const items = parseBlockscoutNfts([junk] as never, 1);
  assert.equal(buildNftGallery(items, new Set(), new Set())[0].risk.hidden, true);
});

test('catalog outage keeps the last list that loaded (no empty tab)', async () => {
  const lastGood = parseBlockscoutNfts([BLOCKSCOUT_4632] as never, 1);
  for (const status of [403, 429, 500, 502]) {
    const down = await fetchNfts(OWNER, 1, async () => json({}, status), 1000, null);
    assert.equal(down.autodetect, 'unavailable');
    const shown = reconcileNftFetch(down, lastGood);
    assert.ok(findOwned(shown.items), `#4632 vanished on HTTP ${status}`);
    assert.equal(shown.fromCache, true);
  }
  const thrown = await fetchNfts(OWNER, 1, async () => { throw new Error('timeout'); }, 1000, null);
  assert.ok(findOwned(reconcileNftFetch(thrown, lastGood).items));
});

test('a fresh ok answer replaces the cache (sold NFT leaves the list)', () => {
  const lastGood = parseBlockscoutNfts([BLOCKSCOUT_4632] as never, 1);
  assert.equal(reconcileNftFetch({ items: [], autodetect: 'ok' }, lastGood).items.length, 0);
});

test('Ethereum falls back to Alchemy when Blockscout is down and a key exists', async () => {
  const urls: string[] = [];
  const result = await fetchNfts(OWNER, 1, async (url) => {
    urls.push(url);
    return url.includes('blockscout') ? json({}, 503) : json({ ownedNfts: [ALCHEMY_4632] });
  }, 1000, 'test-key');
  assert.ok(findOwned(result.items));
  assert.equal(urls.length, 2);
});

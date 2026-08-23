import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyNftSpam, famousMatch, nftStorageKey } from './nft-spam';
import { type NftItem } from './nfts';

const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';

function item(overrides: Partial<NftItem> = {}): NftItem {
  return {
    chainId: 1,
    contract: '0x0000000000000000000000000000000000000001',
    tokenId: '1',
    standard: 'ERC-721',
    name: 'One',
    collection: 'Random Drops',
    ...overrides,
  };
}

test('hides unknown collections and missing images by default', () => {
  const hidden = classifyNftSpam(item(), new Set());
  assert.equal(hidden.hidden, true);
  assert.ok(hidden.reasons.length >= 1);
});

test('hides famous-name impersonation on a non-canonical contract', () => {
  const fake = classifyNftSpam(
    item({
      name: 'Bored Ape #1',
      collection: 'Bored Ape Yacht Club',
      imageUrl: 'https://example.com/ape.png',
    }),
    new Set(),
  );
  assert.equal(fake.impersonation, true);
  assert.equal(fake.hidden, true);
  assert.equal(famousMatch('Bored Ape', 'BAYC', BAYC).canonical, true);
  assert.equal(famousMatch('Bored Ape', 'BAYC', '0x0000000000000000000000000000000000000001').impersonation, true);
});

test('shows a canonical famous collection with a safe image', () => {
  const real = classifyNftSpam(
    item({
      contract: BAYC,
      name: 'Bored Ape',
      collection: 'Bored Ape Yacht Club',
      imageUrl: 'https://example.com/ape.png',
    }),
    new Set(),
  );
  assert.equal(real.hidden, false);
  assert.equal(real.canonical, true);
});

test('Show anyway unhides a specific token only', () => {
  const nft = item({ collection: 'NFT' });
  const key = nftStorageKey(nft);
  assert.equal(classifyNftSpam(nft, new Set()).hidden, true);
  assert.equal(classifyNftSpam(nft, new Set([key])).hidden, false);
});

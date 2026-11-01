import assert from 'node:assert/strict';
import test from 'node:test';

import { groupNftsByCollection, mergeNftLists, normalizeNftStandard, parseBlockscoutNfts } from './nfts';

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

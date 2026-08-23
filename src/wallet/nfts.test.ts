import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNftStandard, parseBlockscoutNfts } from './nfts';

test('parses Blockscout NFT payloads', () => {
  assert.equal(normalizeNftStandard('ERC-721'), 'ERC-721');
  assert.equal(normalizeNftStandard('ERC1155'), 'ERC-1155');
  const items = parseBlockscoutNfts(
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
  assert.equal(items.length, 1);
  assert.equal(items[0]?.tokenId, '7');
  assert.equal(items[0]?.name, 'One');
});

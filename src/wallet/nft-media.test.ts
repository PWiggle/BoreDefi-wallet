import assert from 'node:assert/strict';
import test from 'node:test';

import { safeNftImageUrl } from './nft-media';

test('allows https images and ipfs via an https gateway', () => {
  assert.equal(
    safeNftImageUrl('https://example.com/a.png'),
    'https://example.com/a.png',
  );
  assert.equal(
    safeNftImageUrl('ipfs://bafybeigdyrzt5sfp7udm2hu3vp2j6z7q4x2q/image.png'),
    'https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm2hu3vp2j6z7q4x2q/image.png',
  );
});

test('rejects non-https, scripts, and SVG documents', () => {
  assert.equal(safeNftImageUrl('http://example.com/a.png'), null);
  assert.equal(safeNftImageUrl('javascript:alert(1)'), null);
  assert.equal(safeNftImageUrl('data:image/svg+xml,<svg></svg>'), null);
  assert.equal(safeNftImageUrl('https://example.com/token.svg'), null);
  assert.equal(safeNftImageUrl('ipfs://cid/art.svg'), null);
});

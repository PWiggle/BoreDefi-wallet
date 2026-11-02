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

import { ipfsContentPath, protectedNftImageUrl } from './nft-media';

test('protected images only load content-addressed IPFS through the wallet gateway', () => {
  const cid = 'QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq';
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}` }), `https://ipfs.io/ipfs/${cid}`);
  assert.equal(protectedNftImageUrl({ imageUrl: `https://gateway.pinata.cloud/ipfs/${cid}/1.png` }), `https://ipfs.io/ipfs/${cid}/1.png`);
  assert.equal(protectedNftImageUrl({ imageUrl: 'https://evil.example/ape.png' }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: 'ipfs://not-a-cid/x.png' }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}/../x` }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}/a.svg` }), null);
  assert.equal(ipfsContentPath('https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/1.png'), 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png');
});

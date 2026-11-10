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
    'https://ipfs.filebase.io/ipfs/bafybeigdyrzt5sfp7udm2hu3vp2j6z7q4x2q/image.png',
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
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}` }), `https://ipfs.filebase.io/ipfs/${cid}`);
  assert.equal(protectedNftImageUrl({ imageUrl: `https://gateway.pinata.cloud/ipfs/${cid}/1.png` }), `https://ipfs.filebase.io/ipfs/${cid}/1.png`);
  assert.equal(protectedNftImageUrl({ imageUrl: 'https://evil.example/ape.png' }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: 'ipfs://not-a-cid/x.png' }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}/../x` }), null);
  assert.equal(protectedNftImageUrl({ imageOriginal: `ipfs://${cid}/a.svg` }), null);
  assert.equal(ipfsContentPath('https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/1.png'), 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png');
});

import { IPFS_GATEWAYS, nftImageCandidates } from './nft-media';

const LIL_MUTANT_4632 = 'QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28/4632.png';
const BAYC_0 = 'QmRRPWG96cmgTn2qSzjwr2qvfNEuhunv6FNeMFGa9bx6mQ';

test('ipfs.io is never the first gateway (it answers 429 text instead of images)', () => {
  assert.notEqual(IPFS_GATEWAYS[0], 'https://ipfs.io/ipfs/');
  assert.equal(IPFS_GATEWAYS[IPFS_GATEWAYS.length - 1], 'https://ipfs.io/ipfs/');
});

test('IPFS images get every gateway in order, so a failed load tries the next one', () => {
  assert.deepEqual(nftImageCandidates(`ipfs://${LIL_MUTANT_4632}`), [
    `https://ipfs.filebase.io/ipfs/${LIL_MUTANT_4632}`,
    `https://gateway.pinata.cloud/ipfs/${LIL_MUTANT_4632}`,
    `https://ipfs.io/ipfs/${LIL_MUTANT_4632}`,
  ]);
});

test('an ipfs.io URL from metadata is rewritten to our gateways first', () => {
  const candidates = nftImageCandidates(`https://ipfs.io/ipfs/${BAYC_0}`);
  assert.equal(candidates[0], `https://ipfs.filebase.io/ipfs/${BAYC_0}`);
  assert.equal(candidates.length, 3);
});

test('a third-party gateway URL on a normal NFT is kept as the last try', () => {
  const raw = `https://nftstorage.link/ipfs/${BAYC_0}`;
  const candidates = nftImageCandidates(raw);
  assert.equal(candidates[0], `https://ipfs.filebase.io/ipfs/${BAYC_0}`);
  assert.equal(candidates[candidates.length - 1], raw);
});

test('protected NFT images stay on our gateways and the CID path only', () => {
  const url = protectedNftImageUrl({ imageUrl: `https://evil-cdn.example/ipfs/${LIL_MUTANT_4632}` });
  assert.equal(url, `https://ipfs.filebase.io/ipfs/${LIL_MUTANT_4632}`);
  const candidates = nftImageCandidates(url);
  assert.deepEqual(candidates, IPFS_GATEWAYS.map((gateway) => `${gateway}${LIL_MUTANT_4632}`));
  assert.ok(candidates.every((candidate) => IPFS_GATEWAYS.some((gateway) => candidate.startsWith(gateway))));
  assert.equal(protectedNftImageUrl({ imageUrl: 'https://evil.example/ape.png' }), null);
});

test('plain https images are tried once; unsafe ones never', () => {
  assert.deepEqual(nftImageCandidates('https://example.com/a.png'), ['https://example.com/a.png']);
  assert.deepEqual(nftImageCandidates('http://example.com/a.png'), []);
  assert.deepEqual(nftImageCandidates('ipfs://cid/art.svg'), []);
  assert.deepEqual(nftImageCandidates(null), []);
});

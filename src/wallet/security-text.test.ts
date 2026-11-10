import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyNftSpam, displayNftName } from './nft-spam';
import type { NftItem } from './nfts';
import { containsBait, containsUrl, neutralizeUrls, spamTextReasons } from './security/text-safety';

const base: NftItem = { chainId: 1, contract: '0x0000000000000000000000000000000000000001', tokenId: '1', standard: 'ERC-721', name: 'Cool art', collection: 'Some Art', imageUrl: 'https://example.com/a.png' };

test('urls and bait words are detected', () => {
  for (const t of ['Visit claim-eth.xyz', 'https://x.io', 'www.free.com', 'usdc-reward.net', '$1000 USDC voucher']) {
    assert.ok(containsUrl(t) || containsBait(t), t);
  }
  for (const t of ['Lil Mutants #4632', 'USDC', 'Bored Ape Yacht Club', 'Jupiter']) {
    assert.deepEqual(spamTextReasons(t), [], t);
  }
});

test('neutralized text has no tappable link left', () => {
  const out = neutralizeUrls('Claim at https://evil.xyz/claim or www.evil.com');
  assert.ok(!/https?:\/\//.test(out));
  assert.ok(!/evil\.xyz/.test(out));
  assert.ok(!containsUrl(out));
});

test('unverified NFT with a link or bait word is spam and stays hidden even after Show anyway', () => {
  for (const name of ['Visit usdc-airdrop.com', 'Claim your reward', '10,000 USDT voucher']) {
    const item = { ...base, name };
    const key = `1:${base.contract}:1`;
    const risk = classifyNftSpam(item, new Set([key]));
    assert.equal(risk.hidden, true, name);
    assert.ok(!displayNftName(item).includes('usdc-airdrop.com'));
  }
});

test('verified / protected NFTs are never flagged by bait rules', () => {
  const item = { ...base, contract: '0x3B45542f6C97FE7f7aA3BB055c95e93B2c0437ED', name: 'Claim airdrop at x.com', tokenId: '4632' };
  const risk = classifyNftSpam(item, new Set());
  assert.equal(risk.hidden, false);
  assert.equal(risk.verified, true);
});

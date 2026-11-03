import assert from 'node:assert/strict';
import test from 'node:test';

import { getAddress } from 'ethers';

import { classifyNftSpam, displayCollectionName, displayNftName } from './nft-spam';
import type { NftItem } from './nfts';
import {
  FAKE_LABEL,
  PROTECTED_ASSETS,
  foldBrandText,
  protectedAssetFor,
  yugaLookalikeMatch,
} from './yuga-allowlist';

// Every value below was checked on-chain (name()/symbol()/supportsInterface) and against OpenSea's
// verified collection on Nov 1, 2026. A change here must be re-verified, never guessed.
const EXPECTED: Record<string, [number, string]> = {
  bayc: [1, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'],
  mayc: [1, '0x60E4d786628Fea6478F785A6d7e704777c86a7c6'],
  bakc: [1, '0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623'],
  bacc: [1, '0x22c36BfdCef207F9c0CC941936eff94D4246d14A'],
  otherdeed: [1, '0x34d85c9CDeB23FA97cb08333b511ac86E1C4E258'],
  'otherdeed-expanded': [1, '0x790B2cF29Ed4F310bf7641f013C65D4560d28371'],
  koda: [1, '0xE012Baf811CF9c05c408e879C399960D1f305903'],
  kodamara: [1, '0x56e6F1BFFde5DCcd9A183585cE31f2902FC52707'],
  mara: [1, '0x3Bdca51226202Fc2a64211Aa35A8d95D61C6ca99'],
  vessels: [1, '0x5b1085136a811e55b2Bb2CA1eA456bA82126A376'],
  catalyst: [1, '0x41e4a828630dD4729fC010E9483CD900bb37FC79'],
  'ship-parts': [1, '0xDA98Cf8b3c6C4E05d568e6D38752cB6097414aB0'],
  'partner-loot': [1, '0x307b00dd72A29e0828b52947a2AdcD9e899167c9'],
  'sewer-pass': [1, '0x764AeebcF425d56800eF2c84F2578689415a2DAa'],
  'hv-mtl': [1, '0x4b15a9c28034dC83db40CD810001427d3BD7163D'],
  meebits: [1, '0x7Bd29408f11D2bFC23c34f18275bBf23bB716Bc7'],
  cryptopunks: [1, '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'],
  'wrapped-punks': [1, '0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6'],
  'v1-punks': [1, '0x282BDD42f4eb70e7A9D9F40c8fEA0825B7f68C5D'],
  '10ktf': [1, '0x0Cfb5d82BE2b949e8fa73A656dF91821E2aD99FD'],
  '10ktf-stockroom': [1, '0x7DaEC605E9e2a1717326eeDFd660601e2753A057'],
  'ape-eth': [1, '0x4d224452801ACEd8B2F0aebE155379bb5D594381'],
  'ape-arb': [42161, '0x7f9FBf9bDd3F4105C478b996B648FE6e828a1e98'],
  'ape-bsc': [56, '0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79'],
  // ApeChain, checked on-chain Nov 3, 2026 (name/symbol, ERC-721 interface, shared owner(), deployers match Ethereum).
  'bayc-apechain': [33139, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'],
  'mayc-apechain': [33139, '0x60E4d786628Fea6478F785A6d7e704777c86a7c6'],
  'bakc-apechain': [33139, '0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623'],
  'koda-apechain': [33139, '0xE012Baf811CF9c05c408e879C399960D1f305903'],
  'otherdeed-expanded-apechain': [33139, '0x000DeeD0005b8b7d8d87BAcA43AAD032A292155E'],
  'punks-apechain': [33139, '0x000000000000a548CF4a87c15191945473068153'],
  'wape-apechain': [33139, '0x48b62137EdfA95a428D35C09E44256a739F6B557'],
};

test('allowlist matches the verified list exactly, EIP-55 checksummed', () => {
  assert.equal(PROTECTED_ASSETS.length, Object.keys(EXPECTED).length);
  for (const asset of PROTECTED_ASSETS) {
    const expected = EXPECTED[asset.key];
    assert.ok(expected, `unexpected entry ${asset.key}`);
    assert.equal(asset.chainId, expected[0], asset.key);
    assert.equal(asset.address, expected[1], asset.key);
    assert.equal(getAddress(asset.address), asset.address, `${asset.key} checksum`);
    assert.ok(asset.source.length > 0);
  }
  const keys = new Set(PROTECTED_ASSETS.map((item) => `${item.chainId}:${item.address.toLowerCase()}`));
  assert.equal(keys.size, PROTECTED_ASSETS.length, 'no duplicates');
});

test('lookup is by chain + address only, case-insensitive', () => {
  assert.equal(protectedAssetFor(1, '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d')?.key, 'bayc');
  assert.equal(protectedAssetFor(137, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'), null);
  assert.equal(protectedAssetFor(42161, '0x7f9fbf9bdd3f4105c478b996b648fe6e828a1e98')?.key, 'ape-arb');
  assert.equal(protectedAssetFor(1, 'not-an-address'), null);
});

test('lookalike detection: positives', () => {
  const fakes = [
    'Bored Ape Yacht Club',
    'B O R E D  A P E',
    'BoredApe Rewards',
    'bayc airdrop',
    'B4YC Claim',
    'Bоred Аpe', // Cyrillic о and А
    'ΒΑΥC', // Greek capitals
    'M.A.Y.C',
    'Mutant Ape Serum',
    'Yacht-Club Pass',
    'Otherdeed v2',
    'OTHERSIDE land',
    'Koda Pass',
    'Yuga Labs Gift',
    'ApeCoin Voucher',
    'Kennel Club',
    'Sewer Pass',
    'HV MTL',
    'Meebits Claim',
    'CryptoPunks V3',
    'Punks Airdrop',
    'Bored\u200BApe',
    'ＢＡＹＣ', // fullwidth
    'Böred Âpe',
    '10KTF Gift',
  ];
  for (const name of fakes) {
    assert.ok(yugaLookalikeMatch(name), `should flag ${name}`);
  }
});

test('lookalike detection: negatives', () => {
  for (const name of ['Azuki', 'Pudgy Penguins', 'Doodles', 'Nouns', 'Art Blocks', 'Bored Cat', 'Apple', 'Board Game', 'Chromie Squiggle']) {
    assert.equal(yugaLookalikeMatch(name), null, `should not flag ${name}`);
  }
  assert.equal(foldBrandText('B.A.Y.C'), 'bayc');
});

function nft(overrides: Partial<NftItem>): NftItem {
  return {
    chainId: 1,
    contract: '0x0000000000000000000000000000000000000001',
    tokenId: '1',
    standard: 'ERC-721',
    name: 'Bored Ape #1',
    collection: 'Bored Ape Yacht Club',
    imageUrl: 'https://example.com/a.png',
    ...overrides,
  };
}

test('fake BAYC on another contract is hidden with the Fake label, even after Show anyway', () => {
  const item = nft({});
  const risk = classifyNftSpam(item, new Set([`1:${item.contract}:1`]));
  assert.equal(risk.hidden, true);
  assert.equal(risk.fake, true);
  assert.equal(risk.label, FAKE_LABEL);
  assert.equal(risk.verified, false);
});

test('real collections are Verified, never hidden, and show the verified name over metadata', () => {
  const real = nft({
    contract: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6',
    name: 'FREE CLAIM visit evil.site',
    collection: 'Totally Not MAYC',
    imageUrl: undefined,
    tokenId: '42',
  });
  const risk = classifyNftSpam(real, new Set());
  assert.equal(risk.verified, true);
  assert.equal(risk.hidden, false);
  assert.equal(risk.label, 'Verified');
  assert.equal(displayNftName(real), 'Mutant Ape Yacht Club #42');
  assert.equal(displayCollectionName(real), 'Mutant Ape Yacht Club');
  // Same address on the wrong chain is not verified.
  assert.equal(classifyNftSpam({ ...real, chainId: 137 }, new Set()).verified, false);
});

test('ERC-1155 BACC is verified', () => {
  const serum = nft({ contract: '0x22c36BfdCef207F9c0CC941936eff94D4246d14A', standard: 'ERC-1155', name: 'M1 Mutant Serum', collection: 'BACC' });
  assert.equal(classifyNftSpam(serum, new Set()).verified, true);
});

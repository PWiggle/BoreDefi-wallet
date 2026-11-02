import assert from 'node:assert/strict';
import test from 'node:test';

import { MaxUint256, parseEther, parseUnits } from 'ethers';

import { CHAIN_LIST } from './chains';
import { actionsForMarket, geckoIdForToken, portfolioTokensForChain, portfolioUsdTotal } from './markets';
import { analyzeProtectedRequest } from './protected-guard';
import { protectedApproveRequest, protectedTokenAsset, protectedTransferRequest } from './protected-spend';
import { checkSwapPrice } from './swap-guard';
import { tokensForChain, type TokenConfig } from './tokens';

const OWNER = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'; // LI.FI diamond
const APE = {
  1: '0x4d224452801ACEd8B2F0aebE155379bb5D594381',
  42161: '0x7f9FBf9bDd3F4105C478b996B648FE6e828a1e98',
  56: '0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79',
} as const;

function find(chainId: keyof typeof APE | 137 | 43114 | 8453, symbol: string): TokenConfig {
  const token = tokensForChain(chainId).find((item) => item.symbol === symbol);
  assert.ok(token, `${symbol} on ${chainId}`);
  return token;
}

test('Home lists every TOKENS entry for the chain, not only native + stables', () => {
  for (const chain of CHAIN_LIST) {
    assert.deepEqual(portfolioTokensForChain(chain.id), tokensForChain(chain.id));
  }
  assert.deepEqual(portfolioTokensForChain(137).map((item) => item.symbol), ['POL', 'WPOL', 'WETH', 'USDC', 'USDT']);
  assert.deepEqual(portfolioTokensForChain(56).map((item) => item.symbol), ['BNB', 'WBNB', 'USDC', 'USDT', 'APE']);
  assert.deepEqual(portfolioTokensForChain(43114).map((item) => item.symbol), ['AVAX', 'WAVAX', 'USDC', 'USDT']);
});

test('every wallet token has a CoinGecko id that BoreDash / CoinGecko price', () => {
  for (const chain of CHAIN_LIST) {
    for (const token of tokensForChain(chain.id)) {
      assert.ok(geckoIdForToken(token), `${token.symbol} on ${chain.id} has no price id`);
    }
  }
  assert.equal(geckoIdForToken(find(1, 'WETH')), 'weth');
  assert.equal(geckoIdForToken(find(137, 'WETH')), 'weth');
  assert.equal(geckoIdForToken(find(1, 'stETH')), 'staked-ether');
  assert.equal(geckoIdForToken(find(137, 'WPOL')), 'wmatic');
  assert.equal(geckoIdForToken(find(56, 'WBNB')), 'wbnb');
  assert.equal(geckoIdForToken(find(43114, 'WAVAX')), 'wrapped-avax');
  for (const chainId of [1, 42161, 56] as const) {
    assert.equal(geckoIdForToken(find(chainId, 'APE')), 'apecoin');
  }
});

test('ApeCoin is a wallet token on Ethereum, Arbitrum and BNB Chain (18 decimals) and is Yuga-protected', () => {
  for (const chainId of [1, 42161, 56] as const) {
    const ape = find(chainId, 'APE');
    assert.equal(ape.address, APE[chainId]);
    assert.equal(ape.decimals, 18);
    assert.equal(ape.native, false);
    assert.equal(protectedTokenAsset(ape)?.standard, 'ERC-20');
  }
  assert.equal(tokensForChain(8453).some((item) => item.symbol === 'APE'), false);
  assert.equal(protectedTokenAsset(find(1, 'WETH')), null);
  assert.equal(protectedTokenAsset(tokensForChain(1)[0]!), null);
  assert.equal(actionsForMarket({ id: 'apecoin', symbol: 'APE' } as never, 1).swapSymbol, 'APE');
});

test('Home total sums every held token at its own price', () => {
  const eth = tokensForChain(1)[0]!;
  const total = portfolioUsdTotal([
    { token: eth, amount: parseEther('0.5'), priceUsd: 2000 },
    { token: find(1, 'WETH'), amount: parseEther('1'), priceUsd: 2001 },
    { token: find(1, 'USDC'), amount: parseUnits('25', 6), priceUsd: 1 },
    { token: find(1, 'APE'), amount: parseEther('100'), priceUsd: 0.11 },
    { token: find(1, 'stETH'), amount: 0n, priceUsd: null },
  ]);
  assert.ok(total !== null && Math.abs(total - (1000 + 2001 + 25 + 11)) < 1e-6);
  // A held token without a price makes the total unknown instead of silently low.
  assert.equal(portfolioUsdTotal([{ token: eth, amount: 1n, priceUsd: 2000 }, { token: find(1, 'APE'), amount: 1n, priceUsd: null }]), null);
  assert.equal(portfolioUsdTotal([{ token: eth, amount: 0n, priceUsd: null }]), null);
  assert.equal(portfolioUsdTotal([{ token: eth, amount: 0n, priceUsd: 2000 }]), 0);
});

function verdict(request: ReturnType<typeof protectedApproveRequest>, allowed = false) {
  return analyzeProtectedRequest({
    ...request,
    approvalsAllowed: () => allowed,
    floorWei: () => null,
  });
}

test('in-app Swap/Bridge approve of APE goes through the Yuga guard: blocked by default, typed name when allowed', () => {
  for (const chainId of [1, 42161, 56] as const) {
    const ape = find(chainId, 'APE');
    const blocked = verdict(protectedApproveRequest(ape, OWNER, ROUTER, parseEther('10')));
    assert.equal(blocked.protected, true, `chain ${chainId}`);
    assert.equal(blocked.blocked, true);
    assert.match(blocked.blockReasons.join(' '), /Protected collections/);
    const allowed = verdict(protectedApproveRequest(ape, OWNER, ROUTER, parseEther('10')), true);
    assert.equal(allowed.blocked, false);
    assert.equal(allowed.protected, true);
    assert.match(allowed.confirmPhrase, /ApeCoin/);
  }
  const unlimited = verdict(protectedApproveRequest(find(1, 'APE'), OWNER, ROUTER, MaxUint256));
  assert.equal(unlimited.blocked, true);
  // WETH is not protected: no guard sheet.
  assert.equal(verdict(protectedApproveRequest(find(1, 'WETH'), OWNER, ROUTER, 1n)).protected, false);
});

test('Send APE is protected (red warning + typed name + PIN) but not blocked', () => {
  const v = verdict(protectedTransferRequest(find(1, 'APE'), OWNER, '0x2222222222222222222222222222222222222222', parseEther('5')));
  assert.equal(v.protected, true);
  assert.equal(v.blocked, false);
  assert.equal(v.findings[0]?.action, 'transfer');
  assert.equal(v.findings[0]?.counterparty, '0x2222222222222222222222222222222222222222');
  assert.equal(v.confirmPhrase, 'ApeCoin');
});

test('swap guard prices APE: a fair APE→USDC quote passes, a 50% short one is blocked', () => {
  const fair = checkSwapPrice({
    fromAmount: parseEther('1000'),
    fromDecimals: 18,
    toAmount: parseUnits('109.5', 6),
    toDecimals: 6,
    fromPriceUsd: 0.11,
    toPriceUsd: 1,
  });
  assert.equal(fair.ok, true);
  const bad = checkSwapPrice({
    fromAmount: parseEther('1000'),
    fromDecimals: 18,
    toAmount: parseUnits('55', 6),
    toDecimals: 6,
    fromPriceUsd: 0.11,
    toPriceUsd: 1,
  });
  assert.equal(bad.ok, false);
});

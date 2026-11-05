import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSolanaPortfolio, solanaGeckoIds } from './portfolio';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';
import { knownSolanaTokens } from './tokens';
import { isValidSolanaAddress } from './address';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const SPAM = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

test('allowlisted mints are valid addresses with unique symbols', () => {
  for (const cluster of ['mainnet-beta', 'devnet'] as const) {
    const tokens = knownSolanaTokens(cluster);
    assert.equal(new Set(tokens.map((t) => t.symbol)).size, tokens.length);
    for (const token of tokens) {
      assert.ok(isValidSolanaAddress(token.mint), token.symbol);
    }
  }
  // Locked: the real USDT mint ends in …wNYB (a look-alike ending …Q8b4 does not exist on-chain).
  assert.ok(knownSolanaTokens('mainnet-beta').some((t) => t.symbol === 'USDT' && t.mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'));
});

test('known tokens show, unknown and mismatched ones are hidden as possible spam', () => {
  const portfolio = buildSolanaPortfolio(
    5_000_000_000n,
    [
      { mint: USDC, account: 'a1', amount: 2_500_000n, decimals: 6, programId: TOKEN_PROGRAM_ID },
      { mint: USDC, account: 'a2', amount: 1n, decimals: 6, programId: TOKEN_PROGRAM_ID },
      { mint: PYUSD, account: 'p1', amount: 0n, decimals: 6, programId: TOKEN_2022_PROGRAM_ID },
      { mint: SPAM, account: 's1', amount: 1_000n, decimals: 0, programId: TOKEN_PROGRAM_ID },
      // Right mint, wrong program: never trusted.
      { mint: PYUSD, account: 'p2', amount: 9n, decimals: 6, programId: TOKEN_PROGRAM_ID },
    ],
    'mainnet-beta',
  );
  assert.equal(portfolio.sol, 5_000_000_000n);
  assert.deepEqual(portfolio.tokens.map((row) => [row.symbol, row.amount, row.account]), [['USDC', 2_500_000n, 'a1']]);
  assert.equal(portfolio.hiddenCount, 2);
  assert.deepEqual(solanaGeckoIds(portfolio), ['solana', 'usd-coin']);
  assert.deepEqual(solanaGeckoIds(null), ['solana']);
});

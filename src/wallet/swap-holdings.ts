import type { TokenConfig } from './tokens';

/**
 * From-token list for Swap: tokens the wallet holds (balance > 0) first, in list order, then the rest.
 * Until balances load (empty map) the list is unchanged, so the picker never flickers empty.
 */
export function holdingsFirst(tokens: TokenConfig[], balances: Record<string, bigint>): TokenConfig[] {
  const held = tokens.filter((token) => (balances[token.address.toLowerCase()] ?? 0n) > 0n);
  if (!held.length) {
    return tokens;
  }
  return [...held, ...tokens.filter((token) => !held.includes(token))];
}

import { SOLANA_CLUSTER, type SolanaCluster } from './config';
import { getSolBalance, getSplHoldings, solanaRpc, type SplHolding } from './rpc';
import { findKnownToken, SOL_DECIMALS, SOL_GECKO_ID, type SolanaTokenInfo } from './tokens';

export type SolanaTokenRow = SolanaTokenInfo & { amount: bigint; account: string };

export type SolanaPortfolio = {
  sol: bigint;
  tokens: SolanaTokenRow[];
  /** Non-allowlisted mints with a balance: hidden as possible spam. */
  hiddenCount: number;
};

/**
 * Keeps only allowlisted mints whose on-chain decimals and program match the allowlist, merging duplicate
 * accounts for the same mint by picking the largest (the associated account is normally the only one).
 */
export function buildSolanaPortfolio(sol: bigint, holdings: SplHolding[], cluster: SolanaCluster = SOLANA_CLUSTER): SolanaPortfolio {
  const byMint = new Map<string, SolanaTokenRow>();
  const hidden = new Set<string>();
  for (const holding of holdings) {
    const known = findKnownToken(holding.mint, cluster);
    if (!known || known.decimals !== holding.decimals || known.programId !== holding.programId) {
      if (holding.amount > 0n) {
        hidden.add(holding.mint);
      }
      continue;
    }
    const current = byMint.get(holding.mint);
    if (!current || holding.amount > current.amount) {
      byMint.set(holding.mint, { ...known, amount: holding.amount, account: holding.account });
    }
  }
  const tokens = [...byMint.values()].filter((row) => row.amount > 0n).sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { sol, tokens, hiddenCount: hidden.size };
}

export async function fetchSolanaPortfolio(owner: string, rpc = solanaRpc()): Promise<SolanaPortfolio> {
  const [sol, holdings] = await Promise.all([getSolBalance(owner, rpc), getSplHoldings(owner, rpc).catch(() => [] as SplHolding[])]);
  return buildSolanaPortfolio(sol, holdings);
}

export function solanaGeckoIds(portfolio: SolanaPortfolio | null): string[] {
  const ids = new Set<string>([SOL_GECKO_ID]);
  for (const row of portfolio?.tokens ?? []) {
    if (row.geckoId) ids.add(row.geckoId);
  }
  return [...ids];
}

export { SOL_DECIMALS };

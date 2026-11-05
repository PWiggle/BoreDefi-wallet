import { explorerTxUrl, SOLANA_CLUSTER, type SolanaCluster } from './config';
import { getRecentSignatures, solanaRpc, type SolanaRpcClient, type SolanaSignatureInfo } from './rpc';
import { findKnownToken, SOL_DECIMALS } from './tokens';

export type SolanaActivityItem = {
  signature: string;
  /** Unix seconds, or null while the block time is unknown. */
  blockTime: number | null;
  status: 'confirmed' | 'failed';
  direction: 'in' | 'out' | 'self';
  symbol: string;
  decimals: number;
  /** Amount moved (absolute, base units). For SOL sends this excludes the network fee. */
  amount: bigint;
  /** Network fee in lamports when this wallet paid it, else 0. */
  feeLamports: bigint;
  /** Other side of a simple transfer when it can be read, else null. */
  counterparty: string | null;
  explorerUrl: string;
  /** True when this wallet signed / paid the fee (its own action). */
  feePayer?: boolean;
  /** An unknown (unlisted) SPL mint landed in this wallet in this transaction. */
  unknownMintIn?: boolean;
};

/** Incoming SOL below this (0.001 SOL) from someone else is treated as dust, a common address-poisoning lure. */
export const SOLANA_DUST_LAMPORTS = 1_000_000n;

/**
 * Why a row is hidden by default (null = shown). Hidden: failed transactions someone else sent (spam), tiny
 * incoming SOL from others (dust / poisoning), and unknown tokens pushed into the wallet. Own actions always show.
 */
export function solanaActivityHiddenReason(item: SolanaActivityItem): string | null {
  if (item.feePayer) return null;
  if (item.status === 'failed') return 'Failed transaction sent by someone else';
  if (item.unknownMintIn) return 'Unknown token sent to you (possible spam)';
  if (item.direction === 'in' && item.symbol === 'SOL' && item.amount < SOLANA_DUST_LAMPORTS) return 'Dust (tiny amount from an unknown sender)';
  return null;
}

export function splitSolanaActivity(items: SolanaActivityItem[]): { shown: SolanaActivityItem[]; hidden: SolanaActivityItem[] } {
  const shown: SolanaActivityItem[] = [];
  const hidden: SolanaActivityItem[] = [];
  for (const item of items) (solanaActivityHiddenReason(item) ? hidden : shown).push(item);
  return { shown, hidden };
}

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };

export type ParsedTransaction = {
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
  transaction: {
    message: { accountKeys: Array<{ pubkey: string; signer?: boolean } | string> };
  };
};

function keyOf(entry: { pubkey: string } | string): string {
  return typeof entry === 'string' ? entry : entry.pubkey;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Turns one jsonParsed transaction into a wallet activity row, from the owner's point of view.
 * A known-token balance change wins over SOL (an SPL send also moves a little SOL for fees/rent);
 * otherwise the SOL change is shown, net of the fee this wallet paid.
 */
export function parseSolanaActivity(
  info: SolanaSignatureInfo,
  tx: ParsedTransaction | null,
  owner: string,
  cluster: SolanaCluster = SOLANA_CLUSTER,
): SolanaActivityItem {
  const base = {
    signature: info.signature,
    blockTime: tx?.blockTime ?? info.blockTime ?? null,
    status: (info.err || tx?.meta?.err ? 'failed' : 'confirmed') as SolanaActivityItem['status'],
    explorerUrl: explorerTxUrl(info.signature, cluster),
  };
  const empty: SolanaActivityItem = {
    ...base,
    direction: 'self',
    symbol: 'SOL',
    decimals: SOL_DECIMALS,
    amount: 0n,
    feeLamports: 0n,
    counterparty: null,
  };
  if (!tx?.meta) {
    return empty;
  }
  const keys = tx.transaction.message.accountKeys.map(keyOf);
  const index = keys.indexOf(owner);
  const feePayer = keys[0] === owner;
  const feeLamports = feePayer ? BigInt(tx.meta.fee) : 0n;
  const flags = { feePayer } as const;

  // Known-token change for accounts this wallet owns.
  const tokenDelta = new Map<string, { delta: bigint; decimals: number }>();
  const add = (rows: TokenBalance[] | null | undefined, sign: 1n | -1n) => {
    for (const row of rows ?? []) {
      if (row.owner !== owner || !/^\d+$/.test(row.uiTokenAmount.amount)) continue;
      const current = tokenDelta.get(row.mint) ?? { delta: 0n, decimals: row.uiTokenAmount.decimals };
      current.delta += sign * BigInt(row.uiTokenAmount.amount);
      tokenDelta.set(row.mint, current);
    }
  };
  add(tx.meta.postTokenBalances, 1n);
  add(tx.meta.preTokenBalances, -1n);
  const unknownMintIn = [...tokenDelta].some(([mint, { delta }]) => delta > 0n && !findKnownToken(mint, cluster));
  for (const [mint, { delta, decimals }] of tokenDelta) {
    const known = findKnownToken(mint, cluster);
    if (!known || delta === 0n) continue;
    const counterpartyRow = [...(tx.meta.postTokenBalances ?? [])].find((row) => row.mint === mint && row.owner && row.owner !== owner);
    return {
      ...base,
      direction: delta > 0n ? 'in' : 'out',
      symbol: known.symbol,
      decimals,
      amount: abs(delta),
      feeLamports,
      counterparty: counterpartyRow?.owner ?? null,
      ...flags,
      unknownMintIn,
    };
  }

  if (index < 0) {
    return { ...empty, feeLamports, ...flags, unknownMintIn };
  }
  const solDelta = BigInt(tx.meta.postBalances[index] ?? 0) - BigInt(tx.meta.preBalances[index] ?? 0);
  const net = solDelta + feeLamports; // add back the fee so a send shows what the other side got
  const direction: SolanaActivityItem['direction'] = net > 0n ? 'in' : net < 0n ? 'out' : 'self';
  let counterparty: string | null = null;
  for (let i = 0; i < keys.length; i += 1) {
    if (i === index) continue;
    const change = BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
    if (change !== 0n && (change > 0n) !== (net > 0n)) {
      counterparty = keys[i] ?? null;
      break;
    }
  }
  return { ...base, direction, symbol: 'SOL', decimals: SOL_DECIMALS, amount: abs(net), feeLamports, counterparty, ...flags, unknownMintIn };
}

/** Recent activity for the owner: signatures first, then each transaction (3 at a time for public RPC limits). */
export async function fetchSolanaActivity(owner: string, limit = 15, rpc: SolanaRpcClient = solanaRpc()): Promise<SolanaActivityItem[]> {
  const infos = await getRecentSignatures(owner, limit, rpc);
  const out: SolanaActivityItem[] = [];
  for (let i = 0; i < infos.length; i += 3) {
    const batch = infos.slice(i, i + 3);
    const txs = await Promise.all(
      batch.map((info) =>
        rpc<ParsedTransaction | null>('getTransaction', [
          info.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ]).catch(() => null),
      ),
    );
    batch.forEach((info, j) => out.push(parseSolanaActivity(info, txs[j] ?? null, owner)));
  }
  return out;
}

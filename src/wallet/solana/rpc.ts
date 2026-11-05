import { base64 } from '@scure/base';

import { logger } from '../../logger';
import { SOLANA_RPC_URLS } from './config';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';

export const SOLANA_RPC_TIMEOUT_MS = 8_000;

export class SolanaRpcError extends Error {
  code: number | undefined;
  data: unknown;
  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'SolanaRpcError';
    this.code = code;
    this.data = data;
  }
}

type Fetcher = typeof fetch;

export type SolanaRpcClient = <T>(method: string, params?: unknown[]) => Promise<T>;

/**
 * JSON-RPC over the free public endpoints, one request per call (public RPCs throttle batches).
 * Transport failures and HTTP 429/5xx fall through to the next endpoint; a JSON-RPC error from the
 * node (bad params, failed preflight) is final and is not retried elsewhere.
 */
export function createSolanaRpc(urls: string[] = SOLANA_RPC_URLS, fetcher: Fetcher = fetch): SolanaRpcClient {
  let id = 0;
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    let lastError: unknown = new Error('No Solana RPC configured.');
    for (const url of urls) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS) : null;
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: controller?.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
        if (payload.error) {
          throw new SolanaRpcError(payload.error.message ?? 'Solana RPC error', payload.error.code, payload.error.data);
        }
        return payload.result as T;
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw error;
        }
        lastError = error;
        // Never log the URL: a custom RPC URL can carry an API key.
        logger.error('Solana RPC endpoint failed', { method, message: error instanceof Error ? error.message : 'unknown' });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Solana RPC request failed.');
  };
}

let defaultRpc: SolanaRpcClient | null = null;
export function solanaRpc(): SolanaRpcClient {
  defaultRpc ??= createSolanaRpc();
  return defaultRpc;
}

type WithContext<T> = { context: { slot: number }; value: T };

export async function getSolBalance(address: string, rpc = solanaRpc()): Promise<bigint> {
  const result = await rpc<WithContext<number>>('getBalance', [address, { commitment: 'confirmed' }]);
  return BigInt(result.value);
}

export type SplHolding = {
  mint: string;
  /** The token account (not the owner). */
  account: string;
  amount: bigint;
  decimals: number;
  programId: string;
};

type ParsedTokenAccount = {
  pubkey: string;
  account: {
    owner: string;
    data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number }; state?: string } } };
  };
};

export function parseTokenAccounts(rows: ParsedTokenAccount[], programId: string): SplHolding[] {
  const out: SplHolding[] = [];
  for (const row of rows) {
    const info = row.account?.data?.parsed?.info;
    const amount = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;
    if (!info?.mint || typeof amount !== 'string' || !/^\d+$/.test(amount) || typeof decimals !== 'number') {
      continue;
    }
    if (info.state === 'frozen') {
      continue;
    }
    out.push({ mint: info.mint, account: row.pubkey, amount: BigInt(amount), decimals, programId });
  }
  return out;
}

/** All SPL Token and Token-2022 accounts the owner holds, with balances. */
export async function getSplHoldings(owner: string, rpc = solanaRpc()): Promise<SplHolding[]> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const results = await Promise.all(
    programs.map((programId) =>
      rpc<WithContext<ParsedTokenAccount[]>>('getTokenAccountsByOwner', [
        owner,
        { programId },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]).then((result) => parseTokenAccounts(result.value, programId)),
    ),
  );
  return results.flat();
}

export type AccountSummary = { exists: boolean; owner: string | null; lamports: bigint; parsedType: string | null };

export async function getAccountSummary(address: string, rpc = solanaRpc()): Promise<AccountSummary> {
  const result = await rpc<WithContext<{ owner: string; lamports: number; data: { parsed?: { type?: string } } | unknown } | null>>(
    'getAccountInfo',
    [address, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  );
  const value = result.value;
  if (!value) {
    return { exists: false, owner: null, lamports: 0n, parsedType: null };
  }
  const data = value.data as { parsed?: { type?: string } } | undefined;
  return {
    exists: true,
    owner: value.owner,
    lamports: BigInt(value.lamports),
    parsedType: (data && typeof data === 'object' && !Array.isArray(data) && data.parsed?.type) || null,
  };
}

export async function getLatestBlockhash(rpc = solanaRpc()): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await rpc<WithContext<{ blockhash: string; lastValidBlockHeight: number }>>('getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);
  return result.value;
}

export async function getRentExemptMinimum(dataLength: number, rpc = solanaRpc()): Promise<bigint> {
  return BigInt(await rpc<number>('getMinimumBalanceForRentExemption', [dataLength]));
}

/** Median of recent non-zero priority fees (micro-lamports per CU) for these writable accounts. */
export async function getPriorityFeeEstimate(accounts: string[], rpc = solanaRpc()): Promise<bigint> {
  const rows = await rpc<Array<{ slot: number; prioritizationFee: number }>>('getRecentPrioritizationFees', [accounts.slice(0, 128)]);
  return medianPriorityFee(rows.map((row) => row.prioritizationFee));
}

export function medianPriorityFee(values: number[]): bigint {
  const nonZero = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return 0n;
  }
  return BigInt(Math.round(nonZero[Math.floor(nonZero.length / 2)]!));
}

export type SimulationResult = { err: unknown; logs: string[]; unitsConsumed: number | null };

export async function simulateTransaction(wire: Uint8Array, rpc = solanaRpc()): Promise<SimulationResult> {
  const result = await rpc<WithContext<{ err: unknown; logs: string[] | null; unitsConsumed?: number }>>('simulateTransaction', [
    base64.encode(wire),
    { encoding: 'base64', commitment: 'confirmed', sigVerify: true, replaceRecentBlockhash: false },
  ]);
  return { err: result.value.err, logs: result.value.logs ?? [], unitsConsumed: result.value.unitsConsumed ?? null };
}

export async function sendRawTransaction(wire: Uint8Array, rpc = solanaRpc()): Promise<string> {
  return rpc<string>('sendTransaction', [
    base64.encode(wire),
    { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 },
  ]);
}

export type SignatureStatus = { confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown } | null;

export async function getSignatureStatus(signature: string, rpc = solanaRpc()): Promise<SignatureStatus> {
  const result = await rpc<WithContext<Array<SignatureStatus>>>('getSignatureStatuses', [[signature], { searchTransactionHistory: false }]);
  return result.value[0] ?? null;
}

export async function getBlockHeight(rpc = solanaRpc()): Promise<number> {
  return rpc<number>('getBlockHeight', [{ commitment: 'confirmed' }]);
}

export type SolanaSignatureInfo = { signature: string; blockTime: number | null; err: unknown; slot: number };

export async function getRecentSignatures(address: string, limit = 10, rpc = solanaRpc()): Promise<SolanaSignatureInfo[]> {
  return rpc<SolanaSignatureInfo[]>('getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }]);
}

import { logger } from '../logger';
import { fetchWalletUsdPrices } from './markets';

/**
 * Live gas (gwei) for the in-app Gas screen and the swap confirm fee.
 * Source order: the boredefi.com gas API (same numbers as boredefi.com/gas), then free public RPCs directly
 * (eth_feeHistory + eth_gasPrice). No keys, no paid APIs.
 */

export const GAS_API_BASE = 'https://www.boredefi.com';
export const GAS_API_TIMEOUT_MS = 6_000;
export const GAS_REFRESH_MS = 12_000;
export const GAS_HISTORY_REFRESH_MS = 5 * 60_000;

/** Free keyless Ethereum RPCs for the direct fallback (same as the site). */
export const GAS_ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.mevblocker.io',
] as const;
export const GAS_APE_RPCS = ['https://rpc.apechain.com', 'https://apechain.calderachain.xyz/http'] as const;

/** Typical gas units, same numbers as boredefi.com/gas. */
export const TYPICAL_ACTIONS = [
  { key: 'send', label: 'Send ETH', gas: 21_000 },
  { key: 'token', label: 'Token transfer', gas: 65_000 },
  { key: 'nft', label: 'NFT transfer', gas: 85_000 },
  { key: 'swap', label: 'Swap', gas: 180_000 },
] as const;

export type GasTier = { gwei: number; tipGwei: number };

export type GasSnapshot = {
  chainId: 1;
  updatedAt: number;
  latestBlock: number | null;
  baseFeeGwei: number;
  low: GasTier;
  average: GasTier;
  fast: GasTier;
  ethUsd: number | null;
  apeChain: { gasPriceGwei: number; apeUsd: number | null } | null;
  source: 'boredefi' | 'rpc';
};

export type FetchLikeFn = FetchLike;

export type GasHistoryPoint = { time: number; avgGwei: number; minGwei: number; maxGwei: number };
export type GasHistory = { points: GasHistoryPoint[]; coveredHours: number; source: 'boredefi' | 'rpc' };

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function tier(value: unknown): GasTier | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const gwei = num(record.gwei);
  if (gwei === null) {
    return null;
  }
  return { gwei, tipGwei: num(record.tipGwei) ?? 0 };
}

/** Validates the boredefi.com /api/gas payload. Throws on anything unexpected so the RPC fallback runs. */
export function parseGasApi(payload: unknown): GasSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gas API: not an object');
  }
  const record = payload as Record<string, unknown>;
  const low = tier(record.low);
  const average = tier(record.average);
  const fast = tier(record.fast);
  const baseFeeGwei = num(record.baseFeeGwei);
  if (!low || !average || !fast || baseFeeGwei === null || record.chainId !== 1) {
    throw new Error('Gas API: missing tiers');
  }
  const ape = record.apeChain && typeof record.apeChain === 'object' ? (record.apeChain as Record<string, unknown>) : null;
  const apeGas = ape ? num(ape.gasPriceGwei) : null;
  const updated = typeof record.updatedAt === 'string' ? Date.parse(record.updatedAt) : NaN;
  return {
    chainId: 1,
    updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    latestBlock: num(record.latestBlock),
    baseFeeGwei,
    low,
    average,
    fast,
    ethUsd: num(record.ethUsd),
    apeChain: apeGas === null ? null : { gasPriceGwei: apeGas, apeUsd: ape ? num(ape.apeUsd) : null },
    source: 'boredefi',
  };
}

export type FeeHistory = { baseFeePerGas: string[]; reward?: string[][]; oldestBlock?: string };

function hexNum(value: string | undefined | null): number {
  if (!value) {
    return 0;
  }
  try {
    return Number(BigInt(value));
  } catch {
    return 0;
  }
}

/** Median that ignores zero tips, so empty blocks do not drag the tip to 0 (same as the site). */
export function medianNonZero(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Low / Average / Fast from eth_feeHistory(N, latest, [10, 50, 90]): next block's base fee plus the
 * median 10th / 50th / 90th percentile tip. All in gwei.
 */
export function tiersFromFeeHistory(history: FeeHistory): { baseFeeGwei: number; low: GasTier; average: GasTier; fast: GasTier } {
  const bases = history.baseFeePerGas ?? [];
  if (!bases.length) {
    throw new Error('feeHistory: no base fees');
  }
  // The last entry is the next block's base fee.
  const nextBase = hexNum(bases[bases.length - 1]) / 1e9;
  const rewards = history.reward ?? [];
  const pick = (index: number) => medianNonZero(rewards.map((row) => hexNum(row[index]) / 1e9));
  const tips = [pick(0), pick(1), pick(2)];
  return {
    baseFeeGwei: nextBase,
    low: { gwei: nextBase + tips[0]!, tipGwei: tips[0]! },
    average: { gwei: nextBase + tips[1]!, tipGwei: tips[1]! },
    fast: { gwei: nextBase + tips[2]!, tipGwei: tips[2]! },
  };
}

/** One JSON-RPC call, trying each URL in order. */
export async function rpcCall<T>(
  urls: readonly string[],
  method: string,
  params: unknown[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<T> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await withTimeout(
        fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
        GAS_API_TIMEOUT_MS + 2_000,
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status ?? '?'}`);
      }
      const body = (await response.json()) as { result?: T; error?: { message?: string } };
      if (body.error) {
        throw new Error(body.error.message ?? 'RPC error');
      }
      if (body.result === undefined || body.result === null) {
        throw new Error('RPC: empty result');
      }
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RPC unavailable');
}

function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([run, limit]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await withTimeout(fetchImpl(url, { headers: { Accept: 'application/json' } }), GAS_API_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status ?? '?'}`);
  }
  return response.json();
}

/** ETH and APE in USD: BoreDash first, CoinGecko fallback (fetchMarketJson). */
export async function fetchEthApeUsd(): Promise<{ ethUsd: number | null; apeUsd: number | null }> {
  try {
    const prices = await fetchWalletUsdPrices(['ethereum', 'apecoin']);
    return { ethUsd: num(prices.ethereum), apeUsd: num(prices.apecoin) };
  } catch {
    return { ethUsd: null, apeUsd: null };
  }
}

/** Direct RPC fallback when the boredefi.com API is down. */
export async function fetchGasFromRpc(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  loadPrices: () => Promise<{ ethUsd: number | null; apeUsd: number | null }> = fetchEthApeUsd,
): Promise<GasSnapshot> {
  const [history, block, apeGas, prices] = await Promise.all([
    rpcCall<FeeHistory>(GAS_ETH_RPCS, 'eth_feeHistory', ['0x14', 'latest', [10, 50, 90]], fetchImpl),
    rpcCall<string>(GAS_ETH_RPCS, 'eth_blockNumber', [], fetchImpl).catch(() => null),
    rpcCall<string>(GAS_APE_RPCS, 'eth_gasPrice', [], fetchImpl).catch(() => null),
    loadPrices(),
  ]);
  const tiers = tiersFromFeeHistory(history);
  return {
    chainId: 1,
    updatedAt: Date.now(),
    latestBlock: block ? hexNum(block) : null,
    ...tiers,
    ethUsd: prices.ethUsd,
    apeChain: apeGas ? { gasPriceGwei: hexNum(apeGas) / 1e9, apeUsd: prices.apeUsd } : null,
    source: 'rpc',
  };
}

export async function fetchGasSnapshot(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  prices?: () => Promise<{ ethUsd: number | null; apeUsd: number | null }>,
): Promise<GasSnapshot> {
  try {
    return parseGasApi(await fetchJson(`${GAS_API_BASE}/api/gas`, fetchImpl));
  } catch (error) {
    logger.warn('gas: boredefi.com API failed, using public RPC', { error: String(error) });
  }
  return fetchGasFromRpc(fetchImpl, prices);
}

export function parseGasHistory(payload: unknown): GasHistory {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gas history: not an object');
  }
  const record = payload as Record<string, unknown>;
  const raw = Array.isArray(record.points) ? record.points : [];
  const points: GasHistoryPoint[] = [];
  for (const item of raw) {
    const point = item as Record<string, unknown>;
    const time = num(point.time);
    const avgGwei = num(point.avgGwei);
    if (time === null || avgGwei === null) {
      continue;
    }
    points.push({ time, avgGwei, minGwei: num(point.minGwei) ?? avgGwei, maxGwei: num(point.maxGwei) ?? avgGwei });
  }
  if (points.length < 2) {
    throw new Error('Gas history: too few points');
  }
  points.sort((a, b) => a.time - b.time);
  return { points, coveredHours: num(record.coveredHours) ?? (points[points.length - 1]!.time - points[0]!.time) / 3600, source: 'boredefi' };
}

/** Buckets per-block base fees (gwei) into fixed-size groups: avg / min / max per bucket. */
export function bucketBaseFees(
  baseFeesGwei: number[],
  firstBlockTime: number,
  secondsPerBlock: number,
  blocksPerBucket: number,
): GasHistoryPoint[] {
  const points: GasHistoryPoint[] = [];
  for (let start = 0; start < baseFeesGwei.length; start += blocksPerBucket) {
    const slice = baseFeesGwei.slice(start, start + blocksPerBucket);
    if (!slice.length) {
      continue;
    }
    const sum = slice.reduce((acc, value) => acc + value, 0);
    points.push({
      time: Math.round(firstBlockTime + (start + slice.length / 2) * secondsPerBlock),
      avgGwei: sum / slice.length,
      minGwei: Math.min(...slice),
      maxGwei: Math.max(...slice),
    });
  }
  return points;
}

/** Fallback 24h history straight from RPC: 7 x eth_feeHistory(1024) ≈ 7168 blocks ≈ 24h at 12s. */
export async function fetchGasHistoryFromRpc(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<GasHistory> {
  const latest = hexNum(await rpcCall<string>(GAS_ETH_RPCS, 'eth_blockNumber', [], fetchImpl));
  const pages = 7;
  const size = 1024;
  const fees: number[] = new Array(pages * size).fill(NaN);
  await Promise.all(
    Array.from({ length: pages }, async (_, page) => {
      const newest = latest - (pages - 1 - page) * size;
      try {
        const history = await rpcCall<FeeHistory>(GAS_ETH_RPCS, 'eth_feeHistory', [`0x${size.toString(16)}`, `0x${newest.toString(16)}`, []], fetchImpl);
        history.baseFeePerGas.slice(0, size).forEach((value, index) => {
          fees[page * size + index] = hexNum(value) / 1e9;
        });
      } catch {
        // Leave the page empty; the chart just has a gap.
      }
    }),
  );
  const known = fees.filter((value) => Number.isFinite(value));
  if (known.length < 150) {
    throw new Error('Gas history: RPC returned too little');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const firstTime = nowSec - fees.length * 12;
  const points = bucketBaseFees(fees, firstTime, 12, 150).filter((point) => Number.isFinite(point.avgGwei));
  return { points, coveredHours: (known.length * 12) / 3600, source: 'rpc' };
}

export async function fetchGasHistory(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<GasHistory> {
  try {
    return parseGasHistory(await fetchJson(`${GAS_API_BASE}/api/gas/history`, fetchImpl));
  } catch (error) {
    logger.warn('gas: history API failed, using public RPC', { error: String(error) });
  }
  return fetchGasHistoryFromRpc(fetchImpl);
}

/** Dollar cost of `gasUnits` at `gwei`, priced in the chain's native token USD. */
export function gasCostUsd(gasUnits: number, gwei: number, nativeUsd: number | null): number | null {
  if (nativeUsd === null || !Number.isFinite(nativeUsd) || !Number.isFinite(gwei)) {
    return null;
  }
  return gasUnits * gwei * 1e-9 * nativeUsd;
}

/** "$0.18", "<$0.01", "$12.40", or "—" when unknown. */
export function formatUsdFee(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) {
    return '—';
  }
  if (usd > 0 && usd < 0.01) {
    return '<$0.01';
  }
  if (usd >= 100) {
    return `$${Math.round(usd).toLocaleString('en-US')}`;
  }
  return `$${usd.toFixed(2)}`;
}

/** Gwei with sensible precision: 24.3, 2.38, 0.384, 0.0123. */
export function formatGwei(gwei: number): string {
  if (!Number.isFinite(gwei)) {
    return '—';
  }
  if (gwei >= 100) {
    return gwei.toFixed(0);
  }
  if (gwei >= 10) {
    return gwei.toFixed(1);
  }
  if (gwei >= 1) {
    return gwei.toFixed(2);
  }
  if (gwei >= 0.01) {
    return gwei.toFixed(3);
  }
  return gwei.toPrecision(2);
}

/** Plain-words busyness, keyed off the average gwei. */
export function gasLevel(averageGwei: number): { label: string; tone: 'good' | 'ok' | 'busy' } {
  if (averageGwei < 5) {
    return { label: 'Low: a good time to transact', tone: 'good' };
  }
  if (averageGwei < 25) {
    return { label: 'Normal', tone: 'ok' };
  }
  return { label: 'Busy: fees are high right now', tone: 'busy' };
}

/** Chart geometry for the 24h line: maps points into a width x height box (y grows down). */
export function chartPath(points: GasHistoryPoint[], width: number, height: number, pad = 4): { line: string; area: string; min: number; max: number } {
  if (points.length < 2) {
    return { line: '', area: '', min: 0, max: 0 };
  }
  const values = points.map((point) => point.avgGwei);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max || 1;
  const t0 = points[0]!.time;
  const t1 = points[points.length - 1]!.time;
  const tSpan = t1 - t0 || 1;
  const coords = points.map((point) => {
    const x = pad + ((point.time - t0) / tSpan) * (width - pad * 2);
    const y = pad + (1 - (point.avgGwei - min) / span) * (height - pad * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const last = coords[coords.length - 1]!;
  const first = coords[0]!;
  const area = `${line} L${last[0]} ${height - pad} L${first[0]} ${height - pad} Z`;
  return { line, area, min, max };
}

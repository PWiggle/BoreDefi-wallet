import type { JsonRpcProvider } from 'ethers';

import { CHAINS, type ChainId } from './chains';
import { formatUsdFee, tiersFromFeeHistory, type FeeHistory } from './gas';
import { fetchWalletUsdPrices, geckoIdForNative } from './markets';
import { getEndpointProviders, readWithFallback } from './rpc';

/**
 * Estimated network fee for a confirm screen, in the native token and dollars:
 * gas estimate x current fee (eth_feeHistory: next base fee + median tip) x native price (BoreDash, CoinGecko fallback).
 */

export type NetworkFee = {
  gasUnits: bigint;
  /** Expected fee per gas in wei (next base fee + median tip). */
  feePerGasWei: bigint;
  feeWei: bigint;
  nativeSymbol: string;
  nativeUsd: number | null;
  usd: number | null;
};

const GWEI = 1_000_000_000;

/** gwei (float) -> wei (bigint), without float drift on small values. */
export function gweiToWei(gwei: number): bigint {
  if (!Number.isFinite(gwei) || gwei <= 0) {
    return 0n;
  }
  return BigInt(Math.round(gwei * GWEI));
}

export function computeNetworkFee(input: {
  chainId: ChainId;
  gasUnits: bigint;
  feePerGasWei: bigint;
  nativeUsd: number | null;
}): NetworkFee {
  const feeWei = input.gasUnits * input.feePerGasWei;
  const usd = input.nativeUsd === null ? null : (Number(feeWei) / 1e18) * input.nativeUsd;
  return {
    gasUnits: input.gasUnits,
    feePerGasWei: input.feePerGasWei,
    feeWei,
    nativeSymbol: CHAINS[input.chainId].symbol,
    nativeUsd: input.nativeUsd,
    usd,
  };
}

/** Native amount with 2 significant digits after leading zeros: 0.000079, 0.0012, 0.35, 1.2. */
export function formatFeeNative(wei: bigint): string {
  if (wei <= 0n) {
    return '0';
  }
  const value = Number(wei) / 1e18;
  if (value >= 1) {
    return value.toFixed(value >= 100 ? 0 : 2).replace(/\.?0+$/, '');
  }
  const digits = Math.max(2, -Math.floor(Math.log10(value)) + 1);
  return value.toFixed(Math.min(digits, 12)).replace(/0+$/, '').replace(/\.$/, '');
}

/** "about $0.18 · 0.000079 ETH" (or just the native amount when the price is unknown). */
export function formatNetworkFee(fee: NetworkFee): string {
  const native = `${formatFeeNative(fee.feeWei)} ${fee.nativeSymbol}`;
  if (fee.usd === null) {
    return `about ${native}`;
  }
  return `about ${formatUsdFee(fee.usd)} · ${native}`;
}

/** Current expected fee per gas on any supported chain, from eth_feeHistory (eth_gasPrice fallback). */
export async function fetchFeePerGasWei(chainId: ChainId): Promise<bigint> {
  try {
    // Per-endpoint JsonRpcProviders only: the FallbackProvider has no raw send().
    const history = await readWithFallback(
      chainId,
      (provider) => (provider as JsonRpcProvider).send('eth_feeHistory', ['0x14', 'latest', [10, 50, 90]]) as Promise<FeeHistory>,
      getEndpointProviders(chainId),
    );
    const tiers = tiersFromFeeHistory(history);
    const wei = gweiToWei(tiers.average.gwei);
    if (wei > 0n) {
      return wei;
    }
  } catch {
    // Fall through to eth_gasPrice.
  }
  const feeData = await readWithFallback(chainId, (provider) => provider.getFeeData());
  return feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
}

export async function fetchNativeUsd(chainId: ChainId): Promise<number | null> {
  const id = geckoIdForNative(chainId);
  try {
    const prices = await fetchWalletUsdPrices([id]);
    return prices[id] ?? null;
  } catch {
    return null;
  }
}

/** Live network fee for `gasUnits` on `chainId`. Never throws: price can be null, fee falls back to gasPrice. */
export async function estimateNetworkFee(chainId: ChainId, gasUnits: bigint): Promise<NetworkFee | null> {
  try {
    const [feePerGasWei, nativeUsd] = await Promise.all([fetchFeePerGasWei(chainId), fetchNativeUsd(chainId)]);
    return computeNetworkFee({ chainId, gasUnits, feePerGasWei, nativeUsd });
  } catch {
    return null;
  }
}

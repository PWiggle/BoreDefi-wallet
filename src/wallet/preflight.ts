import { CHAINS, type ChainId } from './chains';
import { needGasMessage } from './tx-errors';

export type PreflightInput = {
  chainId: ChainId;
  /** Amount the user typed, in the spent asset's smallest unit. Use null when the action has no amount (claim). */
  amount: bigint | null;
  /** Balance of the asset being spent (token, stETH, aToken, or native). Ignored when amount is null. */
  spendBalance: bigint;
  /** Symbol of the spent asset, for the message. */
  spendSymbol: string;
  /** Native gas-token balance on that chain. Null while it is still loading. */
  nativeBalance: bigint | null;
  /** Estimated worst-case network fee in wei. Null when it could not be estimated. */
  feeWei: bigint | null;
  /** True when the spent asset is the chain's native token (so amount and fee share one balance). */
  spendIsNative: boolean;
};

export type PreflightReason = 'loading' | 'amount-missing' | 'amount-too-high' | 'no-gas' | 'gas-too-low';

export type PreflightResult = { ok: true } | { ok: false; reason: PreflightReason; message: string };

/**
 * Pre-flight check shared by Stake, Send, Swap and Approve. Pure, so every rule is unit-tested.
 * Run before the confirm sheet opens and again just before broadcast.
 */
export function checkPreflight(input: PreflightInput): PreflightResult {
  const symbol = CHAINS[input.chainId].symbol;
  if (input.amount !== null) {
    if (input.amount <= 0n) {
      return { ok: false, reason: 'amount-missing', message: 'Enter an amount greater than zero.' };
    }
    if (input.amount > input.spendBalance) {
      return {
        ok: false,
        reason: 'amount-too-high',
        message: `That is more than your ${input.spendSymbol} balance.`,
      };
    }
  }
  if (input.nativeBalance === null) {
    return { ok: false, reason: 'loading', message: 'Checking your balance…' };
  }
  if (input.nativeBalance <= 0n) {
    return { ok: false, reason: 'no-gas', message: needGasMessage(input.chainId) };
  }
  if (input.feeWei !== null) {
    const nativeSpend = input.spendIsNative && input.amount !== null ? input.amount : 0n;
    if (nativeSpend + input.feeWei > input.nativeBalance) {
      return {
        ok: false,
        reason: 'gas-too-low',
        message:
          nativeSpend > 0n
            ? `Leave some ${symbol} for network fees. Try a smaller amount.`
            : needGasMessage(input.chainId),
      };
    }
  }
  return { ok: true };
}

/**
 * Conservative gas units per action, used to price fees before we can call estimateGas
 * (estimateGas itself fails on an empty wallet, which is the case we most need to catch).
 * Includes the ERC-20 approve when the action may need one.
 */
export const GAS_UNITS = {
  nativeTransfer: 21_000n,
  erc20Approve: 70_000n,
  erc20Transfer: 80_000n,
  lidoStake: 120_000n,
  lidoUnstake: 300_000n,
  lidoClaim: 250_000n,
  aaveSupply: 320_000n,
  aaveWithdraw: 300_000n,
  swap: 400_000n,
  bridge: 500_000n,
} as const;

/** Chains where the fee also includes an L1 data fee; pad the estimate so we do not under-quote. */
const L1_DATA_FEE_PAD: Partial<Record<ChainId, bigint>> = { 10: 2n, 8453: 2n, 42161: 2n };

export function estimateFeeWei(chainId: ChainId, gasUnits: bigint, maxFeePerGas: bigint): bigint {
  const pad = L1_DATA_FEE_PAD[chainId] ?? 1n;
  return gasUnits * maxFeePerGas * pad;
}

/**
 * One friendly line for a screen. Gas problems from any action always show (they block everything);
 * amount problems show only for the primary action (first result) and only once the user typed something.
 */
export function preflightLine(results: PreflightResult[], typed: boolean): string | null {
  for (const result of results) {
    if (!result.ok && (result.reason === 'no-gas' || result.reason === 'gas-too-low')) {
      return result.message;
    }
  }
  const primary = results[0];
  if (!typed || !primary || primary.ok || primary.reason === 'loading') {
    return null;
  }
  return primary.message;
}

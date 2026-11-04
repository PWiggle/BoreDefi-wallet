import type { Contract, TransactionRequest, TransactionResponse } from 'ethers';

import { logger } from '../logger';

/**
 * DO NOT send a state-changing transaction with ethers' bare estimateGas as its limit (1.0.4 Aave supply bug).
 * eth_estimateGas returns the smallest limit that works at the moment of the estimate. A tx mined a block later
 * can need slightly more (storage warmed/cooled, interest index moved, 63/64 call-forwarding rule), so a zero-headroom
 * limit runs out of gas and reverts while still charging the fee. Aave V3 USDC supply on Ethereum, tx 0x35b48b7d…a802:
 * limit 181,989, used 176,163, reverted out of gas.
 *
 * Every wallet-originated send goes through bufferGasLimit: +30%, and at least +25,000 gas. You pay only for the gas
 * actually used, so the headroom costs nothing when it is not needed.
 */
export const GAS_BUFFER_PERCENT = 130n;
export const MIN_GAS_HEADROOM = 25_000n;
/** A plain native transfer to an EOA always costs exactly this; no headroom needed (keeps "send max" exact). */
export const PLAIN_TRANSFER_GAS = 21_000n;

export function bufferGasLimit(estimate: bigint): bigint {
  if (estimate <= 0n) {
    return estimate;
  }
  if (estimate === PLAIN_TRANSFER_GAS) {
    return estimate;
  }
  const scaled = (estimate * GAS_BUFFER_PERCENT + 99n) / 100n;
  const floor = estimate + MIN_GAS_HEADROOM;
  return scaled > floor ? scaled : floor;
}

/** True when an estimate failed because the call itself would revert or cannot be paid for (do not send it). */
export function isRevertOrFundsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'CALL_EXCEPTION' || code === 'INSUFFICIENT_FUNDS') {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return message.includes('revert') || message.includes('insufficient funds');
}

/**
 * Picks the gas limit for one send.
 * - Estimate succeeds: buffered estimate, and never below a limit the caller/aggregator/dApp already supplied.
 * - Estimate fails and a limit was supplied: keep the supplied limit (previous behaviour).
 * - Estimate fails with a revert / insufficient funds: rethrow, so we never broadcast a doomed transaction.
 * - Estimate fails for any other reason (RPC down, timeout): use the conservative fallback (GAS_UNITS).
 */
export async function resolveGasLimit(
  estimate: () => Promise<bigint>,
  options: { fallback: bigint; provided?: bigint | null },
): Promise<bigint> {
  const provided = options.provided && options.provided > 0n ? options.provided : null;
  let estimated: bigint;
  try {
    estimated = await estimate();
  } catch (error) {
    if (provided) {
      return provided;
    }
    if (isRevertOrFundsError(error)) {
      throw error;
    }
    logger.error('Gas estimate failed, using fallback gas limit', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return options.fallback;
  }
  const buffered = bufferGasLimit(estimated);
  return provided && provided > buffered ? provided : buffered;
}

type GasSigner = {
  estimateGas: (tx: TransactionRequest) => Promise<bigint>;
  sendTransaction: (tx: TransactionRequest) => Promise<TransactionResponse>;
};

/** wallet.sendTransaction with a buffered gasLimit (see resolveGasLimit). */
export async function sendWithBufferedGas(
  signer: GasSigner,
  tx: TransactionRequest,
  fallback: bigint,
): Promise<TransactionResponse> {
  const provided = tx.gasLimit !== undefined && tx.gasLimit !== null ? BigInt(tx.gasLimit) : null;
  const { gasLimit: _ignored, ...estimateTx } = tx;
  const gasLimit = await resolveGasLimit(() => signer.estimateGas(estimateTx), { fallback, provided });
  return signer.sendTransaction({ ...tx, gasLimit });
}

/** contract.method(...args) with a buffered gasLimit. `value` is forwarded for payable calls. */
export async function sendContractMethod(
  contract: Pick<Contract, 'getFunction'>,
  method: string,
  args: unknown[],
  options: { fallback: bigint; value?: bigint },
): Promise<TransactionResponse> {
  const fn = contract.getFunction(method);
  const overrides = options.value !== undefined ? { value: options.value } : {};
  const gasLimit = await resolveGasLimit(() => fn.estimateGas(...args, overrides), { fallback: options.fallback });
  return (await fn(...args, { ...overrides, gasLimit })) as TransactionResponse;
}

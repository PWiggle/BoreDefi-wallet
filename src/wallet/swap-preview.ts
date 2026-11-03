import { Contract, Interface } from 'ethers';

import { type ChainId } from './chains';
import { GAS_UNITS } from './preflight';
import { readWithFallback } from './rpc';
import type { SwapQuote } from './swap';
import { isNativeTokenAddress, type TokenConfig } from './tokens';
import { protectedForEffect, simulationEffects, type SimCall, type Simulation } from './tx-simulate';
import { previewInAppCalls } from './tx-preview-runtime';
import type { TxPreview } from './tx-simulate';
import { protectedTokenAsset } from './protected-spend';
import type { ProtectedAsset } from './yuga-allowlist';

const ERC20 = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/** The calls a swap would send, in order (approve first when needed), for the transaction preview. */
export function swapSimCalls(owner: string, token: Pick<TokenConfig, 'address' | 'native'>, quote: SwapQuote, needsApproval: boolean): SimCall[] {
  const calls: SimCall[] = [];
  if (needsApproval && quote.approvalAddress && !token.native && !isNativeTokenAddress(token.address)) {
    calls.push({ from: owner, to: token.address, value: 0n, data: ERC20.encodeFunctionData('approve', [quote.approvalAddress, quote.fromAmount]) });
  }
  calls.push({
    from: owner,
    to: quote.transactionRequest.to,
    value: quote.transactionRequest.value,
    data: quote.transactionRequest.data,
    gas: quote.transactionRequest.gasLimit ?? null,
  });
  return calls;
}

/**
 * Gas units for the swap fee: what the simulation used (approve + swap), else the route's gas limit (+ an approve),
 * else the conservative default.
 */
export function swapFeeGasUnits(quote: SwapQuote | null, simulatedGas: bigint | null, needsApproval: boolean): bigint {
  if (simulatedGas !== null && simulatedGas > 0n) {
    return simulatedGas;
  }
  const base = quote?.transactionRequest.gasLimit ?? GAS_UNITS.swap;
  return base + (needsApproval ? GAS_UNITS.erc20Approve : 0n);
}

/** Small detail under the fee: the gas limit, explained. */
export function gasLimitDetail(gasLimit: bigint | undefined | null): string | undefined {
  if (!gasLimit || gasLimit <= 0n) {
    return undefined;
  }
  return `Gas limit ${gasLimit.toLocaleString('en-US')} (the most this swap can use; you pay only what it uses)`;
}

export async function readAllowance(chainId: ChainId, token: string, owner: string, spender: string): Promise<bigint> {
  return readWithFallback(chainId, async (provider) => {
    const contract = new Contract(token, ERC20, provider);
    return (await contract.allowance(owner, spender)) as bigint;
  });
}

/**
 * Protected assets (Yuga / Yaper / ApeCoin) the simulation says would leave the wallet or be approved, other than
 * the ones the user chose to spend. Any hit blocks the in-app action.
 */
export function unexpectedProtectedMoves(chainId: number, simulation: Simulation | null, owner: string, expectedKeys: ReadonlySet<string>): ProtectedAsset[] {
  const hits = new Map<string, ProtectedAsset>();
  for (const effect of simulationEffects(simulation, owner)) {
    if (effect.type === 'in' || (effect.type === 'approval' && effect.revoke)) {
      continue;
    }
    const asset = protectedForEffect(chainId, effect);
    if (asset && !expectedKeys.has(asset.key)) {
      hits.set(asset.key, asset);
    }
  }
  return [...hits.values()];
}

export type SwapReview =
  | { ok: true; preview: TxPreview; needsApproval: boolean }
  | { ok: false; message: string };

/**
 * Transaction preview for a swap: reads the current allowance, simulates approve (if needed) + swap together, and
 * blocks when anything protected other than the spent token would leave the wallet. Read-only.
 */
export async function prepareSwapReview(input: {
  chainId: ChainId;
  owner: string;
  fromToken: TokenConfig;
  quote: SwapQuote;
}): Promise<SwapReview> {
  const { chainId, owner, fromToken, quote } = input;
  const needsApproval =
    !fromToken.native && quote.approvalAddress
      ? (await readAllowance(chainId, fromToken.address, owner, quote.approvalAddress).catch(() => 0n)) < quote.fromAmount
      : false;
  const { preview, simulation } = await previewInAppCalls(chainId, owner, swapSimCalls(owner, fromToken, quote, needsApproval));
  const spent = protectedTokenAsset(fromToken);
  const unexpected = unexpectedProtectedMoves(chainId, simulation, owner, new Set(spent ? [spent.key] : []));
  if (unexpected.length) {
    return {
      ok: false,
      message: `Blocked: the preview shows this swap would also move your ${unexpected.map((item) => item.name).join(', ')}. Nothing was sent.`,
    };
  }
  return { ok: true, preview, needsApproval };
}

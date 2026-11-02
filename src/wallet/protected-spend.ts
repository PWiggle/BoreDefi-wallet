import { Interface } from 'ethers';

import { isNativeTokenAddress, type TokenConfig } from './tokens';
import { protectedAssetFor, type ProtectedAsset } from './yuga-allowlist';

const ERC20 = new Interface([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
]);

/** The Yuga-protected asset behind a wallet token (ApeCoin on Ethereum / Arbitrum / BNB Chain), if any. */
export function protectedTokenAsset(token: Pick<TokenConfig, 'chainId' | 'address' | 'native'>): ProtectedAsset | null {
  if (token.native || isNativeTokenAddress(token.address)) {
    return null;
  }
  return protectedAssetFor(token.chainId, token.address);
}

export type GuardRequest = { method: 'eth_sendTransaction'; params: unknown[]; chainId: number; owner: string };

/**
 * The approve() an in-app Swap or Bridge would send for a protected token, as a guard request, so the
 * same red warning, approval block and typed-name + PIN step apply as for a dApp asking for it.
 */
export function protectedApproveRequest(
  token: Pick<TokenConfig, 'chainId' | 'address'>,
  owner: string,
  spender: string,
  amount: bigint,
): GuardRequest {
  return {
    method: 'eth_sendTransaction',
    params: [{ from: owner, to: token.address, value: '0x0', data: ERC20.encodeFunctionData('approve', [spender, amount]) }],
    chainId: token.chainId,
    owner,
  };
}

/** The ERC-20 transfer() a Send would broadcast, as a guard request. Also the exact calldata sent. */
export function erc20TransferData(to: string, amount: bigint): string {
  return ERC20.encodeFunctionData('transfer', [to, amount]);
}

export function protectedTransferRequest(
  token: Pick<TokenConfig, 'chainId' | 'address'>,
  owner: string,
  to: string,
  amount: bigint,
): GuardRequest {
  return {
    method: 'eth_sendTransaction',
    params: [{ from: owner, to: token.address, value: '0x0', data: erc20TransferData(to, amount) }],
    chainId: token.chainId,
    owner,
  };
}

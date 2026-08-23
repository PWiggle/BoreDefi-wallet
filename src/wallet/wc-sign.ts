import { getAddress } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { connectedWallet } from './rpc';
import { hexToUtf8, parseSwitchChainId, pickSignMessage } from './wc';

export type WalletConnectRequestResult =
  | { kind: 'signature' | 'hash' | 'accounts' | 'switched'; value: string | string[] | true }
  | { kind: 'switch'; chainId: ChainId };

function parseTypedData(raw: unknown): { domain: Record<string, unknown>; types: Record<string, unknown[]>; message: Record<string, unknown> } {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Typed data is invalid.');
  }
  const data = parsed as {
    domain?: Record<string, unknown>;
    types?: Record<string, unknown[]>;
    message?: Record<string, unknown>;
  };
  if (!data.domain || !data.types || !data.message) {
    throw new Error('Typed data is incomplete.');
  }
  const types = { ...data.types };
  delete types.EIP712Domain;
  return { domain: data.domain, types, message: data.message };
}

export async function handleWalletConnectRequest(input: {
  mnemonic: string;
  address: string;
  method: string;
  params: unknown[];
  chainId: ChainId;
}): Promise<WalletConnectRequestResult> {
  const { mnemonic, address, method, params, chainId } = input;
  const wallet = connectedWallet(mnemonic, chainId);

  switch (method) {
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return { kind: 'accounts', value: [address] };
    case 'personal_sign': {
      const message = pickSignMessage(params);
      const signature = await wallet.signMessage(hexToUtf8(message));
      return { kind: 'signature', value: signature };
    }
    case 'eth_sign': {
      const message = pickSignMessage(params);
      const signature = await wallet.signMessage(hexToUtf8(message));
      return { kind: 'signature', value: signature };
    }
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      const payload = params.find((item) => typeof item === 'string' && item.trim().startsWith('{')) ?? params[1];
      const typed = parseTypedData(payload);
      const signature = await wallet.signTypedData(
        typed.domain as never,
        typed.types as never,
        typed.message,
      );
      return { kind: 'signature', value: signature };
    }
    case 'eth_signTransaction': {
      const tx = asTransaction(params[0]);
      const signed = await wallet.signTransaction(tx);
      return { kind: 'signature', value: signed };
    }
    case 'eth_sendTransaction': {
      const tx = asTransaction(params[0]);
      logger.info('WalletConnect send', { chainId, to: tx.to });
      const response = await wallet.sendTransaction(tx);
      return { kind: 'hash', value: response.hash };
    }
    case 'wallet_switchEthereumChain': {
      const next = parseSwitchChainId(params);
      if (!next) {
        throw new Error('That chain is not supported.');
      }
      return { kind: 'switch', chainId: next };
    }
    case 'wallet_getCapabilities':
      return { kind: 'signature', value: '{}' };
    default:
      throw new Error(`Method ${method} is not supported.`);
  }
}

function asTransaction(raw: unknown): {
  to?: string;
  data?: string;
  value?: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
  nonce?: number;
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Transaction is missing.');
  }
  const tx = raw as Record<string, string | undefined>;
  return {
    to: tx.to ? getAddress(tx.to) : undefined,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : undefined,
    gasLimit: tx.gas ? BigInt(tx.gas) : tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
    gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
    nonce: tx.nonce ? Number(tx.nonce) : undefined,
  };
}

export function recoverPersonalSignaturePreview(message: string): string {
  return hexToUtf8(message);
}

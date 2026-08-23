import { Transaction, type TransactionLike } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { getProvider } from './rpc';

export const LEDGER_ETH_PATH = "44'/60'/0'/0/0";

export const LEDGER_NATIVE_GAP =
  'Expo SDK 57 + React Native New Architecture has no supported Ledger USB (HID) or BLE transport. @ledgerhq/react-native-hw-transport-ble needs react-native-ble-plx and a custom JSC; @ledgerhq/react-native-hid is unmaintained and is not wired for this Expo prebuild. Connect a Ledger over WebHID in the Chrome extension or in Expo web (chrome:// + USB).';

export type LedgerTransportKind = 'webhid' | 'unavailable';

export type LedgerAccount = {
  address: string;
  path: string;
  transportKind: LedgerTransportKind;
};

export type LedgerUnsignedTx = {
  chainId: ChainId;
  to?: string;
  data?: string;
  value?: bigint;
  gasLimit?: bigint;
  nonce?: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

type LedgerTransport = {
  close?: () => Promise<void>;
};

type LedgerEth = {
  getAddress: (path: string) => Promise<{ address: string }>;
  signTransaction: (
    path: string,
    rawTxHex: string,
    resolution: null,
  ) => Promise<{ r: string; s: string; v: string }>;
};

let activeTransport: LedgerTransport | null = null;
let activeAccount: LedgerAccount | null = null;

export function detectLedgerTransportKind(): LedgerTransportKind {
  const hid = (globalThis as { navigator?: { hid?: unknown } }).navigator?.hid;
  return hid ? 'webhid' : 'unavailable';
}

export function getConnectedLedger(): LedgerAccount | null {
  return activeAccount;
}

export function ledgerGapMessage(): string | null {
  return detectLedgerTransportKind() === 'unavailable' ? LEDGER_NATIVE_GAP : null;
}

export function hexNoPrefix(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
}

export function normalizeLedgerComponent(value: string): string {
  const hex = hexNoPrefix(value);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}

export function buildUnsignedLedgerTx(input: LedgerUnsignedTx & { nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasLimit: bigint }): string {
  const tx = Transaction.from({
    type: 2,
    chainId: input.chainId,
    nonce: input.nonce,
    to: input.to,
    data: input.data ?? '0x',
    value: input.value ?? 0n,
    gasLimit: input.gasLimit,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
  } satisfies TransactionLike);
  return hexNoPrefix(tx.unsignedSerialized);
}

export function applyLedgerSignature(
  unsignedHex: string,
  signature: { r: string; s: string; v: string },
): string {
  const tx = Transaction.from(`0x${hexNoPrefix(unsignedHex)}`);
  const v = Number.parseInt(hexNoPrefix(signature.v), 16);
  if (!Number.isFinite(v)) {
    throw new Error('Ledger signature is missing v.');
  }
  const signed = Transaction.from({
    type: tx.type,
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    gasPrice: tx.gasPrice,
    signature: {
      r: `0x${normalizeLedgerComponent(signature.r)}`,
      s: `0x${normalizeLedgerComponent(signature.s)}`,
      v,
    },
  });
  return signed.serialized;
}

export async function connectLedger(): Promise<LedgerAccount> {
  const kind = detectLedgerTransportKind();
  if (kind !== 'webhid') {
    throw new Error(LEDGER_NATIVE_GAP);
  }
  const BufferImpl = (await import('buffer')).Buffer;
  const globalBuffer = globalThis as { Buffer?: typeof BufferImpl };
  if (!globalBuffer.Buffer) {
    globalBuffer.Buffer = BufferImpl;
  }
  const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid');
  const { default: Eth } = await import('@ledgerhq/hw-app-eth');
  const transport = await TransportWebHID.create();
  const eth = new Eth(transport) as unknown as LedgerEth;
  const { address } = await eth.getAddress(LEDGER_ETH_PATH);
  activeTransport = transport;
  activeAccount = { address, path: LEDGER_ETH_PATH, transportKind: 'webhid' };
  logger.info('Ledger connected', { address, transport: 'webhid' });
  return activeAccount;
}

export async function disconnectLedger(): Promise<void> {
  try {
    await activeTransport?.close?.();
  } catch {
    // Device may already be unplugged.
  }
  activeTransport = null;
  activeAccount = null;
}

export async function signAndBroadcastLedger(input: LedgerUnsignedTx): Promise<string> {
  if (!activeTransport || !activeAccount) {
    throw new Error('Connect a Ledger first.');
  }
  const provider = getProvider(input.chainId);
  const nonce = input.nonce ?? (await provider.getTransactionCount(activeAccount.address));
  const fee = await provider.getFeeData();
  const maxFeePerGas = input.maxFeePerGas ?? fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const maxPriorityFeePerGas = input.maxPriorityFeePerGas ?? fee.maxPriorityFeePerGas ?? 0n;
  const gasLimit = input.gasLimit ?? (await provider.estimateGas({
    from: activeAccount.address,
    to: input.to,
    data: input.data ?? '0x',
    value: input.value ?? 0n,
  }));
  const unsignedHex = buildUnsignedLedgerTx({
    ...input,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
  });
  const { default: Eth } = await import('@ledgerhq/hw-app-eth');
  const eth = new Eth(activeTransport as never) as unknown as LedgerEth;
  logger.info('Ledger sign', { chainId: input.chainId, to: input.to });
  const signature = await eth.signTransaction(activeAccount.path, unsignedHex, null);
  const raw = applyLedgerSignature(unsignedHex, signature);
  const response = await provider.broadcastTransaction(raw);
  return response.hash;
}

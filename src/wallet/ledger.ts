import { Transaction, type TransactionLike } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { resolveGasLimit } from './gas-limit';
import { GAS_UNITS } from './preflight';
import { getProvider } from './rpc';

export const LEDGER_ETH_PATH = "44'/60'/0'/0/0";

export const LEDGER_NATIVE_GAP =
  'Expo SDK 57 + React Native New Architecture has no supported Ledger USB (HID) or BLE transport. @ledgerhq/react-native-hw-transport-ble needs react-native-ble-plx and a custom JSC; @ledgerhq/react-native-hid is unmaintained and is not wired for this Expo prebuild. Connect a Ledger over WebHID in the Chrome extension or in Expo web (chrome:// + USB).';

export type LedgerTransportKind = 'webhid' | 'ble' | 'unavailable';

export type LedgerAccount = {
  address: string;
  path: string;
  transportKind: LedgerTransportKind;
  /** Bluetooth only: the Ledger's Solana address (44'/501'/0'), when the Solana app answered. */
  solanaAddress?: string | null;
  deviceName?: string;
};

/** Bluetooth signer for the connected Nano X (set by connectLedgerBle in LedgerContext). */
export type LedgerBleSigner = {
  signEthTx: (unsignedHex: string, expectedAddress: string, onPrompt?: (message: string | null) => void) => Promise<string>;
  disconnect: () => Promise<void>;
};

let activeBle: LedgerBleSigner | null = null;

export function setBleLedger(account: LedgerAccount, signer: LedgerBleSigner): void {
  activeTransport = null;
  activeBle = signer;
  activeAccount = account;
}

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

export function ledgerGapMessage(bleEnabled = false): string | null {
  return !bleEnabled && detectLedgerTransportKind() === 'unavailable' ? LEDGER_NATIVE_GAP : null;
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
    await activeBle?.disconnect();
  } catch {
    // Device may already be unplugged.
  }
  activeTransport = null;
  activeBle = null;
  activeAccount = null;
}

export async function signAndBroadcastLedger(
  input: LedgerUnsignedTx,
  onPrompt?: (message: string | null) => void,
): Promise<string> {
  if ((!activeTransport && !activeBle) || !activeAccount) {
    throw new Error('Connect a Ledger first.');
  }
  const provider = getProvider(input.chainId);
  const nonce = input.nonce ?? (await provider.getTransactionCount(activeAccount.address));
  const fee = await provider.getFeeData();
  const maxFeePerGas = input.maxFeePerGas ?? fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const maxPriorityFeePerGas = input.maxPriorityFeePerGas ?? fee.maxPriorityFeePerGas ?? 0n;
  const from = activeAccount.address;
  const gasLimit = await resolveGasLimit(
    () => provider.estimateGas({ from, to: input.to, data: input.data ?? '0x', value: input.value ?? 0n }),
    { fallback: input.data && input.data !== '0x' ? GAS_UNITS.swap : GAS_UNITS.nativeTransfer, provided: input.gasLimit },
  );
  const unsignedHex = buildUnsignedLedgerTx({
    ...input,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
  });
  logger.info('Ledger sign', { chainId: input.chainId, to: input.to, transport: activeAccount.transportKind });
  let raw: string;
  if (activeBle) {
    // Device Management Kit over Bluetooth; the signed tx is checked to recover to the Ledger address.
    raw = await activeBle.signEthTx(unsignedHex, from, onPrompt);
  } else {
    const { default: Eth } = await import('@ledgerhq/hw-app-eth');
    const eth = new Eth(activeTransport as never) as unknown as LedgerEth;
    const signature = await eth.signTransaction(activeAccount.path, unsignedHex, null);
    raw = applyLedgerSignature(unsignedHex, signature);
  }
  const response = await provider.broadcastTransaction(raw);
  return response.hash;
}

import { Transaction, type TransactionLike } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { resolveGasLimit } from './gas-limit';
import { GAS_UNITS } from './preflight';
import { getProvider } from './rpc';

export const LEDGER_ETH_PATH = "44'/60'/0'/0/0";

export const LEDGER_NATIVE_GAP =
  'Ledger over Bluetooth (Nano X) is only in BoreDefi test builds for now. In this build, connect a Ledger over USB (WebHID) in the Chrome extension or in the web version.';

export type LedgerTransportKind = 'webhid' | 'ble' | 'unavailable';

export type LedgerAccount = {
  address: string;
  path: string;
  transportKind: LedgerTransportKind;
  /** Bluetooth only: the Ledger's Solana address (44'/501'/0'), when the Solana app answered. */
  solanaAddress?: string | null;
  deviceName?: string;
};

/** DMK signer for the connected Ledger: Bluetooth (Nano X, set in LedgerContext) or WebHID (connectLedger). */
export type LedgerBleSigner = {
  signEthTx: (unsignedHex: string, expectedAddress: string, onPrompt?: (message: string | null) => void) => Promise<string>;
  disconnect: () => Promise<void>;
};

let activeBle: LedgerBleSigner | null = null;

export function setBleLedger(account: LedgerAccount, signer: LedgerBleSigner): void {
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

export async function connectLedger(onPrompt?: (message: string | null) => void): Promise<LedgerAccount> {
  const kind = detectLedgerTransportKind();
  if (kind !== 'webhid') {
    throw new Error(LEDGER_NATIVE_GAP);
  }
  const { connectLedgerWebHid } = await import('./ledger-webhid');
  const session = await connectLedgerWebHid(onPrompt);
  const account: LedgerAccount = { address: session.ethAddress, path: LEDGER_ETH_PATH, transportKind: 'webhid', deviceName: session.deviceName };
  setBleLedger(account, { signEthTx: session.signEthTx, disconnect: session.disconnect });
  logger.info('Ledger connected', { transport: 'webhid' });
  return account;
}

export async function disconnectLedger(): Promise<void> {
  try {
    await activeBle?.disconnect();
  } catch {
    // Device may already be unplugged.
  }
  activeBle = null;
  activeAccount = null;
}

export async function signAndBroadcastLedger(
  input: LedgerUnsignedTx,
  onPrompt?: (message: string | null) => void,
): Promise<string> {
  if (!activeBle || !activeAccount) {
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
  // Device Management Kit (Bluetooth or WebHID); the signed tx is checked to recover to the Ledger address.
  const raw = await (activeBle as LedgerBleSigner).signEthTx(unsignedHex, from, onPrompt);
  const response = await provider.broadcastTransaction(raw);
  return response.hash;
}

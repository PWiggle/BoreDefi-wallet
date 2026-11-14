/**
 * Ledger over Ledger's Device Management Kit (DMK): connect, read addresses, and sign ETH + Solana transactions.
 *
 * Transport-agnostic on purpose. The app injects the React Native BLE transport (ledger-ble.ts, Nano X over
 * Bluetooth); scripts/ledger-speculos.ts injects the Speculos emulator transport and runs this same code against
 * Ledger's real Ethereum and Solana apps. Every signature is checked locally before it is used:
 *  - ETH: the signed transaction must recover to the Ledger address we read for that path.
 *  - Solana: the ed25519 signature must verify against the Ledger public key over the exact message bytes.
 *
 * The seed never leaves the device; the wallet only ever sees public keys and signatures.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { getBytes, Signature, toUtf8Bytes, Transaction, TypedDataEncoder, verifyMessage, verifyTypedData } from 'ethers';
import type { Observable } from 'rxjs';

import { applyLedgerSignature, hexNoPrefix, LEDGER_ETH_PATH } from './ledger';
import { decodeBase58, encodeBase58 } from './solana/base58';
import { parseSolanaTransaction } from './solana/wc-solana';

export { LEDGER_ETH_PATH };
/** Ledger Live's first Solana account. (BoreDefi's own seed uses m/44'/501'/0'/0'; a Ledger is a separate account.) */
export const LEDGER_SOL_PATH = "44'/501'/0'";

/** DMK DeviceActionStatus values (kept as strings so this module loads without the DMK; tested to match it). */
export const DA_STATUS = {
  NotStarted: 'not-started',
  Pending: 'pending',
  Stopped: 'stopped',
  Completed: 'completed',
  Error: 'error',
} as const;

export type DeviceActionStateLike<T> =
  | { status: typeof DA_STATUS.NotStarted }
  | { status: typeof DA_STATUS.Pending; intermediateValue?: { requiredUserInteraction?: string } }
  | { status: typeof DA_STATUS.Stopped }
  | { status: typeof DA_STATUS.Completed; output: T }
  | { status: typeof DA_STATUS.Error; error: unknown };

export type DeviceActionLike<T> = { observable: Observable<DeviceActionStateLike<T>> | { subscribe: Observable<DeviceActionStateLike<T>>['subscribe'] }; cancel: () => void };

/** What to tell the user while the device waits (DMK UserInteractionRequired). */
export function ledgerPrompt(interaction: string | undefined, app: 'Ethereum' | 'Solana'): string | null {
  switch (interaction) {
    case 'unlock-device':
      return 'Unlock your Ledger with its PIN.';
    case 'confirm-open-app':
      return `Allow the ${app} app to open on your Ledger.`;
    case 'allow-secure-connection':
    case 'allow-list-apps':
      return 'Allow BoreDefi on your Ledger.';
    case 'verify-address':
      return 'Check the address on your Ledger matches, then approve.';
    case 'sign-transaction':
      return 'Review the transaction on your Ledger, then approve.';
    case 'sign-personal-message':
      return 'Review the message on your Ledger, then approve.';
    case 'sign-typed-data':
      return 'Review the request on your Ledger, then approve.';
    case 'web3-checks-opt-in':
      return 'Choose a Web3 Checks option on your Ledger.';
    default:
      return null;
  }
}

/** Plain words for a DMK device-action error. */
export function ledgerErrorMessage(error: unknown): string {
  const raw = error as { _tag?: string; errorCode?: string; message?: string; originalError?: { message?: string } } | null;
  const tag = raw?._tag ?? '';
  const code = String(raw?.errorCode ?? '');
  const text = `${raw?.message ?? ''} ${raw?.originalError?.message ?? ''}`;
  if (code === '6985' || /refused|rejected|denied|user ?refused/i.test(text) || /Refused/i.test(tag)) {
    return 'You rejected it on the Ledger. Nothing was signed.';
  }
  if (code === '5515' || /locked/i.test(text) || /Locked/i.test(tag)) {
    return 'Your Ledger is locked. Unlock it with its PIN and try again.';
  }
  if (code === '6a83' || /AppNotFound|not installed/i.test(`${tag} ${text}`)) {
    return 'That app is not installed on your Ledger. Install it with Ledger Live, then try again.';
  }
  if (/blind|6a80/i.test(`${code} ${text}`)) {
    return 'Your Ledger cannot show this transaction in full. Turn on Blind signing in the Ethereum app settings only if you trust it.';
  }
  if (/disconnect|timeout|not connected/i.test(`${tag} ${text}`)) {
    return 'The Ledger disconnected. Keep it on, close to the phone, and try again.';
  }
  return raw?.message ? `Ledger error: ${raw.message}` : 'The Ledger did not sign. Nothing was sent.';
}

/** Runs one DMK device action to completion. Rejects on error, stop, or timeout (and cancels the action). */
export function awaitDeviceAction<T>(
  action: DeviceActionLike<T>,
  options: { onPrompt?: (message: string | null) => void; app?: 'Ethereum' | 'Solana'; timeoutMs?: number } = {},
): Promise<T> {
  const app = options.app ?? 'Ethereum';
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let subscription: { unsubscribe: () => void } | null = null;
    const finish = (fn: () => void) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      options.onPrompt?.(null);
      fn();
      // Unsubscribe after the current emission (subscription may not be assigned yet for sync observables).
      queueMicrotask(() => subscription?.unsubscribe());
    };
    const timer = setTimeout(() => {
      finish(() => {
        action.cancel();
        reject(new Error('The Ledger did not answer in time. Nothing was signed.'));
      });
    }, options.timeoutMs ?? 120_000);
    subscription = action.observable.subscribe({
      next: (state: DeviceActionStateLike<T>) => {
        if (state.status === DA_STATUS.Pending) {
          options.onPrompt?.(ledgerPrompt(state.intermediateValue?.requiredUserInteraction, app));
        } else if (state.status === DA_STATUS.Completed) {
          finish(() => resolve(state.output));
        } else if (state.status === DA_STATUS.Error) {
          finish(() => reject(new Error(ledgerErrorMessage(state.error))));
        } else if (state.status === DA_STATUS.Stopped) {
          finish(() => reject(new Error('The Ledger action was stopped. Nothing was signed.')));
        }
      },
      error: (error: unknown) => finish(() => reject(new Error(ledgerErrorMessage(error)))),
    });
  });
}

/** Minimal views of the DMK pieces this module uses (the real classes satisfy them). */
export type DmkLike = {
  startDiscovering: (args: Record<string, unknown>) => { subscribe: (observer: { next: (device: DiscoveredLedger) => void; error?: (e: unknown) => void }) => { unsubscribe: () => void } };
  stopDiscovering: () => Promise<void>;
  connect: (args: { device: DiscoveredLedger }) => Promise<string>;
  disconnect: (args: { sessionId: string }) => Promise<void>;
};
export type DiscoveredLedger = { id: string; name: string; deviceModel?: { model?: string; name?: string } };
export type LedgerEthSignature = { r: string; s: string; v: number };
export type LedgerTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};
export type EthSignerLike = {
  getAddress: (path: string, options?: { checkOnDevice?: boolean }) => DeviceActionLike<{ address: string; publicKey: string }>;
  signTransaction: (path: string, tx: Uint8Array, options?: Record<string, unknown>) => DeviceActionLike<LedgerEthSignature>;
  signMessage?: (path: string, message: string | Uint8Array) => DeviceActionLike<LedgerEthSignature>;
  signTypedData?: (path: string, typedData: LedgerTypedData) => DeviceActionLike<LedgerEthSignature>;
};
export type SolSignerLike = {
  getAddress: (path: string, options?: { checkOnDevice?: boolean }) => DeviceActionLike<string | Uint8Array>;
  signTransaction: (path: string, tx: Uint8Array, options?: Record<string, unknown>) => DeviceActionLike<Uint8Array | string>;
  signMessage?: (path: string, message: string | Uint8Array) => DeviceActionLike<{ signature: string }>;
};

/**
 * Scans until a Ledger shows up (or timeout), then opens a session to it. With `preferId` (Reconnect), waits up to
 * `graceMs` for that exact device and otherwise takes the first other Ledger it saw (ids can change after re-pairing).
 */
export async function connectFirstLedger(
  dmk: DmkLike,
  options: { timeoutMs?: number; preferId?: string | null; graceMs?: number } = {},
): Promise<{ sessionId: string; device: DiscoveredLedger }> {
  const device = await new Promise<DiscoveredLedger>((resolve, reject) => {
    let sub: { unsubscribe: () => void } | null = null;
    let settled = false;
    let fallback: DiscoveredLedger | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (found: DiscoveredLedger) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      queueMicrotask(() => sub?.unsubscribe());
      void dmk.stopDiscovering().catch(() => undefined);
      resolve(found);
    };
    const timer = setTimeout(() => {
      if (fallback) {
        done(fallback);
        return;
      }
      settled = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      sub?.unsubscribe();
      void dmk.stopDiscovering().catch(() => undefined);
      reject(new Error('No Ledger found. Turn it on, unlock it, keep Bluetooth on, and stay close to the phone.'));
    }, options.timeoutMs ?? 30_000);
    if (options.preferId) {
      graceTimer = setTimeout(() => {
        if (fallback) {
          done(fallback);
        }
      }, options.graceMs ?? 10_000);
    }
    sub = dmk.startDiscovering({}).subscribe({
      next: (found) => {
        if (settled) {
          return;
        }
        if (!options.preferId || found.id === options.preferId) {
          done(found);
          return;
        }
        fallback = fallback ?? found;
      },
      error: (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (graceTimer) {
            clearTimeout(graceTimer);
          }
          reject(new Error(ledgerErrorMessage(error)));
        }
      },
    });
  });
  const sessionId = await dmk.connect({ device });
  return { sessionId, device };
}

export async function ledgerEthAddress(
  signer: EthSignerLike,
  options: { path?: string; checkOnDevice?: boolean; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  const out = await awaitDeviceAction(signer.getAddress(options.path ?? LEDGER_ETH_PATH, { checkOnDevice: options.checkOnDevice ?? false }), {
    onPrompt: options.onPrompt,
    app: 'Ethereum',
  });
  return out.address;
}

/** Ledger r/s/v → a signed raw tx that must recover to `expectedAddress`. Pure. */
export function assembleLedgerEthTx(unsignedHex: string, signature: { r: string; s: string; v: number }, expectedAddress: string): string {
  const raw = applyLedgerSignature(unsignedHex, {
    r: signature.r,
    s: signature.s,
    v: signature.v.toString(16),
  });
  const from = Transaction.from(raw).from;
  if (!from || from.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('The Ledger signature does not match your Ledger address. Nothing was sent.');
  }
  return raw;
}

/** Signs an unsigned EIP-1559 tx (hex from buildUnsignedLedgerTx) on the Ledger. Returns the raw signed tx. */
export async function ledgerSignEthTx(
  signer: EthSignerLike,
  unsignedHex: string,
  expectedAddress: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  const bytes = hexToBytes(unsignedHex);
  const signature = await awaitDeviceAction(signer.signTransaction(options.path ?? LEDGER_ETH_PATH, bytes), {
    onPrompt: options.onPrompt,
    app: 'Ethereum',
  });
  return assembleLedgerEthTx(unsignedHex, signature, expectedAddress);
}

export async function ledgerSolanaAddress(
  signer: SolSignerLike,
  options: { path?: string; checkOnDevice?: boolean; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  const out = await awaitDeviceAction(signer.getAddress(options.path ?? LEDGER_SOL_PATH, { checkOnDevice: options.checkOnDevice ?? false }), {
    onPrompt: options.onPrompt,
    app: 'Solana',
  });
  return typeof out === 'string' ? out : encodeBase58(out);
}

/** Puts a Ledger ed25519 signature into the signer slot of `address`, after verifying it. Pure. */
export function applyLedgerSolanaSignature(wire: Uint8Array, address: string, signature: Uint8Array): { wire: Uint8Array; signature: string } {
  const tx = parseSolanaTransaction(wire);
  const index = tx.staticKeys.slice(0, tx.numRequiredSignatures).indexOf(address);
  if (index < 0) {
    throw new Error('This Solana transaction does not need your Ledger to sign.');
  }
  if (signature.length !== 64 || !ed25519.verify(signature, tx.messageBytes, decodeBase58(address))) {
    throw new Error('The Ledger signature does not verify for your Ledger address. Nothing was sent.');
  }
  const out = wire.slice();
  // Wire layout: compact-u16 signature count, then 64-byte signatures, then the message.
  const headerLength = wire.length - tx.messageBytes.length - tx.signatures.length * 64;
  out.set(signature, headerLength + index * 64);
  return { wire: out, signature: encodeBase58(signature) };
}

/** Signs a Solana wire transaction on the Ledger (the device sees the message bytes) and returns the signed wire. */
export async function ledgerSignSolanaTx(
  signer: SolSignerLike,
  wire: Uint8Array,
  address: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<{ wire: Uint8Array; signature: string }> {
  const { messageBytes } = parseSolanaTransaction(wire);
  const raw = await awaitDeviceAction(signer.signTransaction(options.path ?? LEDGER_SOL_PATH, messageBytes), {
    onPrompt: options.onPrompt,
    app: 'Solana',
  });
  const signature = typeof raw === 'string' ? decodeBase58(raw) : raw;
  return applyLedgerSolanaSignature(wire, address, signature);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hexNoPrefix(hex);
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('Invalid hex.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Show-on-device verification: the Ledger displays its ETH address and the user approves only if it matches the
 * one on the phone. The device's answer must also equal `expected`, so a swapped address on screen is caught.
 */
export async function ledgerVerifyEthAddress(
  signer: EthSignerLike,
  expected: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  const shown = await ledgerEthAddress(signer, { ...options, checkOnDevice: true });
  if (shown.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('The Ledger returned a different address than the one saved in BoreDefi. Do not use it.');
  }
  return shown;
}

export async function ledgerVerifySolanaAddress(
  signer: SolSignerLike,
  expected: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  const shown = await ledgerSolanaAddress(signer, { ...options, checkOnDevice: true });
  if (shown !== expected) {
    throw new Error('The Ledger returned a different Solana address than the one saved in BoreDefi. Do not use it.');
  }
  return shown;
}

/** Ledger {r, s, v} → a 65-byte 0x signature (v = 27/28). Pure. */
export function ledgerEthSignatureHex(signature: LedgerEthSignature): string {
  const v = signature.v >= 27 ? signature.v : signature.v + 27;
  return Signature.from({
    r: `0x${hexNoPrefix(signature.r).padStart(64, '0')}`,
    s: `0x${hexNoPrefix(signature.s).padStart(64, '0')}`,
    v,
  }).serialized;
}

/**
 * personal_sign on the Ledger. `message` is UTF-8 text or 0x-hex bytes (as WalletConnect sends it). The signature
 * must recover to `expectedAddress` before it is returned.
 */
export async function ledgerSignEthMessage(
  signer: EthSignerLike,
  message: string | Uint8Array,
  expectedAddress: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  if (!signer.signMessage) {
    throw new Error('This Ledger connection cannot sign messages.');
  }
  const bytes = typeof message === 'string' ? (/^0x([0-9a-f]{2})*$/i.test(message) ? getBytes(message) : toUtf8Bytes(message)) : message;
  const raw = await awaitDeviceAction(signer.signMessage(options.path ?? LEDGER_ETH_PATH, bytes), {
    onPrompt: options.onPrompt,
    app: 'Ethereum',
  });
  const signature = ledgerEthSignatureHex(raw);
  if (verifyMessage(bytes, signature).toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('The Ledger signature does not match your Ledger address. Nothing was shared.');
  }
  return signature;
}

/** eth_signTypedData_v4 on the Ledger; the signature must recover to `expectedAddress`. */
export async function ledgerSignEthTypedData(
  signer: EthSignerLike,
  typedData: LedgerTypedData,
  expectedAddress: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<string> {
  if (!signer.signTypedData) {
    throw new Error('This Ledger connection cannot sign typed data.');
  }
  const raw = await awaitDeviceAction(signer.signTypedData(options.path ?? LEDGER_ETH_PATH, typedData), {
    onPrompt: options.onPrompt,
    app: 'Ethereum',
  });
  const signature = ledgerEthSignatureHex(raw);
  const { EIP712Domain: _domain, ...types } = typedData.types;
  void _domain;
  // Hash check first so a malformed payload fails with a clear error rather than a recover mismatch.
  TypedDataEncoder.hash(typedData.domain as never, types, typedData.message);
  if (verifyTypedData(typedData.domain as never, types, typedData.message, signature).toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('The Ledger signature does not match your Ledger address. Nothing was shared.');
  }
  return signature;
}

/**
 * Parses the Solana signer kit's off-chain message envelope ([1][64-byte signature][signed message bytes]) and
 * verifies the ed25519 signature against `address`. The signed bytes must end with the message the user asked for.
 * Pure.
 */
export function verifyLedgerSolanaMessage(envelopeOrSignature: string, message: Uint8Array, address: string): { signature: string; signedBytes: Uint8Array } {
  const bytes = decodeBase58(envelopeOrSignature);
  const pub = decodeBase58(address);
  let signature: Uint8Array;
  let signedBytes: Uint8Array;
  if (bytes.length === 64) {
    signature = bytes;
    signedBytes = message;
  } else if (bytes.length > 65 && bytes[0] === 1) {
    signature = bytes.slice(1, 65);
    signedBytes = bytes.slice(65);
    const tail = signedBytes.slice(signedBytes.length - message.length);
    if (signedBytes.length < message.length || tail.some((b, i) => b !== message[i])) {
      throw new Error('The Ledger signed a different message. Nothing was shared.');
    }
  } else {
    throw new Error('The Ledger returned an unexpected Solana signature.');
  }
  if (!ed25519.verify(signature, signedBytes, pub)) {
    throw new Error('The Ledger signature does not verify for your Ledger address. Nothing was shared.');
  }
  return { signature: encodeBase58(signature), signedBytes };
}

/** Solana off-chain message signing on the Ledger (the device shows the text). */
export async function ledgerSignSolanaMessage(
  signer: SolSignerLike,
  message: string | Uint8Array,
  address: string,
  options: { path?: string; onPrompt?: (m: string | null) => void } = {},
): Promise<{ signature: string; signedBytes: Uint8Array }> {
  if (!signer.signMessage) {
    throw new Error('This Ledger connection cannot sign Solana messages.');
  }
  const bytes = typeof message === 'string' ? toUtf8Bytes(message) : message;
  const out = await awaitDeviceAction(signer.signMessage(options.path ?? LEDGER_SOL_PATH, bytes), {
    onPrompt: options.onPrompt,
    app: 'Solana',
  });
  return verifyLedgerSolanaMessage(out.signature, bytes, address);
}


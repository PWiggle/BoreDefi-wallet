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
import { Transaction } from 'ethers';
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
export type EthSignerLike = {
  getAddress: (path: string, options?: { checkOnDevice?: boolean }) => DeviceActionLike<{ address: string; publicKey: string }>;
  signTransaction: (path: string, tx: Uint8Array, options?: Record<string, unknown>) => DeviceActionLike<{ r: string; s: string; v: number }>;
};
export type SolSignerLike = {
  getAddress: (path: string, options?: { checkOnDevice?: boolean }) => DeviceActionLike<string | Uint8Array>;
  signTransaction: (path: string, tx: Uint8Array, options?: Record<string, unknown>) => DeviceActionLike<Uint8Array | string>;
};

/** Scans until the first Ledger shows up (or timeout), then opens a session to it. */
export async function connectFirstLedger(
  dmk: DmkLike,
  options: { timeoutMs?: number; pick?: (device: DiscoveredLedger) => boolean } = {},
): Promise<{ sessionId: string; device: DiscoveredLedger }> {
  const device = await new Promise<DiscoveredLedger>((resolve, reject) => {
    let sub: { unsubscribe: () => void } | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      sub?.unsubscribe();
      void dmk.stopDiscovering().catch(() => undefined);
      reject(new Error('No Ledger found. Turn it on, unlock it, keep Bluetooth on, and stay close to the phone.'));
    }, options.timeoutMs ?? 30_000);
    sub = dmk.startDiscovering({}).subscribe({
      next: (found) => {
        if (settled || (options.pick && !options.pick(found))) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        queueMicrotask(() => sub?.unsubscribe());
        void dmk.stopDiscovering().catch(() => undefined);
        resolve(found);
      },
      error: (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
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

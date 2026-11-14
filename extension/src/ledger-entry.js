// Ledger over USB (WebHID) for the Chrome extension, on Ledger's Device Management Kit (replaces hw-app-eth).
import { DeviceActionStatus, DeviceManagementKitBuilder } from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid';

const PATH = "44'/60'/0'/0/0";

let dmk = null;
let sessionId = null;
let signer = null;

function run(action, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      action.cancel();
      reject(new Error('The Ledger did not answer in time.'));
    }, timeoutMs);
    const sub = action.observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Completed) {
          clearTimeout(timer);
          queueMicrotask(() => sub.unsubscribe());
          resolve(state.output);
        } else if (state.status === DeviceActionStatus.Error || state.status === DeviceActionStatus.Stopped) {
          clearTimeout(timer);
          queueMicrotask(() => sub.unsubscribe());
          reject(new Error(state.error?.message ?? 'The Ledger did not sign.'));
        }
      },
      error: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

export async function connect() {
  dmk = dmk ?? new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
  const device = await new Promise((resolve, reject) => {
    const sub = dmk.startDiscovering({}).subscribe({
      next: (found) => {
        queueMicrotask(() => sub.unsubscribe());
        resolve(found);
      },
      error: reject,
    });
  });
  sessionId = await dmk.connect({ device });
  signer = new SignerEthBuilder({ dmk, sessionId }).build();
  const { address } = await run(signer.getAddress(PATH, { checkOnDevice: false }));
  return { address, path: PATH };
}

/** Returns { r, s, v } like hw-app-eth did (hex strings without 0x; v as hex). */
export async function signRaw(rawTxHex) {
  if (!signer) {
    throw new Error('Connect Ledger first.');
  }
  const hex = rawTxHex.replace(/^0x/i, '');
  const bytes = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  const sig = await run(signer.signTransaction(PATH, bytes));
  return { r: sig.r.replace(/^0x/i, ''), s: sig.s.replace(/^0x/i, ''), v: sig.v.toString(16) };
}

export async function disconnect() {
  try {
    if (dmk && sessionId) {
      await dmk.disconnect({ sessionId });
    }
  } catch {
    // Device already gone.
  }
  sessionId = null;
  signer = null;
}

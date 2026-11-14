/**
 * Ledger Nano X over Bluetooth on Android / iOS, through Ledger's Device Management Kit and its React Native BLE
 * transport (react-native-ble-plx). Off by default, per platform, so store builds are unchanged until Patrick has
 * tested it on his Nano X:
 *  - Android: EXPO_PUBLIC_LEDGER_BLE=1 (set in the `ledger-test` EAS profile / local test builds).
 *  - iPhone:  EXPO_PUBLIC_LEDGER_BLE_IOS=1 as well. Hidden on iPhone by default even when the Android flag is on;
 *             flip it for an iPhone test build once pairing and signing are verified.
 * app.config.js uses the same flags to decide whether the Bluetooth native module and permissions are in the build.
 *
 * The DMK and signer kits are loaded lazily the first time someone taps Connect, so they cost nothing at app start.
 */
import {
  connectFirstLedger,
  ledgerEthAddress,
  ledgerSolanaAddress,
  type DmkLike,
  type EthSignerLike,
  type SolSignerLike,
} from './ledger-dmk';

// Literal process.env reads so Expo inlines them at bundle time.
const BUILD_LEDGER_BLE: string | undefined = process.env.EXPO_PUBLIC_LEDGER_BLE;
const BUILD_LEDGER_BLE_IOS: string | undefined = process.env.EXPO_PUBLIC_LEDGER_BLE_IOS;

export function ledgerBleFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  return flag === '1' || flag === 'true';
}

/** Pure: is Ledger Bluetooth on for this platform? iOS needs both flags (hidden on iPhone by default). */
export function ledgerBleEnabledFor(os: string, android: string | undefined, ios: string | undefined): boolean {
  if (os === 'ios') {
    return ledgerBleFlag(android) && ledgerBleFlag(ios);
  }
  if (os === 'android') {
    return ledgerBleFlag(android);
  }
  return false;
}

function currentOs(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native') as typeof import('react-native')).Platform.OS;
  } catch {
    return 'node';
  }
}

export const LEDGER_BLE_ENABLED = ledgerBleEnabledFor(currentOs(), BUILD_LEDGER_BLE, BUILD_LEDGER_BLE_IOS);

export type LedgerBleSession = {
  sessionId: string;
  /** Bluetooth id of the Nano X, remembered (public, not secret) so Reconnect finds the same device. */
  deviceId: string;
  deviceName: string;
  ethAddress: string;
  /** Null when the Solana app isn't installed / open; ETH still works. */
  solanaAddress: string | null;
  eth: EthSignerLike;
  solana: SolSignerLike;
  disconnect: () => Promise<void>;
};

type DmkModule = typeof import('@ledgerhq/device-management-kit');

let dmkInstance: (DmkLike & { close?: () => void }) | null = null;

async function bleDmk(): Promise<DmkLike> {
  if (dmkInstance) {
    return dmkInstance;
  }
  const [{ DeviceManagementKitBuilder }, { RNBleTransportFactory }] = (await Promise.all([
    import('@ledgerhq/device-management-kit'),
    import('@ledgerhq/device-transport-kit-react-native-ble'),
  ])) as [DmkModule, typeof import('@ledgerhq/device-transport-kit-react-native-ble')];
  dmkInstance = new DeviceManagementKitBuilder().addTransport(RNBleTransportFactory).build() as unknown as DmkLike;
  return dmkInstance;
}

/**
 * Scans for the first Ledger, opens a session, and reads the ETH address (and the Solana address when the
 * Solana app is available). Asks for Bluetooth permission through the transport on first use.
 */
export async function connectLedgerBle(
  onPrompt?: (message: string | null) => void,
  options: { preferDeviceId?: string | null } = {},
): Promise<LedgerBleSession> {
  if (!LEDGER_BLE_ENABLED) {
    throw new Error('Ledger over Bluetooth is not turned on in this build.');
  }
  const dmk = await bleDmk();
  onPrompt?.('Looking for your Ledger. Turn it on, unlock it, and keep Bluetooth on.');
  const preferred = options.preferDeviceId ?? null;
  const { sessionId, device } = await connectFirstLedger(dmk, {
    timeoutMs: 30_000,
    // Reconnect: wait for the remembered Nano X first; any Ledger after 10 s (ids can change after re-pairing).
    preferId: preferred,
    graceMs: 10_000,
  });
  const [{ SignerEthBuilder }, { SignerSolanaBuilder }] = await Promise.all([
    import('@ledgerhq/device-signer-kit-ethereum'),
    import('@ledgerhq/device-signer-kit-solana'),
  ]);
  const eth = new SignerEthBuilder({ dmk: dmk as never, sessionId }).build() as unknown as EthSignerLike;
  const solana = new SignerSolanaBuilder({ dmk: dmk as never, sessionId }).build() as unknown as SolSignerLike;
  const ethAddress = await ledgerEthAddress(eth, { onPrompt });
  const solanaAddress = await ledgerSolanaAddress(solana, { onPrompt }).catch(() => null);
  return {
    sessionId,
    deviceId: device.id,
    deviceName: device.name,
    ethAddress,
    solanaAddress,
    eth,
    solana,
    disconnect: () => dmk.disconnect({ sessionId }).catch(() => undefined),
  };
}


/**
 * Ledger Nano X over Bluetooth on Android / iOS, through Ledger's Device Management Kit and its React Native BLE
 * transport (react-native-ble-plx). Off by default: EXPO_PUBLIC_LEDGER_BLE=1 turns it on for a test build, so the
 * 1.0.10 store builds are unchanged until Patrick has tested it on his Nano X.
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

const BUILD_LEDGER_BLE: string | undefined = process.env.EXPO_PUBLIC_LEDGER_BLE;

export function ledgerBleFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  return flag === '1' || flag === 'true';
}

export const LEDGER_BLE_ENABLED = ledgerBleFlag(BUILD_LEDGER_BLE);

export type LedgerBleSession = {
  sessionId: string;
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
export async function connectLedgerBle(onPrompt?: (message: string | null) => void): Promise<LedgerBleSession> {
  if (!LEDGER_BLE_ENABLED) {
    throw new Error('Ledger over Bluetooth is not turned on in this build.');
  }
  const dmk = await bleDmk();
  onPrompt?.('Looking for your Ledger. Turn it on, unlock it, and keep Bluetooth on.');
  const { sessionId, device } = await connectFirstLedger(dmk, { timeoutMs: 30_000 });
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
    deviceName: device.name,
    ethAddress,
    solanaAddress,
    eth,
    solana,
    disconnect: () => dmk.disconnect({ sessionId }).catch(() => undefined),
  };
}

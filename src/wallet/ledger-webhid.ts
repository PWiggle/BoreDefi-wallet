/**
 * Ledger over USB (WebHID) for Expo web and the Chrome extension, on Ledger's Device Management Kit. Replaces the
 * legacy LedgerJS packages (@ledgerhq/hw-app-eth + hw-transport-webhid), which pulled in ethers v5, elliptic and
 * axios. Same signing checks as Bluetooth: the signed tx must recover to the Ledger address.
 */
import { connectFirstLedger, ledgerEthAddress, ledgerSignEthTx, type DmkLike, type EthSignerLike } from './ledger-dmk';

export type LedgerWebHidSession = {
  ethAddress: string;
  deviceName: string;
  signEthTx: (unsignedHex: string, expectedAddress: string, onPrompt?: (message: string | null) => void) => Promise<string>;
  disconnect: () => Promise<void>;
};

let dmk: DmkLike | null = null;

export async function connectLedgerWebHid(onPrompt?: (message: string | null) => void): Promise<LedgerWebHidSession> {
  if (!dmk) {
    const [{ DeviceManagementKitBuilder }, { webHidTransportFactory }] = await Promise.all([
      import('@ledgerhq/device-management-kit'),
      import('@ledgerhq/device-transport-kit-web-hid'),
    ]);
    dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build() as unknown as DmkLike;
  }
  const kit = dmk;
  // WebHID shows Chrome's device picker; the user picks the Ledger.
  const { sessionId, device } = await connectFirstLedger(kit, { timeoutMs: 60_000 });
  const { SignerEthBuilder } = await import('@ledgerhq/device-signer-kit-ethereum');
  const eth = new SignerEthBuilder({ dmk: kit as never, sessionId }).build() as unknown as EthSignerLike;
  const ethAddress = await ledgerEthAddress(eth, { onPrompt });
  return {
    ethAddress,
    deviceName: device.name,
    signEthTx: (unsignedHex, expected, prompt) => ledgerSignEthTx(eth, unsignedHex, expected, { onPrompt: prompt ?? onPrompt }),
    disconnect: () => kit.disconnect({ sessionId }).catch(() => undefined),
  };
}

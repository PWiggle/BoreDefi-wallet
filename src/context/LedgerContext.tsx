import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  connectLedger,
  detectLedgerTransportKind,
  disconnectLedger,
  getConnectedLedger,
  ledgerGapMessage,
  setBleLedger,
  signAndBroadcastLedger,
  type LedgerAccount,
  type LedgerTransportKind,
  type LedgerUnsignedTx,
} from '../wallet/ledger';
import { connectLedgerBle, LEDGER_BLE_ENABLED } from '../wallet/ledger-ble';
import { LEDGER_ETH_PATH, ledgerSignEthTx } from '../wallet/ledger-dmk';

type LedgerContextValue = {
  account: LedgerAccount | null;
  connecting: boolean;
  error: string | null;
  transportKind: LedgerTransportKind;
  gapMessage: string | null;
  /** Bluetooth (Nano X) is available in this build (EXPO_PUBLIC_LEDGER_BLE=1, Android / iOS). */
  bleEnabled: boolean;
  /** What the Ledger is waiting for ("Unlock your Ledger…", "Review the transaction…"), while it waits. */
  prompt: string | null;
  connect: () => Promise<void>;
  connectBle: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSend: (tx: LedgerUnsignedTx) => Promise<string>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<LedgerAccount | null>(getConnectedLedger());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setAccount(await connectLedger());
    } catch (err) {
      setAccount(null);
      setError(err instanceof Error ? err.message : 'Ledger connect failed.');
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectBle = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const session = await connectLedgerBle(setPrompt);
      const next: LedgerAccount = {
        address: session.ethAddress,
        path: LEDGER_ETH_PATH,
        transportKind: 'ble',
        solanaAddress: session.solanaAddress,
        deviceName: session.deviceName,
      };
      setBleLedger(next, {
        signEthTx: (unsignedHex, expected, onPrompt) =>
          ledgerSignEthTx(session.eth, unsignedHex, expected, { onPrompt: onPrompt ?? setPrompt }),
        disconnect: session.disconnect,
      });
      setAccount(next);
    } catch (err) {
      setAccount(null);
      setError(err instanceof Error ? err.message : 'Ledger connect failed.');
      throw err;
    } finally {
      setPrompt(null);
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectLedger();
    setAccount(null);
    setError(null);
  }, []);

  const signAndSend = useCallback(async (tx: LedgerUnsignedTx) => {
    try {
      return await signAndBroadcastLedger(tx, setPrompt);
    } finally {
      setPrompt(null);
    }
  }, []);

  const value = useMemo<LedgerContextValue>(
    () => ({
      account,
      connecting,
      error,
      transportKind: account?.transportKind ?? (LEDGER_BLE_ENABLED ? 'ble' : detectLedgerTransportKind()),
      gapMessage: ledgerGapMessage(LEDGER_BLE_ENABLED),
      bleEnabled: LEDGER_BLE_ENABLED,
      prompt,
      connect,
      connectBle,
      disconnect,
      signAndSend,
    }),
    [account, connect, connectBle, connecting, disconnect, error, prompt, signAndSend],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerContextValue {
  const value = useContext(LedgerContext);
  if (!value) {
    throw new Error('useLedger must be used inside LedgerProvider');
  }
  return value;
}

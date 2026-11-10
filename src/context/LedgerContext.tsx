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
  signAndBroadcastLedger,
  type LedgerAccount,
  type LedgerTransportKind,
  type LedgerUnsignedTx,
} from '../wallet/ledger';

type LedgerContextValue = {
  account: LedgerAccount | null;
  connecting: boolean;
  error: string | null;
  transportKind: LedgerTransportKind;
  gapMessage: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSend: (tx: LedgerUnsignedTx) => Promise<string>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<LedgerAccount | null>(getConnectedLedger());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const disconnect = useCallback(async () => {
    await disconnectLedger();
    setAccount(null);
    setError(null);
  }, []);

  const signAndSend = useCallback(async (tx: LedgerUnsignedTx) => {
    return signAndBroadcastLedger(tx);
  }, []);

  const value = useMemo<LedgerContextValue>(
    () => ({
      account,
      connecting,
      error,
      transportKind: detectLedgerTransportKind(),
      gapMessage: ledgerGapMessage(),
      connect,
      disconnect,
      signAndSend,
    }),
    [account, connect, connecting, disconnect, error, signAndSend],
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

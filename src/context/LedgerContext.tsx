import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { logger } from '../logger';
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
import { connectLedgerBle, LEDGER_BLE_ENABLED, type LedgerBleSession } from '../wallet/ledger-ble';
import {
  LEDGER_ETH_PATH,
  LEDGER_SOL_PATH,
  ledgerSignEthMessage,
  ledgerSignEthTx,
  ledgerSignEthTypedData,
  ledgerSignSolanaMessage,
  ledgerSignSolanaTx,
  ledgerVerifyEthAddress,
  ledgerVerifySolanaAddress,
  type LedgerTypedData,
} from '../wallet/ledger-dmk';
import { ledgerWatchFromSession, type LedgerWatchAccount } from '../wallet/ledger-watch';
import { clearLedgerWatch, loadLedgerWatch, saveLedgerWatch } from '../wallet/storage';

type LedgerContextValue = {
  /** The live, connected Ledger (signing works). Null while only the watch-only account is known. */
  account: LedgerAccount | null;
  /** Watch-only: the last paired Nano X's public addresses, saved on this phone. Shown even when disconnected. */
  watch: LedgerWatchAccount | null;
  connecting: boolean;
  error: string | null;
  transportKind: LedgerTransportKind;
  gapMessage: string | null;
  /** Bluetooth (Nano X) is available in this build (EXPO_PUBLIC_LEDGER_BLE=1; iPhone also needs EXPO_PUBLIC_LEDGER_BLE_IOS=1). */
  bleEnabled: boolean;
  /** What the Ledger is waiting for ("Unlock your Ledger…", "Review the transaction…"), while it waits. */
  prompt: string | null;
  connect: () => Promise<void>;
  connectBle: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Removes the saved watch-only addresses from this phone (and disconnects). The Ledger is untouched. */
  forget: () => Promise<void>;
  signAndSend: (tx: LedgerUnsignedTx) => Promise<string>;
  /** Shows the address on the Ledger screen; resolves only if the device returns the same address. */
  verifyOnDevice: (chain: 'eth' | 'solana') => Promise<string>;
  signEthMessage: (message: string | Uint8Array) => Promise<string>;
  signEthTypedData: (typedData: LedgerTypedData) => Promise<string>;
  signSolanaMessage: (message: string | Uint8Array) => Promise<string>;
  /** Signs a Solana wire transaction for the Ledger's Solana address; returns the signed wire + signature id. */
  signSolanaTx: (wire: Uint8Array) => Promise<{ wire: Uint8Array; signature: string }>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<LedgerAccount | null>(getConnectedLedger());
  const [watch, setWatch] = useState<LedgerWatchAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const session = useRef<LedgerBleSession | null>(null);
  const watchRef = useRef<LedgerWatchAccount | null>(null);
  watchRef.current = watch;

  useEffect(() => {
    if (!LEDGER_BLE_ENABLED) {
      return;
    }
    let alive = true;
    loadLedgerWatch()
      .then((saved) => {
        if (alive) {
          setWatch(saved);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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

  /** Opens (or reuses) the Bluetooth session. Reconnects to the remembered Nano X and checks it is the same account. */
  const ensureBle = useCallback(async (): Promise<LedgerBleSession> => {
    if (session.current) {
      return session.current;
    }
    const saved = watchRef.current;
    const next = await connectLedgerBle(setPrompt, { preferDeviceId: saved?.deviceId });
    if (saved && saved.ethAddress.toLowerCase() !== next.ethAddress.toLowerCase()) {
      // A different Ledger (or a different seed on it): treat it as a new account, never silently swap.
      logger.info('Ledger account changed on reconnect');
    }
    session.current = next;
    const live: LedgerAccount = {
      address: next.ethAddress,
      path: LEDGER_ETH_PATH,
      transportKind: 'ble',
      solanaAddress: next.solanaAddress,
      deviceName: next.deviceName,
    };
    setBleLedger(live, {
      signEthTx: (unsignedHex, expected, onPrompt) => ledgerSignEthTx(next.eth, unsignedHex, expected, { onPrompt: onPrompt ?? setPrompt }),
      disconnect: next.disconnect,
    });
    setAccount(live);
    const record = ledgerWatchFromSession(
      { ...next, ethPath: LEDGER_ETH_PATH, solanaPath: LEDGER_SOL_PATH },
      saved && saved.ethAddress.toLowerCase() === next.ethAddress.toLowerCase() ? saved : null,
    );
    setWatch(record);
    await saveLedgerWatch(record).catch(() => undefined);
    return next;
  }, []);

  const connectBle = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await ensureBle();
    } catch (err) {
      session.current = null;
      setAccount(null);
      setError(err instanceof Error ? err.message : 'Ledger connect failed.');
      throw err;
    } finally {
      setPrompt(null);
      setConnecting(false);
    }
  }, [ensureBle]);

  const disconnect = useCallback(async () => {
    session.current = null;
    await disconnectLedger();
    setAccount(null);
    setError(null);
  }, []);

  const forget = useCallback(async () => {
    await disconnect();
    await clearLedgerWatch().catch(() => undefined);
    setWatch(null);
  }, [disconnect]);

  /** Runs one device operation with a live session, turning failures into the on-screen error. */
  const withSession = useCallback(
    async <T,>(run: (s: LedgerBleSession) => Promise<T>): Promise<T> => {
      setError(null);
      try {
        const s = await ensureBle();
        return await run(s);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The Ledger did not answer.';
        if (/disconnected/i.test(message)) {
          session.current = null;
          await disconnectLedger();
          setAccount(null);
        }
        setError(message);
        throw err;
      } finally {
        setPrompt(null);
      }
    },
    [ensureBle],
  );

  const signAndSend = useCallback(
    async (tx: LedgerUnsignedTx) => {
      if (LEDGER_BLE_ENABLED && !getConnectedLedger() && watchRef.current) {
        await ensureBle();
      }
      try {
        return await signAndBroadcastLedger(tx, setPrompt);
      } finally {
        setPrompt(null);
      }
    },
    [ensureBle],
  );

  const verifyOnDevice = useCallback(
    (chain: 'eth' | 'solana') =>
      withSession(async (s) => {
        if (chain === 'eth') {
          await ledgerVerifyEthAddress(s.eth, s.ethAddress, { onPrompt: setPrompt });
          const verifiedAt = new Date().toISOString();
          const current = watchRef.current;
          if (current) {
            const next = { ...current, verifiedAt };
            setWatch(next);
            await saveLedgerWatch(next).catch(() => undefined);
          }
          return s.ethAddress;
        }
        if (!s.solanaAddress) {
          throw new Error('Open the Solana app on your Ledger, then reconnect.');
        }
        return ledgerVerifySolanaAddress(s.solana, s.solanaAddress, { onPrompt: setPrompt });
      }),
    [withSession],
  );

  const signEthMessage = useCallback(
    (message: string | Uint8Array) => withSession((s) => ledgerSignEthMessage(s.eth, message, s.ethAddress, { onPrompt: setPrompt })),
    [withSession],
  );
  const signEthTypedData = useCallback(
    (typedData: LedgerTypedData) => withSession((s) => ledgerSignEthTypedData(s.eth, typedData, s.ethAddress, { onPrompt: setPrompt })),
    [withSession],
  );
  const signSolanaMessage = useCallback(
    (message: string | Uint8Array) =>
      withSession(async (s) => {
        if (!s.solanaAddress) {
          throw new Error('Open the Solana app on your Ledger, then reconnect.');
        }
        return (await ledgerSignSolanaMessage(s.solana, message, s.solanaAddress, { onPrompt: setPrompt })).signature;
      }),
    [withSession],
  );
  const signSolanaTx = useCallback(
    (wire: Uint8Array) =>
      withSession(async (s) => {
        if (!s.solanaAddress) {
          throw new Error('Open the Solana app on your Ledger, then reconnect.');
        }
        return ledgerSignSolanaTx(s.solana, wire, s.solanaAddress, { onPrompt: setPrompt });
      }),
    [withSession],
  );

  const value = useMemo<LedgerContextValue>(
    () => ({
      account,
      watch,
      connecting,
      error,
      transportKind: account?.transportKind ?? (LEDGER_BLE_ENABLED ? 'ble' : detectLedgerTransportKind()),
      gapMessage: ledgerGapMessage(LEDGER_BLE_ENABLED),
      bleEnabled: LEDGER_BLE_ENABLED,
      prompt,
      connect,
      connectBle,
      disconnect,
      forget,
      signAndSend,
      verifyOnDevice,
      signEthMessage,
      signEthTypedData,
      signSolanaMessage,
      signSolanaTx,
    }),
    [
      account,
      watch,
      connect,
      connectBle,
      connecting,
      disconnect,
      error,
      forget,
      prompt,
      signAndSend,
      verifyOnDevice,
      signEthMessage,
      signEthTypedData,
      signSolanaMessage,
      signSolanaTx,
    ],
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

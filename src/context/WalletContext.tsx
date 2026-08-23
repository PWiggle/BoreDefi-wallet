import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { logger } from '../logger';
import { authenticateBiometrics, biometricAvailability } from '../wallet/biometrics';
import { CHAINS, DEFAULT_CHAIN_ID, type ChainConfig, type ChainId } from '../wallet/chains';
import { deriveAddress, generateMnemonic, isValidMnemonic, normalizeMnemonic } from '../wallet/mnemonic';
import { setPin, verifyPin } from '../wallet/pin';
import {
  clearAllWalletData,
  hasPersistedWallet,
  loadSettings,
  loadVault,
  saveSettings,
  saveVault,
  type SettingsRecord,
} from '../wallet/storage';

export type Phase =
  | 'booting'
  | 'welcome'
  | 'backup'
  | 'verify'
  | 'import'
  | 'set-pin'
  | 'locked'
  | 'unlocked';

type PendingWallet = {
  mnemonic: string;
  address: string;
  imported: boolean;
};

type Session = {
  mnemonic: string;
  address: string;
};

type WalletContextValue = {
  phase: Phase;
  pending: PendingWallet | null;
  session: Session | null;
  settings: SettingsRecord;
  address: string | null;
  selectedChain: ChainConfig;
  biometricsReady: boolean;
  startCreate: () => void;
  startImport: () => void;
  cancelOnboarding: () => void;
  confirmBackupViewed: () => void;
  completeVerification: () => void;
  importMnemonic: (phrase: string) => void;
  finalizeSetup: (pin: string, enableBiometrics: boolean) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;
  setSelectedChain: (chainId: ChainId) => Promise<void>;
  setBiometricsEnabled: (enabled: boolean) => Promise<void>;
  revealMnemonic: (pin: string) => Promise<string | null>;
  resetWallet: (pin: string) => Promise<boolean>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('booting');
  const [pending, setPending] = useState<PendingWallet | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<SettingsRecord>({
    biometricsEnabled: false,
    selectedChainId: DEFAULT_CHAIN_ID,
    backupCompleted: false,
  });
  const [biometricsReady, setBiometricsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [exists, storedSettings, bio] = await Promise.all([
          hasPersistedWallet(),
          loadSettings(),
          biometricAvailability(),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(storedSettings);
        setBiometricsReady(bio.hardware && bio.enrolled);
        setPhase(exists ? 'locked' : 'welcome');
      } catch (error) {
        logger.error('Wallet boot failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        if (!cancelled) {
          setPhase('welcome');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lock = useCallback(() => {
    setSession(null);
    setPhase((current) => (current === 'unlocked' ? 'locked' : current));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        lock();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const startCreate = useCallback(() => {
    const mnemonic = generateMnemonic(12);
    setPending({
      mnemonic,
      address: deriveAddress(mnemonic),
      imported: false,
    });
    setPhase('backup');
  }, []);

  const startImport = useCallback(() => {
    setPending(null);
    setPhase('import');
  }, []);

  const cancelOnboarding = useCallback(() => {
    setPending(null);
    setPhase('welcome');
  }, []);

  const confirmBackupViewed = useCallback(() => {
    if (pending && !pending.imported) {
      setPhase('verify');
    }
  }, [pending]);

  const completeVerification = useCallback(() => {
    if (pending) {
      setPhase('set-pin');
    }
  }, [pending]);

  const importMnemonic = useCallback((phrase: string) => {
    const normalized = normalizeMnemonic(phrase);
    if (!isValidMnemonic(normalized)) {
      throw new Error('That recovery phrase is not valid BIP39.');
    }
    setPending({
      mnemonic: normalized,
      address: deriveAddress(normalized),
      imported: true,
    });
    setPhase('set-pin');
  }, []);

  const persistSession = useCallback(async (mnemonic: string, address: string) => {
    setSession({ mnemonic, address });
    setPending(null);
    setPhase('unlocked');
  }, []);

  const finalizeSetup = useCallback(
    async (pin: string, enableBiometrics: boolean) => {
      if (!pending) {
        throw new Error('No wallet in progress');
      }
      await setPin(pin);
      await saveVault({
        version: 1,
        address: pending.address,
        mnemonic: pending.mnemonic,
      });
      const nextSettings: SettingsRecord = {
        biometricsEnabled: enableBiometrics && biometricsReady,
        selectedChainId: settings.selectedChainId,
        backupCompleted: true,
      };
      await saveSettings(nextSettings);
      setSettings(nextSettings);
      logger.info('Wallet created locally', { address: pending.address });
      await persistSession(pending.mnemonic, pending.address);
    },
    [biometricsReady, pending, persistSession, settings.selectedChainId],
  );

  const openVault = useCallback(async () => {
    const vault = await loadVault();
    if (!vault) {
      return false;
    }
    await persistSession(vault.mnemonic, vault.address);
    return true;
  }, [persistSession]);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      const ok = await verifyPin(pin);
      if (!ok) {
        return false;
      }
      return openVault();
    },
    [openVault],
  );

  const unlockWithBiometrics = useCallback(async () => {
    if (!settings.biometricsEnabled) {
      return false;
    }
    const ok = await authenticateBiometrics();
    if (!ok) {
      return false;
    }
    return openVault();
  }, [openVault, settings.biometricsEnabled]);

  const setSelectedChain = useCallback(
    async (chainId: ChainId) => {
      const next = { ...settings, selectedChainId: chainId };
      setSettings(next);
      await saveSettings(next);
    },
    [settings],
  );

  const setBiometricsEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const ok = await authenticateBiometrics('Enable biometric unlock');
        if (!ok) {
          return;
        }
      }
      const next = { ...settings, biometricsEnabled: enabled };
      setSettings(next);
      await saveSettings(next);
    },
    [settings],
  );

  const revealMnemonic = useCallback(async (pin: string) => {
    const ok = await verifyPin(pin);
    if (!ok) {
      return null;
    }
    const vault = await loadVault();
    return vault?.mnemonic ?? null;
  }, []);

  const resetWallet = useCallback(async (pin: string) => {
    const ok = await verifyPin(pin);
    if (!ok) {
      return false;
    }
    await clearAllWalletData();
    setSession(null);
    setPending(null);
    setSettings({
      biometricsEnabled: false,
      selectedChainId: DEFAULT_CHAIN_ID,
      backupCompleted: false,
    });
    setPhase('welcome');
    return true;
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      phase,
      pending,
      session,
      settings,
      address: session?.address ?? pending?.address ?? null,
      selectedChain: CHAINS[settings.selectedChainId],
      biometricsReady,
      startCreate,
      startImport,
      cancelOnboarding,
      confirmBackupViewed,
      completeVerification,
      importMnemonic,
      finalizeSetup,
      unlockWithPin,
      unlockWithBiometrics,
      lock,
      setSelectedChain,
      setBiometricsEnabled,
      revealMnemonic,
      resetWallet,
    }),
    [
      biometricsReady,
      cancelOnboarding,
      completeVerification,
      confirmBackupViewed,
      finalizeSetup,
      importMnemonic,
      lock,
      pending,
      phase,
      resetWallet,
      revealMnemonic,
      session,
      setBiometricsEnabled,
      setSelectedChain,
      settings,
      startCreate,
      startImport,
      unlockWithBiometrics,
      unlockWithPin,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error('useWallet must be used inside WalletProvider');
  }
  return value;
}

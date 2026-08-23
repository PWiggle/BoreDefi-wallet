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
import { AppState, Platform } from 'react-native';

import { logger } from '../logger';
import type { AppearanceMode } from '../theme';
import { autoLockMs, type AutoLockMode } from '../wallet/auto-lock';
import { authenticateBiometrics, biometricAvailability } from '../wallet/biometrics';
import { CHAINS, DEFAULT_CHAIN_ID, type ChainConfig, type ChainId } from '../wallet/chains';
import { deriveAddress, generateMnemonic, isValidMnemonic, normalizeMnemonic } from '../wallet/mnemonic';
import {
  clearedPinLockState,
  isValidPin,
  nextPinLockState,
  remainingLockMs,
  setPin,
  verifyPin,
} from '../wallet/pin';
import {
  clearAllWalletData,
  clearBiometricDek,
  defaultSettings,
  hasPersistedWallet,
  loadBiometricDek,
  loadSettings,
  loadStoredVault,
  saveBiometricDek,
  saveEncryptedVault,
  saveSettings,
  type SettingsRecord,
} from '../wallet/storage';
import {
  encryptVault,
  isVaultV1,
  migrateVaultV1,
  rewrapVault,
  tryDecryptVault,
  tryOpenVaultWithDek,
} from '../wallet/vault-crypto';

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
  dek: Uint8Array | null;
};

type WalletContextValue = {
  phase: Phase;
  pending: PendingWallet | null;
  session: Session | null;
  settings: SettingsRecord;
  address: string | null;
  selectedChain: ChainConfig;
  biometricsReady: boolean;
  pinBackoffMs: number;
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
  setAutoLock: (mode: AutoLockMode) => Promise<void>;
  setAppearance: (mode: AppearanceMode) => Promise<void>;
  setHideBalances: (hidden: boolean) => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  revealMnemonic: (pin: string) => Promise<string | null>;
  revealWithBiometrics: () => Promise<string | null>;
  resetWallet: (pin: string) => Promise<boolean>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('booting');
  const [pending, setPending] = useState<PendingWallet | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<SettingsRecord>(defaultSettings);
  const [biometricsReady, setBiometricsReady] = useState(false);
  const [pinBackoffMs, setPinBackoffMs] = useState(0);
  const settingsRef = useRef(settings);
  const hiddenAtRef = useRef<number | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  settingsRef.current = settings;

  const persistSettings = useCallback(async (next: SettingsRecord) => {
    settingsRef.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

  const patchSettings = useCallback(
    async (patch: Partial<SettingsRecord>) => {
      await persistSettings({ ...settingsRef.current, ...patch });
    },
    [persistSettings],
  );

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
        settingsRef.current = storedSettings;
        setPinBackoffMs(remainingLockMs(storedSettings.pinLockUntil));
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

  useEffect(() => {
    if (pinBackoffMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setPinBackoffMs(remainingLockMs(settingsRef.current.pinLockUntil));
    }, 250);
    return () => clearInterval(timer);
  }, [pinBackoffMs]);

  const lock = useCallback(() => {
    setSession(null);
    setPhase((current) => (current === 'unlocked' ? 'locked' : current));
  }, []);

  const clearLockTimer = useCallback(() => {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  const handleAppHidden = useCallback(() => {
    const delay = autoLockMs(settingsRef.current.autoLock);
    hiddenAtRef.current = Date.now();
    clearLockTimer();
    if (delay === 0) {
      lock();
      return;
    }
    lockTimerRef.current = setTimeout(() => {
      lock();
    }, delay);
  }, [clearLockTimer, lock]);

  const handleAppVisible = useCallback(() => {
    const delay = autoLockMs(settingsRef.current.autoLock);
    const hiddenAt = hiddenAtRef.current;
    hiddenAtRef.current = null;
    clearLockTimer();
    if (hiddenAt !== null && Date.now() - hiddenAt >= delay) {
      lock();
    }
  }, [clearLockTimer, lock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        handleAppVisible();
      } else {
        handleAppHidden();
      }
    });
    return () => sub.remove();
  }, [handleAppHidden, handleAppVisible]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const onVisibility = () => {
      if (document.hidden) {
        handleAppHidden();
      } else {
        handleAppVisible();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [handleAppHidden, handleAppVisible]);

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

  const persistSession = useCallback(async (next: Session) => {
    setSession(next);
    setPending(null);
    setPhase('unlocked');
  }, []);

  const notePinFailure = useCallback(async () => {
    const next = nextPinLockState(settingsRef.current.pinFailCount);
    await patchSettings(next);
    setPinBackoffMs(remainingLockMs(next.pinLockUntil));
  }, [patchSettings]);

  const notePinSuccess = useCallback(async () => {
    if (settingsRef.current.pinFailCount || settingsRef.current.pinLockUntil) {
      await patchSettings(clearedPinLockState());
    }
    setPinBackoffMs(0);
  }, [patchSettings]);

  const assertPinAvailable = useCallback(() => {
    const wait = remainingLockMs(settingsRef.current.pinLockUntil);
    if (wait > 0) {
      setPinBackoffMs(wait);
      return false;
    }
    return true;
  }, []);

  const persistDekIfNeeded = useCallback(async (dek: Uint8Array | null, bioEnabled: boolean) => {
    if (bioEnabled && dek) {
      await saveBiometricDek(dek);
      return;
    }
    await clearBiometricDek();
  }, []);

  const finalizeSetup = useCallback(
    async (pin: string, enableBiometrics: boolean) => {
      if (!pending) {
        throw new Error('No wallet in progress');
      }
      if (!isValidPin(pin)) {
        throw new Error('PIN must be 6 digits');
      }
      const sealed = encryptVault(pending.mnemonic, pending.address, pin);
      await setPin(pin);
      await saveEncryptedVault(sealed.vault);
      const bio = enableBiometrics && biometricsReady;
      await persistDekIfNeeded(sealed.dek, bio);
      const nextSettings: SettingsRecord = {
        ...settingsRef.current,
        biometricsEnabled: bio,
        backupCompleted: true,
        ...clearedPinLockState(),
      };
      await persistSettings(nextSettings);
      logger.info('Wallet created locally', { address: pending.address });
      await persistSession({
        mnemonic: pending.mnemonic,
        address: pending.address,
        dek: sealed.dek,
      });
    },
    [biometricsReady, pending, persistDekIfNeeded, persistSession, persistSettings],
  );

  const unlockWithPin = useCallback(
    async (pin: string) => {
      if (!assertPinAvailable()) {
        return false;
      }
      const ok = await verifyPin(pin);
      if (!ok) {
        await notePinFailure();
        return false;
      }
      const vault = await loadStoredVault();
      if (!vault) {
        await notePinFailure();
        return false;
      }
      if (isVaultV1(vault)) {
        const sealed = migrateVaultV1(vault, pin);
        await saveEncryptedVault(sealed.vault);
        await persistDekIfNeeded(sealed.dek, settingsRef.current.biometricsEnabled);
        await notePinSuccess();
        await persistSession({
          mnemonic: vault.mnemonic,
          address: vault.address,
          dek: sealed.dek,
        });
        return true;
      }
      const opened = tryDecryptVault(vault, pin);
      if (!opened) {
        await notePinFailure();
        return false;
      }
      await persistDekIfNeeded(opened.dek, settingsRef.current.biometricsEnabled);
      await notePinSuccess();
      await persistSession(opened);
      return true;
    },
    [assertPinAvailable, notePinFailure, notePinSuccess, persistDekIfNeeded, persistSession],
  );

  const unlockWithBiometrics = useCallback(async () => {
    if (!settingsRef.current.biometricsEnabled) {
      return false;
    }
    const ok = await authenticateBiometrics();
    if (!ok) {
      return false;
    }
    const vault = await loadStoredVault();
    if (!vault) {
      return false;
    }
    if (isVaultV1(vault)) {
      await persistSession({ mnemonic: vault.mnemonic, address: vault.address, dek: null });
      return true;
    }
    const dek = await loadBiometricDek();
    if (!dek) {
      return false;
    }
    const opened = tryOpenVaultWithDek(vault, dek);
    if (!opened) {
      return false;
    }
    await persistSession(opened);
    return true;
  }, [persistSession]);

  const setSelectedChain = useCallback(
    async (chainId: ChainId) => {
      await patchSettings({ selectedChainId: chainId });
    },
    [patchSettings],
  );

  const setBiometricsEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const ok = await authenticateBiometrics('Enable biometric unlock');
        if (!ok) {
          return;
        }
      }
      await patchSettings({ biometricsEnabled: enabled });
      await persistDekIfNeeded(session?.dek ?? null, enabled);
    },
    [patchSettings, persistDekIfNeeded, session?.dek],
  );

  const setAutoLock = useCallback(
    async (mode: AutoLockMode) => {
      await patchSettings({ autoLock: mode });
    },
    [patchSettings],
  );

  const setAppearance = useCallback(
    async (mode: AppearanceMode) => {
      await patchSettings({ appearance: mode });
    },
    [patchSettings],
  );

  const setHideBalances = useCallback(
    async (hidden: boolean) => {
      await patchSettings({ hideBalances: hidden });
    },
    [patchSettings],
  );

  const changePin = useCallback(
    async (oldPin: string, newPin: string) => {
      if (!isValidPin(newPin) || !assertPinAvailable()) {
        return false;
      }
      const ok = await verifyPin(oldPin);
      if (!ok) {
        await notePinFailure();
        return false;
      }
      const vault = await loadStoredVault();
      if (!vault) {
        return false;
      }
      const sealed = isVaultV1(vault)
        ? migrateVaultV1(vault, newPin)
        : rewrapVault(vault, oldPin, newPin);
      if (!sealed) {
        await notePinFailure();
        return false;
      }
      await setPin(newPin);
      await saveEncryptedVault(sealed.vault);
      await persistDekIfNeeded(sealed.dek, settingsRef.current.biometricsEnabled);
      await notePinSuccess();
      if (session) {
        setSession({ ...session, dek: sealed.dek });
      }
      return true;
    },
    [assertPinAvailable, notePinFailure, notePinSuccess, persistDekIfNeeded, session],
  );

  const revealMnemonic = useCallback(async (pin: string) => {
    if (!assertPinAvailable()) {
      return null;
    }
    const ok = await verifyPin(pin);
    if (!ok) {
      await notePinFailure();
      return null;
    }
    if (session?.mnemonic) {
      await notePinSuccess();
      return session.mnemonic;
    }
    const vault = await loadStoredVault();
    if (!vault) {
      return null;
    }
    if (isVaultV1(vault)) {
      await notePinSuccess();
      return vault.mnemonic;
    }
    const opened = tryDecryptVault(vault, pin);
    if (!opened) {
      await notePinFailure();
      return null;
    }
    await notePinSuccess();
    return opened.mnemonic;
  }, [assertPinAvailable, notePinFailure, notePinSuccess, session?.mnemonic]);

  const revealWithBiometrics = useCallback(async () => {
    if (!settingsRef.current.biometricsEnabled) {
      return null;
    }
    const ok = await authenticateBiometrics('Reveal recovery phrase');
    if (!ok) {
      return null;
    }
    if (session?.mnemonic) {
      return session.mnemonic;
    }
    const vault = await loadStoredVault();
    if (!vault) {
      return null;
    }
    if (isVaultV1(vault)) {
      return vault.mnemonic;
    }
    const dek = session?.dek ?? (await loadBiometricDek());
    if (!dek) {
      return null;
    }
    return tryOpenVaultWithDek(vault, dek)?.mnemonic ?? null;
  }, [session?.dek, session?.mnemonic]);

  const resetWallet = useCallback(async (pin: string) => {
    if (!assertPinAvailable()) {
      return false;
    }
    const ok = await verifyPin(pin);
    if (!ok) {
      await notePinFailure();
      return false;
    }
    await clearAllWalletData();
    setSession(null);
    setPending(null);
    await persistSettings({
      ...defaultSettings,
      selectedChainId: DEFAULT_CHAIN_ID,
    });
    setPhase('welcome');
    return true;
  }, [assertPinAvailable, notePinFailure, persistSettings]);

  const value = useMemo<WalletContextValue>(
    () => ({
      phase,
      pending,
      session,
      settings,
      address: session?.address ?? pending?.address ?? null,
      selectedChain: CHAINS[settings.selectedChainId],
      biometricsReady,
      pinBackoffMs,
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
      setAutoLock,
      setAppearance,
      setHideBalances,
      changePin,
      revealMnemonic,
      revealWithBiometrics,
      resetWallet,
    }),
    [
      biometricsReady,
      cancelOnboarding,
      changePin,
      completeVerification,
      confirmBackupViewed,
      finalizeSetup,
      importMnemonic,
      lock,
      pending,
      phase,
      pinBackoffMs,
      resetWallet,
      revealMnemonic,
      revealWithBiometrics,
      session,
      setAppearance,
      setAutoLock,
      setBiometricsEnabled,
      setHideBalances,
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

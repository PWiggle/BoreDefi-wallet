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
import {
  clearWalletCache,
  deriveAddress,
  generateMnemonic,
  isValidMnemonic,
  normalizeMnemonic,
  walletFromMnemonic,
} from '../wallet/mnemonic';
import {
  clearedPinLockState,
  isValidPin,
  nextPinLockState,
  remainingLockMs,
  setPin,
  verifyPinAndOpen,
} from '../wallet/pin';
import {
  canUseGatedBiometricStore,
  clearAllWalletData,
  clearBiometricDek,
  clearLegacyBiometricDek,
  defaultSettings,
  hasPersistedWallet,
  loadBiometricDek,
  loadLegacyBiometricDek,
  loadSettings,
  loadStoredVault,
  saveBiometricDek,
  saveEncryptedVault,
  saveSettings,
  type SettingsRecord,
} from '../wallet/storage';
import { SOLANA_ENABLED } from '../wallet/solana/config';
import { clearSolanaKeyCache, deriveSolanaAddress } from '../wallet/solana/derive';
import { encryptVault, isVaultV1, migrateVaultV1, tryOpenVaultWithDek } from '../wallet/vault-crypto';

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

/** ok = unlocked; cancelled = user backed out; unavailable = biometrics changed/off, use the PIN. */
export type BiometricUnlockResult = 'ok' | 'cancelled' | 'unavailable';

type WalletContextValue = {
  phase: Phase;
  pending: PendingWallet | null;
  session: Session | null;
  settings: SettingsRecord;
  address: string | null;
  /** Solana address from the same recovery phrase (m/44'/501'/0'/0'). Null when Solana is switched off or still deriving. */
  solanaAddress: string | null;
  selectedChain: ChainConfig;
  biometricsReady: boolean;
  pinBackoffMs: number;
  startCreate: () => Promise<void>;
  startImport: () => void;
  cancelOnboarding: () => void;
  confirmBackupViewed: () => void;
  completeVerification: () => void;
  importMnemonic: (phrase: string) => Promise<void>;
  finalizeSetup: (pin: string, enableBiometrics: boolean) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<BiometricUnlockResult>;
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
  /**
   * Fresh re-authentication right at signing time, even when the wallet is already unlocked.
   * With a PIN it verifies the PIN (lockout rules apply); without one it asks for biometrics.
   */
  reauthenticate: (input: { pin?: string; reason: string }) => Promise<boolean>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('booting');
  const [pending, setPending] = useState<PendingWallet | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<SettingsRecord>(defaultSettings);
  const [biometricsReady, setBiometricsReady] = useState(false);
  const [pinBackoffMs, setPinBackoffMs] = useState(0);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
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
        setBiometricsReady(bio.hardware && bio.enrolled && canUseGatedBiometricStore());
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

  const sessionMnemonic = session?.mnemonic ?? null;
  useEffect(() => {
    if (!SOLANA_ENABLED || !sessionMnemonic) {
      setSolanaAddress(null);
      return;
    }
    let live = true;
    deriveSolanaAddress(sessionMnemonic)
      .then((next) => live && setSolanaAddress(next))
      .catch((error) => {
        logger.error('Solana address derivation failed', { message: error instanceof Error ? error.message : 'unknown' });
        if (live) setSolanaAddress(null);
      });
    return () => {
      live = false;
    };
  }, [sessionMnemonic]);

  const lock = useCallback(() => {
    clearSolanaKeyCache();
    clearWalletCache();
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

  const startCreate = useCallback(async () => {
    const mnemonic = generateMnemonic(12);
    const address = await deriveAddress(mnemonic);
    setPending({
      mnemonic,
      address,
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

  const importMnemonic = useCallback(async (phrase: string) => {
    const normalized = normalizeMnemonic(phrase);
    if (!isValidMnemonic(normalized)) {
      throw new Error('That recovery phrase is not valid BIP39.');
    }
    const address = await deriveAddress(normalized);
    setPending({
      mnemonic: normalized,
      address,
      imported: true,
    });
    setPhase('set-pin');
  }, []);

  const persistSession = useCallback(async (next: Session) => {
    // Warm the BIP39 seed cache while the securing spinner is up, so later
    // sends and signatures do not re-run PBKDF2 on the JS thread.
    await walletFromMnemonic(next.mnemonic);
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

  /** Biometrics stop working (OS key invalidated, removed, or unavailable): turn them off and use the PIN. */
  const disableBiometrics = useCallback(async () => {
    await clearBiometricDek();
    if (settingsRef.current.biometricsEnabled) {
      await patchSettings({ biometricsEnabled: false });
    }
  }, [patchSettings]);

  /**
   * Store the vault data key behind OS biometrics. Returns false (and leaves biometrics off) when the
   * user cancels or the device cannot hold a gated key. Never blocks the PIN path.
   */
  const storeGatedDek = useCallback(async (dek: Uint8Array | null, prompt?: string): Promise<boolean> => {
    if (!dek || !canUseGatedBiometricStore()) {
      return false;
    }
    try {
      await saveBiometricDek(dek, prompt);
      return true;
    } catch (error) {
      logger.warn('Biometric key was not saved', { message: error instanceof Error ? error.message : 'unknown' });
      return false;
    }
  }, []);

  /**
   * After a PIN unlock: an install from before the OS-gated key still has the old readable copy.
   * Move it behind OS biometrics once (Android shows one prompt), then delete the old copy.
   */
  const migrateLegacyDekAfterPin = useCallback(
    async (dek: Uint8Array | null) => {
      const legacy = await loadLegacyBiometricDek();
      if (!legacy) {
        return;
      }
      await clearLegacyBiometricDek();
      if (!settingsRef.current.biometricsEnabled) {
        return;
      }
      const saved = await storeGatedDek(dek ?? legacy, 'Keep biometric unlock on');
      if (!saved) {
        await disableBiometrics();
      }
    },
    [disableBiometrics, storeGatedDek],
  );

  const finalizeSetup = useCallback(
    async (pin: string, enableBiometrics: boolean) => {
      if (!pending) {
        throw new Error('No wallet in progress');
      }
      if (!isValidPin(pin)) {
        throw new Error('PIN must be 6 digits');
      }
      const sealed = await encryptVault(pending.mnemonic, pending.address, pin);
      await saveEncryptedVault(sealed.vault);
      await setPin(pin);
      await clearBiometricDek();
      const bio = enableBiometrics && biometricsReady
        ? await storeGatedDek(sealed.dek, 'Turn on biometric unlock')
        : false;
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
    [biometricsReady, pending, persistSession, persistSettings, storeGatedDek],
  );

  /**
   * The only PIN check: unwrap the vault with the slow KDF (no fast PIN hash is stored). Old v1
   * (plaintext) vaults are re-encrypted here and the old hash is replaced, without losing access.
   */
  const checkPinAndMigrate = useCallback(
    async (pin: string): Promise<{ mnemonic: string; address: string; dek: Uint8Array } | null> => {
      const check = await verifyPinAndOpen(pin);
      if (!check.ok) {
        return null;
      }
      if (check.kind === 'v2') {
        return check.opened;
      }
      const sealed = await migrateVaultV1(check.vault, pin);
      await saveEncryptedVault(sealed.vault);
      await setPin(pin);
      if (settingsRef.current.biometricsEnabled) {
        // New data key: the old biometric copy no longer opens the vault.
        await clearBiometricDek();
        if (!(await storeGatedDek(sealed.dek, 'Keep biometric unlock on'))) {
          await disableBiometrics();
        }
      }
      return { mnemonic: check.vault.mnemonic, address: check.vault.address, dek: sealed.dek };
    },
    [disableBiometrics, storeGatedDek],
  );

  const unlockWithPin = useCallback(
    async (pin: string) => {
      if (!assertPinAvailable()) {
        return false;
      }
      const opened = await checkPinAndMigrate(pin);
      if (!opened) {
        await notePinFailure();
        return false;
      }
      await notePinSuccess();
      await migrateLegacyDekAfterPin(opened.dek);
      await persistSession(opened);
      return true;
    },
    [assertPinAvailable, checkPinAndMigrate, migrateLegacyDekAfterPin, notePinFailure, notePinSuccess, persistSession],
  );

  const unlockWithBiometrics = useCallback(async (): Promise<BiometricUnlockResult> => {
    if (!settingsRef.current.biometricsEnabled) {
      return 'unavailable';
    }
    const vault = await loadStoredVault();
    if (!vault) {
      return 'unavailable';
    }
    if (isVaultV1(vault)) {
      // Pre-encryption installs: no data key exists yet. The PIN unlock re-encrypts the vault.
      return 'unavailable';
    }
    const read = await loadBiometricDek('Unlock BoreDefi Wallet');
    if (read.status === 'cancelled') {
      return 'cancelled';
    }
    if (read.status === 'ok') {
      const opened = tryOpenVaultWithDek(vault, read.dek);
      if (!opened) {
        await disableBiometrics();
        return 'unavailable';
      }
      await persistSession(opened);
      return 'ok';
    }
    // Nothing gated yet: an install from before this release may still hold the old readable key.
    const legacy = await loadLegacyBiometricDek();
    if (legacy) {
      const ok = await authenticateBiometrics();
      if (!ok) {
        return 'cancelled';
      }
      const opened = tryOpenVaultWithDek(vault, legacy);
      await clearLegacyBiometricDek();
      if (!opened) {
        await disableBiometrics();
        return 'unavailable';
      }
      if (!(await storeGatedDek(opened.dek, 'Keep biometric unlock on'))) {
        await disableBiometrics();
      }
      await persistSession(opened);
      return 'ok';
    }
    // Biometrics changed (OS invalidated the key) or it was never saved: fall back to the PIN.
    await disableBiometrics();
    return 'unavailable';
  }, [disableBiometrics, persistSession, storeGatedDek]);

  const setSelectedChain = useCallback(
    async (chainId: ChainId) => {
      await patchSettings({ selectedChainId: chainId });
    },
    [patchSettings],
  );

  const setBiometricsEnabled = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        await disableBiometrics();
        return;
      }
      if (!session?.dek) {
        // Locked, or an old v1 session with no data key yet: unlock with the PIN first.
        return;
      }
      if (Platform.OS === 'ios') {
        // iOS creates a gated item without a prompt; confirm the user is present before turning it on.
        const ok = await authenticateBiometrics('Enable biometric unlock');
        if (!ok) {
          return;
        }
      }
      const saved = await storeGatedDek(session.dek, 'Turn on biometric unlock');
      if (!saved) {
        await disableBiometrics();
        return;
      }
      await patchSettings({ biometricsEnabled: true });
    },
    [disableBiometrics, patchSettings, session?.dek, storeGatedDek],
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
      const opened = await checkPinAndMigrate(oldPin);
      if (!opened) {
        await notePinFailure();
        return false;
      }
      // Same data key, re-wrapped under the new PIN, so the biometric key keeps working.
      const sealed = await encryptVault(opened.mnemonic, opened.address, newPin, undefined, opened.dek);
      await saveEncryptedVault(sealed.vault);
      await setPin(newPin);
      await notePinSuccess();
      if (session) {
        setSession({ ...session, dek: sealed.dek });
      }
      return true;
    },
    [assertPinAvailable, checkPinAndMigrate, notePinFailure, notePinSuccess, session],
  );

  const revealMnemonic = useCallback(async (pin: string) => {
    if (!assertPinAvailable()) {
      return null;
    }
    const opened = await checkPinAndMigrate(pin);
    if (!opened) {
      await notePinFailure();
      return null;
    }
    await notePinSuccess();
    return opened.mnemonic;
  }, [assertPinAvailable, checkPinAndMigrate, notePinFailure, notePinSuccess]);

  /** OS-level biometric proof: reading the gated data key makes the system prompt; app code can't fake it. */
  const gatedBiometricProof = useCallback(
    async (reason: string): Promise<Uint8Array | null> => {
      if (!settingsRef.current.biometricsEnabled) {
        return null;
      }
      const read = await loadBiometricDek(reason);
      if (read.status === 'ok') {
        return read.dek;
      }
      if (read.status === 'missing') {
        await disableBiometrics();
      }
      return null;
    },
    [disableBiometrics],
  );

  const revealWithBiometrics = useCallback(async () => {
    const vault = await loadStoredVault();
    if (!vault || isVaultV1(vault)) {
      return null;
    }
    const dek = await gatedBiometricProof('Reveal recovery phrase');
    if (!dek) {
      return null;
    }
    return tryOpenVaultWithDek(vault, dek)?.mnemonic ?? null;
  }, [gatedBiometricProof]);

  const resetWallet = useCallback(async (pin: string) => {
    if (!assertPinAvailable()) {
      return false;
    }
    const check = await verifyPinAndOpen(pin);
    if (!check.ok) {
      await notePinFailure();
      return false;
    }
    await clearAllWalletData([session?.address, check.kind === 'v2' ? check.opened.address : check.vault.address]);
    clearSolanaKeyCache();
    clearWalletCache();
    setSession(null);
    setPending(null);
    await persistSettings({
      ...defaultSettings,
      selectedChainId: DEFAULT_CHAIN_ID,
    });
    setPhase('welcome');
    return true;
  }, [assertPinAvailable, notePinFailure, persistSettings, session?.address]);

  const reauthenticate = useCallback(
    async ({ pin, reason }: { pin?: string; reason: string }) => {
      if (!session) {
        return false;
      }
      if (pin !== undefined) {
        if (!assertPinAvailable()) {
          return false;
        }
        const check = await verifyPinAndOpen(pin);
        if (!check.ok) {
          await notePinFailure();
          return false;
        }
        await notePinSuccess();
        return true;
      }
      return (await gatedBiometricProof(reason)) !== null;
    },
    [assertPinAvailable, gatedBiometricProof, notePinFailure, notePinSuccess, session],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      phase,
      pending,
      session,
      settings,
      address: session?.address ?? pending?.address ?? null,
      solanaAddress: session ? solanaAddress : null,
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
      reauthenticate,
    }),
    [
      reauthenticate,
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
      solanaAddress,
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

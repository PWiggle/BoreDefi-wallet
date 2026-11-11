import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { Button } from '../components/Button';
import { CoverScreen } from '../components/CoverScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { SecuringWallet } from '../components/SecuringWallet';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { formatLockWait, isValidPin } from '../wallet/pin';
import { useNoScreenCapture } from '../components/useNoScreenCapture';

function unlockStyles({ type }: Theme) {
  return {
    hint: {
      ...type.subtitle,
      textAlign: 'center' as const,
    },
    wait: {
      ...type.subtitle,
      textAlign: 'center' as const,
    },
  };
}

export function UnlockScreen() {
  useNoScreenCapture('unlock');
  const styles = useThemedStyles(unlockStyles);
  const { unlockWithPin, unlockWithBiometrics, settings, pinBackoffMs } = useWallet();
  const [stage, setStage] = useState<'cover' | 'pin'>('cover');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);

  const tryBiometrics = async () => {
    setError(null);
    const result = await unlockWithBiometrics();
    if (result === 'cancelled') {
      setError('Biometric unlock was cancelled or failed. Use your PIN to decrypt the vault.');
    } else if (result === 'unavailable') {
      setError(
        'Biometric unlock is off because your fingerprints or face settings changed, or it is unavailable. ' +
          'Unlock with your PIN, then turn biometrics back on in Settings.',
      );
    }
  };

  useEffect(() => {
    if (stage !== 'pin' || !settings.biometricsEnabled) {
      return;
    }
    tryBiometrics();
    // Prompt once when the PIN pad is shown — never from the cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (stage !== 'pin' || !isValidPin(pin) || submitted.current || pinBackoffMs > 0) {
      return;
    }
    submitted.current = true;
    setBusy(true);
    setTimeout(() => {
      unlockWithPin(pin)
        .then((ok) => {
          if (!ok) {
            setError('Incorrect PIN.');
            setPin('');
          }
        })
        .finally(() => {
          submitted.current = false;
          setBusy(false);
        });
    }, 50);
  }, [pin, pinBackoffMs, stage, unlockWithPin]);

  if (stage === 'cover') {
    return (
      <CoverScreen
        footer={<Button label="Unlock" onPress={() => setStage('pin')} />}
      />
    );
  }

  return (
    <Screen
      title="Unlock"
      subtitle="BoreDefi Wallet"
      scroll={false}
      footer={<Button label="Back" variant="ghost" onPress={() => setStage('cover')} />}
    >
      <Text style={styles.hint}>Enter your PIN to decrypt keys into memory on this device.</Text>
      {pinBackoffMs > 0 ? (
        <Text style={styles.wait}>
          Too many wrong PINs. Try again in {formatLockWait(pinBackoffMs)}. Each wrong PIN makes the wait longer.
        </Text>
      ) : null}
      <ErrorBanner message={error} />
      {busy ? <SecuringWallet /> : null}
      <PinPad value={pin} onChange={setPin} disabled={busy || pinBackoffMs > 0} />
      {settings.biometricsEnabled ? (
        <Button label="Use biometrics" variant="secondary" onPress={tryBiometrics} />
      ) : null}
    </Screen>
  );
}

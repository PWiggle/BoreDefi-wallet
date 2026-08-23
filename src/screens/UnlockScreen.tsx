import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Button } from '../components/Button';
import { CoverScreen } from '../components/CoverScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { isValidPin } from '../wallet/pin';

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
  const styles = useThemedStyles(unlockStyles);
  const { unlockWithPin, unlockWithBiometrics, settings, pinBackoffMs } = useWallet();
  const [stage, setStage] = useState<'cover' | 'pin'>('cover');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryBiometrics = async () => {
    setError(null);
    const ok = await unlockWithBiometrics();
    if (!ok) {
      setError('Biometric unlock was cancelled or failed. Use your PIN to decrypt the vault.');
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
    if (stage !== 'pin' || !isValidPin(pin) || busy || pinBackoffMs > 0) {
      return;
    }
    setBusy(true);
    unlockWithPin(pin)
      .then((ok) => {
        if (!ok) {
          setError('Incorrect PIN.');
          setPin('');
        }
      })
      .finally(() => setBusy(false));
  }, [busy, pin, pinBackoffMs, stage, unlockWithPin]);

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
        <Text style={styles.wait}>Too many attempts. Wait {Math.ceil(pinBackoffMs / 1000)}s.</Text>
      ) : null}
      <ErrorBanner message={error} />
      <PinPad value={pin} onChange={setPin} />
      {settings.biometricsEnabled ? (
        <Button label="Use biometrics" variant="secondary" onPress={tryBiometrics} />
      ) : null}
    </Screen>
  );
}

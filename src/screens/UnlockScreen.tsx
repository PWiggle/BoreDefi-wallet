import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { type } from '../theme';
import { isValidPin } from '../wallet/pin';

export function UnlockScreen() {
  const { unlockWithPin, unlockWithBiometrics, settings, pinBackoffMs } = useWallet();
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
    if (settings.biometricsEnabled) {
      tryBiometrics();
    }
    // Prompt once when the lock screen mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isValidPin(pin) || busy || pinBackoffMs > 0) {
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
  }, [busy, pin, pinBackoffMs, unlockWithPin]);

  return (
    <Screen title="Unlock" subtitle="BoreDefi Wallet" scroll={false}>
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

const styles = StyleSheet.create({
  hint: {
    ...type.subtitle,
    textAlign: 'center',
  },
  wait: {
    ...type.subtitle,
    textAlign: 'center',
  },
});

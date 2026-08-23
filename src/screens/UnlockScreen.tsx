import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors } from '../theme';
import { isValidPin } from '../wallet/pin';

export function UnlockScreen() {
  const { unlockWithPin, unlockWithBiometrics, settings } = useWallet();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryBiometrics = async () => {
    setError(null);
    const ok = await unlockWithBiometrics();
    if (!ok) {
      setError('Biometric unlock was cancelled or failed. Use your PIN.');
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
    if (!isValidPin(pin) || busy) {
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
  }, [busy, pin, unlockWithPin]);

  return (
    <Screen title="Unlock" subtitle="BoreDefi Wallet" scroll={false}>
      <Text style={styles.hint}>Enter your PIN to decrypt keys on this device.</Text>
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
    color: colors.muted,
    textAlign: 'center',
  },
});

import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, spacing } from '../theme';
import { isValidPin } from '../wallet/pin';

export function ResetWalletScreen() {
  const { resetWallet } = useWallet();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!isValidPin(pin) || busy) {
      return;
    }
    setBusy(true);
    const ok = await resetWallet(pin);
    setBusy(false);
    if (!ok) {
      setError('Incorrect PIN.');
      setPin('');
    }
  };

  return (
    <Screen
      title="Delete local wallet"
      subtitle="This erases keys stored on this device. It does not send a transaction. You will need your recovery phrase to import again."
      footer={<Button label="Delete wallet from device" variant="danger" loading={busy} onPress={confirm} />}
    >
      <Text style={styles.warn}>
        If you have not backed up the recovery phrase, funds on this wallet will be unrecoverable.
      </Text>
      <ErrorBanner message={error} />
      <PinPad value={pin} onChange={setPin} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {
    color: colors.warning,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
});

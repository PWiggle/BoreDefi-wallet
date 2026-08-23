import { useState } from 'react';
import { Text } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { isValidPin } from '../wallet/pin';

function resetStyles({ colors, spacing }: Theme) {
  return {
    warn: {
      color: colors.warning,
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
  };
}

export function ResetWalletScreen() {
  const styles = useThemedStyles(resetStyles);
  const { resetWallet, pinBackoffMs } = useWallet();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!isValidPin(pin) || busy || pinBackoffMs > 0) {
      return;
    }
    setBusy(true);
    const ok = await resetWallet(pin);
    setBusy(false);
    if (!ok) {
      setError(pinBackoffMs > 0 ? 'Too many attempts. Wait, then try again.' : 'Incorrect PIN.');
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
      {pinBackoffMs > 0 ? (
        <Text style={styles.warn}>Wait {Math.ceil(pinBackoffMs / 1000)}s before trying again.</Text>
      ) : null}
      <ErrorBanner message={error} />
      <PinPad value={pin} onChange={setPin} />
    </Screen>
  );
}

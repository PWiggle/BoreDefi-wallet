import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { SeedGrid } from '../components/SeedGrid';
import { useWallet } from '../context/WalletContext';
import { colors, spacing } from '../theme';
import { isValidPin } from '../wallet/pin';

export function RevealSeedScreen() {
  usePreventScreenCapture();
  const { revealMnemonic } = useWallet();
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (!isValidPin(pin) || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const mnemonic = await revealMnemonic(pin);
    setBusy(false);
    if (!mnemonic) {
      setError('Incorrect PIN.');
      setPin('');
      return;
    }
    setPhrase(mnemonic);
  };

  return (
    <Screen
      title="Recovery phrase"
      subtitle="Re-enter your PIN. Screenshots are blocked on this screen."
      footer={phrase ? null : <Button label="Reveal" loading={busy} onPress={unlock} />}
    >
      <ErrorBanner message={error} />
      {phrase ? (
        <>
          <Text style={styles.warn}>Anyone with these words can take the funds.</Text>
          <SeedGrid phrase={phrase} />
        </>
      ) : (
        <PinPad value={pin} onChange={setPin} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {
    color: colors.warning,
    marginBottom: spacing.sm,
  },
});

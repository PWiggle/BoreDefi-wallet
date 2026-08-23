import { useState } from 'react';
import { Text } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { SeedGrid } from '../components/SeedGrid';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { isValidPin } from '../wallet/pin';

function revealStyles({ colors, type, spacing }: Theme) {
  return {
    warn: {
      color: colors.warning,
      marginBottom: spacing.sm,
    },
    wait: type.subtitle,
  };
}

export function RevealSeedScreen() {
  usePreventScreenCapture();
  const styles = useThemedStyles(revealStyles);
  const { revealMnemonic, revealWithBiometrics, settings, pinBackoffMs } = useWallet();
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (!isValidPin(pin) || busy || pinBackoffMs > 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const mnemonic = await revealMnemonic(pin);
    setBusy(false);
    if (!mnemonic) {
      setError(pinBackoffMs > 0 ? 'Too many attempts. Wait, then try again.' : 'Incorrect PIN.');
      setPin('');
      return;
    }
    setPhrase(mnemonic);
  };

  const unlockBio = async () => {
    setBusy(true);
    setError(null);
    const mnemonic = await revealWithBiometrics();
    setBusy(false);
    if (!mnemonic) {
      setError('Biometric check failed. Enter your PIN.');
      return;
    }
    setPhrase(mnemonic);
  };

  return (
    <Screen
      title="Recovery phrase"
      subtitle="PIN or biometrics required. Screenshots are blocked on this screen."
      footer={
        phrase ? null : (
          <>
            <Button label="Reveal" loading={busy} onPress={unlock} />
            {settings.biometricsEnabled ? (
              <Button label="Use biometrics" variant="secondary" loading={busy} onPress={unlockBio} />
            ) : null}
          </>
        )
      }
    >
      <ErrorBanner message={error} />
      {pinBackoffMs > 0 && !phrase ? (
        <Text style={styles.wait}>Wait {Math.ceil(pinBackoffMs / 1000)}s before another PIN try.</Text>
      ) : null}
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

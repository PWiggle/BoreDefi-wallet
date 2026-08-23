import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { isValidPin } from '../wallet/pin';

type Stage = 'old' | 'next' | 'confirm';

function changePinStyles({ type }: Theme) {
  return {
    wait: type.subtitle,
  };
}

export function ChangePinScreen() {
  const styles = useThemedStyles(changePinStyles);
  const navigation = useNavigation();
  const { changePin, pinBackoffMs } = useWallet();
  const [stage, setStage] = useState<Stage>('old');
  const [oldPin, setOldPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = stage === 'old' ? oldPin : stage === 'next' ? nextPin : confirm;
  const setValue = stage === 'old' ? setOldPin : stage === 'next' ? setNextPin : setConfirm;

  useEffect(() => {
    if (!isValidPin(value) || busy) {
      return;
    }
    if (stage === 'old') {
      setStage('next');
      return;
    }
    if (stage === 'next') {
      setStage('confirm');
      return;
    }
    if (nextPin !== confirm) {
      setError('New PINs did not match. Try again.');
      setNextPin('');
      setConfirm('');
      setStage('next');
      return;
    }
    setBusy(true);
    changePin(oldPin, nextPin)
      .then((ok) => {
        if (!ok) {
          setError(pinBackoffMs > 0 ? 'Too many attempts. Wait, then try again.' : 'Current PIN is incorrect.');
          setOldPin('');
          setNextPin('');
          setConfirm('');
          setStage('old');
          return;
        }
        navigation.goBack();
      })
      .finally(() => setBusy(false));
  }, [busy, changePin, confirm, navigation, nextPin, oldPin, pinBackoffMs, stage, value]);

  return (
    <Screen
      title={stage === 'old' ? 'Current PIN' : stage === 'next' ? 'New PIN' : 'Confirm new PIN'}
      subtitle="The new PIN re-wraps the encrypted vault on this device. The PIN itself is never stored."
      scroll={false}
    >
      {pinBackoffMs > 0 ? (
        <Text style={styles.wait}>Wait {Math.ceil(pinBackoffMs / 1000)}s before trying again.</Text>
      ) : null}
      <ErrorBanner message={error} />
      <PinPad value={value} onChange={setValue} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PinPad } from '../components/PinPad';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, spacing } from '../theme';
import { biometricAvailability } from '../wallet/biometrics';
import { isValidPin } from '../wallet/pin';

export function SetPinScreen() {
  const { finalizeSetup, cancelOnboarding, biometricsReady } = useWallet();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState<'create' | 'confirm'>('create');
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [bioLabel, setBioLabel] = useState('Biometrics');
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    biometricAvailability().then((info) => {
      setBioLabel(info.label);
      setUseBiometrics(info.hardware && info.enrolled);
    });
  }, []);

  useEffect(() => {
    if (stage === 'create' && isValidPin(pin)) {
      setStage('confirm');
    }
  }, [pin, stage]);

  useEffect(() => {
    if (stage !== 'confirm' || !isValidPin(confirm) || submitted.current) {
      return;
    }
    if (confirm !== pin) {
      setError('PINs did not match. Try again.');
      setPin('');
      setConfirm('');
      setStage('create');
      return;
    }
    submitted.current = true;
    finalizeSetup(pin, useBiometrics).catch((err) => {
      submitted.current = false;
      setError(err instanceof Error ? err.message : 'Could not finish setup.');
      setPin('');
      setConfirm('');
      setStage('create');
    });
  }, [confirm, finalizeSetup, pin, stage, useBiometrics]);

  return (
    <Screen
      title={stage === 'create' ? 'Create a 6-digit PIN' : 'Confirm your PIN'}
      subtitle="The PIN unlocks keys stored on this device. Enable biometrics if you want a faster unlock."
      scroll={false}
      footer={<Button label="Cancel" variant="ghost" onPress={cancelOnboarding} />}
    >
      <ErrorBanner message={error} />
      <PinPad value={stage === 'create' ? pin : confirm} onChange={stage === 'create' ? setPin : setConfirm} />
      {biometricsReady ? (
        <Pressable style={styles.bioRow} onPress={() => setUseBiometrics((value) => !value)}>
          <View>
            <Text style={styles.bioTitle}>Unlock with {bioLabel.toLowerCase()}</Text>
            <Text style={styles.bioSub}>You can still use your PIN at any time.</Text>
          </View>
          <Switch
            value={useBiometrics}
            onValueChange={setUseBiometrics}
            trackColor={{ true: colors.accentDim, false: colors.border }}
            thumbColor={useBiometrics ? colors.accent : colors.muted}
          />
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bioRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  bioTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  bioSub: {
    color: colors.muted,
    marginTop: 4,
  },
});

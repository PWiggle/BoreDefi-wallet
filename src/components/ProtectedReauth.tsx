import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { Button } from './Button';

function reauthStyles({ colors, field, spacing, type }: Theme) {
  return {
    box: { gap: spacing.sm },
    label: type.label,
    input: field,
    error: { color: colors.danger, fontWeight: '700' as const },
  };
}

/**
 * Fresh PIN / biometric check right before a protected action. It runs even when the wallet is unlocked.
 */
export function ProtectedReauth({
  reason,
  disabled,
  busy,
  confirmLabel = 'Confirm',
  onVerified,
}: {
  reason: string;
  disabled?: boolean;
  busy?: boolean;
  confirmLabel?: string;
  onVerified: () => void;
}) {
  const styles = useThemedStyles(reauthStyles);
  const { reauthenticate, settings, biometricsReady, pinBackoffMs } = useWallet();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const run = async (withPin: boolean) => {
    setError(null);
    setChecking(true);
    try {
      const ok = await reauthenticate(withPin ? { pin, reason } : { reason });
      setPin('');
      if (ok) {
        onVerified();
      } else {
        setError(withPin ? 'Wrong PIN. Nothing was signed.' : 'Biometrics failed. Use your PIN.');
      }
    } finally {
      setChecking(false);
    }
  };

  const locked = pinBackoffMs > 0;
  return (
    <View style={styles.box}>
      <Text style={styles.label}>Re-enter your PIN to sign</Text>
      <TextInput
        value={pin}
        onChangeText={(value) => setPin(value.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
        placeholder="PIN"
        editable={!disabled && !locked}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {locked ? <Text style={styles.error}>Too many wrong PINs. Wait and try again.</Text> : null}
      <Button
        label={`${confirmLabel} with PIN`}
        variant="danger"
        disabled={disabled || pin.length < 4 || locked}
        loading={checking || busy}
        onPress={() => void run(true)}
      />
      {settings.biometricsEnabled && biometricsReady ? (
        <Button
          label={`${confirmLabel} with biometrics`}
          variant="secondary"
          disabled={disabled}
          loading={checking || busy}
          onPress={() => void run(false)}
        />
      ) : null}
    </View>
  );
}

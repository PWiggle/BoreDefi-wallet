import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { colors, radius, spacing } from '../theme';

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { session, settings, biometricsReady, setBiometricsEnabled } = useWallet();

  return (
    <Screen title="Settings" subtitle={session?.address}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>Biometric unlock</Text>
          <Text style={styles.help}>
            {biometricsReady
              ? 'Unlock with the biometrics enrolled on this device.'
              : 'No biometrics enrolled on this device.'}
          </Text>
        </View>
        <Switch
          value={settings.biometricsEnabled}
          disabled={!biometricsReady}
          onValueChange={setBiometricsEnabled}
          trackColor={{ true: colors.accentDim, false: colors.border }}
          thumbColor={settings.biometricsEnabled ? colors.accent : colors.muted}
        />
      </View>
      <Button
        label="WalletConnect sessions"
        variant="secondary"
        onPress={() => navigation.navigate('WalletConnect', {})}
      />
      <Button
        label="Reveal recovery phrase"
        variant="secondary"
        onPress={() => navigation.navigate('RevealSeed')}
      />
      <Text style={styles.note}>
        Phase 2 adds same-chain aggregator swaps and WalletConnect. Stake, bridge, an in-app dApp
        browser, and fiat on-ramps are later phases.
      </Text>
      <Button
        label="Delete wallet from device"
        variant="danger"
        onPress={() => navigation.navigate('ResetWallet')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
  },
  help: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  note: {
    color: colors.muted,
    lineHeight: 20,
  },
});

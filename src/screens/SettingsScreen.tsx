import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { SettingsRow } from '../components/SettingsRow';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { card, colors, spacing, type } from '../theme';
import { shortenAddress } from '../wallet/format';

export function SettingsScreen() {
  const navigation = useNavigation<MainNavigation>();
  const { session, settings, biometricsReady, setBiometricsEnabled } = useWallet();

  return (
    <Screen inset="tab" title="Settings" subtitle={session ? shortenAddress(session.address) : undefined}>
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
      <SettingsRow label="Activity" detail="Recent transactions" onPress={() => navigation.navigate('Activity')} />
      <SettingsRow
        label="WalletConnect"
        detail="Sessions and pairing"
        onPress={() => navigation.navigate('WalletConnect', {})}
      />
      <SettingsRow label="Ledger" detail="Hardware signing" onPress={() => navigation.navigate('Ledger')} />
      <SettingsRow
        label="Recovery phrase"
        detail="Reveal words stored on this device"
        onPress={() => navigation.navigate('RevealSeed')}
      />
      <Text style={styles.note}>
        Keys stay on this device. There is no fiat on-ramp. Markets data is public CoinGecko.
      </Text>
      <SettingsRow
        label="Delete wallet from device"
        danger
        onPress={() => navigation.navigate('ResetWallet')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    ...card,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
  },
  help: type.meta,
  note: type.subtitle,
});

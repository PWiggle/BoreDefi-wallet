import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { SettingsRow } from '../components/SettingsRow';
import { useWallet } from '../context/WalletContext';
import type { MainNavigation } from '../navigation';
import { card, colors, spacing, type } from '../theme';
import { AUTO_LOCK_OPTIONS } from '../wallet/auto-lock';
import { shortenAddress } from '../wallet/format';

export function SettingsScreen() {
  const navigation = useNavigation<MainNavigation>();
  const {
    session,
    settings,
    biometricsReady,
    setBiometricsEnabled,
    setAutoLock,
    setHideBalances,
  } = useWallet();

  return (
    <Screen inset="tab" title="Settings" subtitle={session ? shortenAddress(session.address) : undefined}>
      <Text style={styles.section}>Safety</Text>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>Biometric unlock</Text>
          <Text style={styles.help}>
            {biometricsReady
              ? 'After a PIN unlock, native biometrics can unwrap the vault key from SecureStore. The PIN is never stored.'
              : 'No biometrics enrolled on this device. Use your PIN to decrypt the vault.'}
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
      <View style={styles.card}>
        <Text style={styles.label}>Auto-lock</Text>
        <Text style={styles.help}>Locks when the app backgrounds or the tab hides. Default is 1 minute.</Text>
        <View style={styles.chips}>
          {AUTO_LOCK_OPTIONS.map((item) => (
            <Pressable
              key={item.mode}
              onPress={() => setAutoLock(item.mode)}
              style={[styles.chip, settings.autoLock === item.mode && styles.chipOn]}
            >
              <Text style={[styles.chipText, settings.autoLock === item.mode && styles.chipTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>Hide balances</Text>
          <Text style={styles.help}>Mask amounts on Home. Your address stays visible.</Text>
        </View>
        <Switch
          value={settings.hideBalances}
          onValueChange={setHideBalances}
          trackColor={{ true: colors.accentDim, false: colors.border }}
          thumbColor={settings.hideBalances ? colors.accent : colors.muted}
        />
      </View>
      <SettingsRow
        label="Change PIN"
        detail="Old PIN required · re-wraps the vault"
        onPress={() => navigation.navigate('ChangePin')}
      />
      <SettingsRow
        label="Recovery phrase"
        detail="PIN or biometrics · screenshots blocked"
        onPress={() => navigation.navigate('RevealSeed')}
      />
      <SettingsRow
        label="Delete wallet from device"
        danger
        onPress={() => navigation.navigate('ResetWallet')}
      />
      <Text style={styles.section}>Wallet</Text>
      <SettingsRow label="Activity" detail="Recent transactions" onPress={() => navigation.navigate('Activity')} />
      <SettingsRow
        label="WalletConnect"
        detail="Sessions and pairing"
        onPress={() => navigation.navigate('WalletConnect', {})}
      />
      <SettingsRow label="Ledger" detail="Hardware signing" onPress={() => navigation.navigate('Ledger')} />
      <Text style={styles.note}>
        Keys stay on this device. The vault is encrypted at rest with a PIN-derived key. There is no fiat
        on-ramp. Markets data is public CoinGecko.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    ...type.label,
    marginTop: spacing.sm,
  },
  row: {
    ...card,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  card: {
    ...card,
    gap: spacing.sm,
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.muted,
    fontWeight: '700',
  },
  chipTextOn: {
    color: colors.accent,
  },
});

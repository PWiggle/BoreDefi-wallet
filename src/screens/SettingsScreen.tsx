import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { SettingsRow } from '../components/SettingsRow';
import { APPEARANCE_OPTIONS, useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { useWalletConnect } from '../context/WalletConnectContext';
import type { MainNavigation } from '../navigation';
import { BOREDEFI_SUPPORT_URL, CONNECT_DEMO_URL } from '../wallet/dapps';
import { AUTO_LOCK_OPTIONS } from '../wallet/auto-lock';
import { shortenAddress } from '../wallet/format';
import { PROOF_MODE } from '../proof-mode';

function settingsStyles({ colors, type, card, spacing }: Theme) {
  return {
    section: {
      ...type.label,
      marginTop: spacing.sm,
    },
    row: {
      ...card,
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      gap: spacing.md,
      justifyContent: 'space-between' as const,
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
      fontWeight: '700' as const,
    },
    help: type.meta,
    note: type.subtitle,
    chips: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
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
      fontWeight: '700' as const,
    },
    chipTextOn: {
      color: colors.accent,
    },
  };
}

export function SettingsScreen() {
  const navigation = useNavigation<MainNavigation>();
  const { colors, appearance, setAppearance } = useTheme();
  const styles = useThemedStyles(settingsStyles);
  const {
    session,
    settings,
    biometricsReady,
    setBiometricsEnabled,
    setAutoLock,
    setHideBalances,
  } = useWallet();
  const { sessions: wcSessions } = useWalletConnect();

  return (
    <Screen inset="tab" title="Settings" subtitle={session ? shortenAddress(session.address) : undefined}>
      <Text style={styles.section}>Appearance</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Theme</Text>
        <Text style={styles.help}>Light, dark, or follow the device. Changes apply immediately.</Text>
        <View style={styles.chips}>
          {APPEARANCE_OPTIONS.map((item) => (
            <Pressable
              key={item.mode}
              onPress={() => setAppearance(item.mode)}
              style={[styles.chip, appearance === item.mode && styles.chipOn]}
            >
              <Text style={[styles.chipText, appearance === item.mode && styles.chipTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
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
        label="Protected collections"
        detail="Yuga Labs / BAYC / ApeCoin / Yaper · approvals, revoke, address book"
        onPress={() => navigation.navigate('ProtectedCollections')}
      />
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
        detail={
          wcSessions.length
            ? `${wcSessions.length} connected app${wcSessions.length === 1 ? '' : 's'} · scan or paste to add`
            : 'Connect dApps by QR or link'
        }
        onPress={() => navigation.navigate('WalletConnect', {})}
      />
      {/* No native Ledger transport on iOS yet, so the row would only show an unavailable notice. */}
      {Platform.OS === 'ios' ? null : (
        <SettingsRow label="Ledger" detail="Hardware signing" onPress={() => navigation.navigate('Ledger')} />
      )}
      <SettingsRow label="Gas tracker" detail="Live gwei, costs in $, 24h chart" onPress={() => navigation.navigate('Gas')} />
      <Text style={styles.section}>Support</Text>
      <SettingsRow
        label="Help & support"
        detail="boredefi.com/support"
        onPress={() => navigation.navigate('Browser', { url: BOREDEFI_SUPPORT_URL })}
      />
      <SettingsRow
        label="Test dApp connection"
        detail="Checks that sites can connect in the Browser"
        onPress={() => navigation.navigate('Browser', { url: CONNECT_DEMO_URL })}
      />
      {PROOF_MODE ? (
        <SettingsRow label="Proof screens (test build)" detail="Live previews, nothing is sent" onPress={() => navigation.navigate('Proof')} />
      ) : null}
      <Text style={styles.note}>
        Keys stay on this device. The vault is encrypted at rest with a PIN-derived key. There is no fiat
        on-ramp. Market data via BoreDash (source: CoinGecko).
      </Text>
    </Screen>
  );
}

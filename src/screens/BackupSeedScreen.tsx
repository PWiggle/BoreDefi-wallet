import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { SeedGrid } from '../components/SeedGrid';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';

function backupStyles({ colors, radius, spacing }: Theme) {
  return {
    warn: {
      backgroundColor: colors.warningSurface,
      borderColor: colors.warning,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    warnText: {
      color: colors.warning,
      lineHeight: 20,
    },
    checkRow: {
      flexDirection: 'row' as const,
      gap: spacing.md,
      alignItems: 'flex-start' as const,
      marginTop: spacing.sm,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginTop: 2,
    },
    boxOn: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    check: {
      color: colors.accentText,
      fontWeight: '800' as const,
    },
    checkLabel: {
      flex: 1,
      color: colors.text,
      lineHeight: 20,
    },
  };
}

export function BackupSeedScreen() {
  usePreventScreenCapture();
  const styles = useThemedStyles(backupStyles);
  const { pending, cancelOnboarding, confirmBackupViewed } = useWallet();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!pending || pending.imported) {
      cancelOnboarding();
    }
  }, [cancelOnboarding, pending]);

  if (!pending) {
    return null;
  }

  return (
    <Screen
      title="Write down your recovery phrase"
      subtitle="This is the only way to restore this wallet. BoreDefi cannot recover it. There is no skip."
      footer={
        <>
          <Button
            label="I have written these words down"
            disabled={!acknowledged}
            onPress={confirmBackupViewed}
          />
          <Button label="Cancel and discard wallet" variant="ghost" onPress={cancelOnboarding} />
        </>
      }
    >
      <View style={styles.warn}>
        <Text style={styles.warnText}>
          Never share this phrase. Never screenshot it. Anyone with these words can take the funds.
        </Text>
      </View>
      <SeedGrid phrase={pending.mnemonic} />
      <Pressable style={styles.checkRow} onPress={() => setAcknowledged((value) => !value)}>
        <View style={[styles.box, acknowledged && styles.boxOn]}>
          {acknowledged ? <Text style={styles.check}>✓</Text> : null}
        </View>
        <Text style={styles.checkLabel}>
          I wrote these {pending.mnemonic.split(' ').length} words on paper and stored them offline.
        </Text>
      </Pressable>
    </Screen>
  );
}

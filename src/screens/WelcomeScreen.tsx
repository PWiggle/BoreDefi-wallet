import { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { CoverScreen } from '../components/CoverScreen';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { COVER_FOOTER_TEXT } from '../theme';

function welcomeStyles({ spacing, type }: Theme) {
  return {
    hint: {
      ...type.subtitle,
      color: COVER_FOOTER_TEXT,
      textAlign: 'center' as const,
    },
    hintHidden: {
      opacity: 0,
    },
    creating: {
      alignItems: 'center' as const,
      bottom: 0,
      flexDirection: 'row' as const,
      gap: spacing.sm,
      justifyContent: 'center' as const,
      left: 0,
      position: 'absolute' as const,
      right: 0,
      top: 0,
    },
    creatingLabel: {
      ...type.subtitle,
      color: COVER_FOOTER_TEXT,
      fontWeight: '700' as const,
    },
  };
}

export function WelcomeScreen() {
  const styles = useThemedStyles(welcomeStyles);
  const { startCreate, startImport } = useWallet();
  const [creating, setCreating] = useState(false);
  const started = useRef(false);

  const create = () => {
    if (started.current) {
      return;
    }
    started.current = true;
    setCreating(true);
    setTimeout(() => {
      startCreate().catch(() => {
        started.current = false;
        setCreating(false);
      });
    }, 50);
  };

  return (
    <CoverScreen
      statusBarHidden
      footer={
        <>
          {/* The progress row replaces the hint in place, so the footer never grows into the logo. */}
          <View>
            <Text style={[styles.hint, creating ? styles.hintHidden : null]}>
              Non-custodial wallet. Your recovery phrase stays on this device.
            </Text>
            {creating ? (
              <View style={styles.creating} accessibilityLiveRegion="polite">
                <ActivityIndicator color={COVER_FOOTER_TEXT} />
                <Text style={styles.creatingLabel}>Creating wallet…</Text>
              </View>
            ) : null}
          </View>
          <Button label="Create new wallet" onPress={create} loading={creating} />
          <Button label="Import recovery phrase" variant="secondary" onPress={startImport} disabled={creating} />
        </>
      }
    />
  );
}

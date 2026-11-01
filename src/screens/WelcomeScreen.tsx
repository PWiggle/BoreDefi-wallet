import { useRef, useState } from 'react';
import { Text } from 'react-native';

import { Button } from '../components/Button';
import { CoverScreen } from '../components/CoverScreen';
import { SecuringWallet } from '../components/SecuringWallet';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { COVER_FOOTER_TEXT } from '../theme';

function welcomeStyles({ type }: Theme) {
  return {
    hint: {
      ...type.subtitle,
      color: COVER_FOOTER_TEXT,
      textAlign: 'center' as const,
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
          <Text style={styles.hint}>
            Non-custodial wallet. Your recovery phrase stays on this device.
          </Text>
          {creating ? <SecuringWallet label="Creating wallet…" color={COVER_FOOTER_TEXT} /> : null}
          <Button label="Create new wallet" onPress={create} loading={creating} />
          <Button label="Import recovery phrase" variant="secondary" onPress={startImport} disabled={creating} />
        </>
      }
    />
  );
}

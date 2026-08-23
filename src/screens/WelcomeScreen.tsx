import { Text } from 'react-native';

import { Button } from '../components/Button';
import { CoverScreen } from '../components/CoverScreen';
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

  return (
    <CoverScreen
      footer={
        <>
          <Text style={styles.hint}>
            Non-custodial wallet. Your recovery phrase stays on this device.
          </Text>
          <Button label="Create new wallet" onPress={startCreate} />
          <Button label="Import recovery phrase" variant="secondary" onPress={startImport} />
        </>
      }
    />
  );
}

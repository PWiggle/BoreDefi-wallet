import { usePreventScreenCapture } from 'expo-screen-capture';
import { useRef, useState } from 'react';
import { TextInput } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { SecuringWallet } from '../components/SecuringWallet';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';

function importStyles({ field }: Theme) {
  return {
    input: {
      ...field,
      lineHeight: 24,
      minHeight: 180,
      paddingVertical: 14,
    },
  };
}

export function ImportWalletScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(importStyles);
  const { importMnemonic, cancelOnboarding } = useWallet();
  // Seed phrase is typed here: block screenshots / screen recording like the other seed screens.
  usePreventScreenCapture();
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const started = useRef(false);

  const submit = () => {
    if (started.current) {
      return;
    }
    started.current = true;
    setError(null);
    setImporting(true);
    setTimeout(() => {
      importMnemonic(phrase).catch((err) => {
        started.current = false;
        setImporting(false);
        setError(err instanceof Error ? err.message : 'Could not import that phrase.');
      });
    }, 50);
  };

  return (
    <Screen
      title="Import wallet"
      subtitle="Enter your 12 or 24 word BIP39 recovery phrase. It is stored only on this device."
      footer={
        <>
          <Button label="Import" onPress={submit} loading={importing} />
          <Button label="Back" variant="ghost" onPress={cancelOnboarding} disabled={importing} />
        </>
      }
    >
      <ErrorBanner message={error} />
      {importing ? <SecuringWallet label="Importing wallet…" /> : null}
      <TextInput
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        importantForAutofill="no"
        editable={!importing}
        textAlignVertical="top"
        value={phrase}
        onChangeText={setPhrase}
        style={styles.input}
        placeholder="word1 word2 word3 …"
        placeholderTextColor={colors.muted}
      />
    </Screen>
  );
}

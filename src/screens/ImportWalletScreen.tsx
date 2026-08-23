import { useState } from 'react';
import { TextInput } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
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
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    try {
      setError(null);
      importMnemonic(phrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import that phrase.');
    }
  };

  return (
    <Screen
      title="Import wallet"
      subtitle="Enter your 12 or 24 word BIP39 recovery phrase. It is stored only on this device."
      footer={
        <>
          <Button label="Import" onPress={submit} />
          <Button label="Back" variant="ghost" onPress={cancelOnboarding} />
        </>
      }
    >
      <ErrorBanner message={error} />
      <TextInput
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
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

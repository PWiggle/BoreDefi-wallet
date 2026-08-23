import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, field } from '../theme';

export function ImportWalletScreen() {
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

const styles = StyleSheet.create({
  input: {
    ...field,
    lineHeight: 24,
    minHeight: 180,
    paddingVertical: 14,
  },
});

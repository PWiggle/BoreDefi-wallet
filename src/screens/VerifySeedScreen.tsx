import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useWallet } from '../context/WalletContext';
import { colors, radius, spacing } from '../theme';
import { checkVerificationAnswers, pickVerificationChallenges } from '../wallet/mnemonic';

export function VerifySeedScreen() {
  usePreventScreenCapture();
  const { pending, completeVerification, cancelOnboarding } = useWallet();
  const challenges = useMemo(
    () => (pending ? pickVerificationChallenges(pending.mnemonic, 3) : []),
    [pending],
  );
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (!pending) {
    return null;
  }

  const submit = () => {
    const payload = challenges.map((challenge) => ({
      index: challenge.index,
      word: answers[challenge.index] ?? '',
    }));
    if (!checkVerificationAnswers(pending.mnemonic, payload)) {
      setError('Those words do not match. Check your paper backup.');
      return;
    }
    setError(null);
    completeVerification();
  };

  return (
    <Screen
      title="Verify your backup"
      subtitle="Enter the requested words from your paper backup. This step cannot be skipped."
      footer={
        <>
          <Button label="Continue" onPress={submit} />
          <Button label="Start over" variant="ghost" onPress={cancelOnboarding} />
        </>
      }
    >
      <ErrorBanner message={error} />
      {challenges.map((challenge) => (
        <View key={challenge.index} style={styles.field}>
          <Text style={styles.label}>Word {challenge.index + 1}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            secureTextEntry
            value={answers[challenge.index] ?? ''}
            onChangeText={(text) =>
              setAnswers((current) => ({ ...current, [challenge.index]: text.trim() }))
            }
            style={styles.input}
            placeholder="••••••"
            placeholderTextColor={colors.muted}
          />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.muted,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    fontSize: 16,
  },
});

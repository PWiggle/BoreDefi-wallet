import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { confirmPhraseMatches, type ProtectedVerdict } from '../wallet/protected-guard';
import { Button } from './Button';
import { ProtectedReauth } from './ProtectedReauth';

function guardStyles({ colors, field, radius, spacing, type }: Theme) {
  return {
    root: { backgroundColor: colors.dangerSurface, flex: 1 },
    body: { gap: spacing.md, padding: spacing.lg },
    badge: {
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.danger,
      borderRadius: radius.pill,
      color: colors.dangerHoldText,
      fontWeight: '900' as const,
      overflow: 'hidden' as const,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    title: { color: colors.danger, fontSize: 26, fontWeight: '900' as const },
    label: { ...type.label, color: colors.danger },
    value: { color: colors.text, fontSize: 15, fontWeight: '700' as const },
    mono: { color: colors.text, fontFamily: 'monospace', fontSize: 14 },
    line: { color: colors.text, fontSize: 15, lineHeight: 21 },
    blockBox: { borderColor: colors.danger, borderRadius: radius.md, borderWidth: 2, gap: spacing.sm, padding: spacing.md },
    blockTitle: { color: colors.danger, fontSize: 18, fontWeight: '900' as const },
    input: { ...field, borderColor: colors.danger },
  };
}

/**
 * Full-screen red warning for any request that touches a protected Yuga Labs / BAYC asset or ApeCoin,
 * or a blind signature. Blocked requests only offer Reject. Others need the collection name typed
 * exactly, then a fresh PIN / biometric check; only then is the request's fingerprint released.
 */
export function ProtectedGuardSheet({
  verdict,
  network,
  dapp,
  busy,
  error,
  onApprove,
  onReject,
}: {
  verdict: ProtectedVerdict | null;
  network: string;
  dapp?: string;
  busy?: boolean;
  error?: string | null;
  onApprove: (clearance: string) => void;
  onReject: () => void;
}) {
  const styles = useThemedStyles(guardStyles);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
  }, [verdict?.fingerprint]);

  if (!verdict) {
    return null;
  }
  const collections = [...new Set(verdict.findings.filter((item) => item.action !== 'revoke').map((item) => item.asset.name))];
  const spenders = [...new Set(verdict.findings.map((item) => item.counterparty).filter((item): item is string => Boolean(item)))];
  const phraseOk = confirmPhraseMatches(typed, verdict.confirmPhrase);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onReject}>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.badge}>{verdict.blocked ? 'BLOCKED' : 'PROTECTED ASSET'}</Text>
          <Text style={styles.title}>{verdict.headline}</Text>
          {collections.length ? (
            <View>
              <Text style={styles.label}>Collection</Text>
              <Text style={styles.value}>{collections.join(', ')}</Text>
            </View>
          ) : null}
          {spenders.length ? (
            <View>
              <Text style={styles.label}>Spender / recipient (full address)</Text>
              {spenders.map((item) => (
                <Text key={item} selectable style={styles.mono}>
                  {item}
                </Text>
              ))}
            </View>
          ) : null}
          <View>
            <Text style={styles.label}>Network · requested by</Text>
            <Text style={styles.value}>
              {network}
              {dapp ? ` · ${dapp}` : ''}
            </Text>
          </View>
          {verdict.lines.map((line) => (
            <Text key={line} style={styles.line}>
              • {line}
            </Text>
          ))}
          {error ? <Text style={styles.blockTitle}>{error}</Text> : null}
          {verdict.blocked ? (
            <View style={styles.blockBox}>
              <Text style={styles.blockTitle}>The wallet will not sign this</Text>
              {verdict.blockReasons.map((reason) => (
                <Text key={reason} style={styles.line}>
                  {reason}
                </Text>
              ))}
            </View>
          ) : (
            <>
              <Text style={styles.label}>{`To continue, type: ${verdict.confirmPhrase}`}</Text>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={verdict.confirmPhrase}
                style={styles.input}
              />
              <ProtectedReauth
                reason={`Approve ${verdict.confirmPhrase}`}
                disabled={!phraseOk}
                busy={busy}
                confirmLabel="Sign"
                onVerified={() => onApprove(verdict.fingerprint)}
              />
            </>
          )}
          <Button label="Reject" onPress={onReject} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

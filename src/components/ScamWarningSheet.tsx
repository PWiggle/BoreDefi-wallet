import { Modal, ScrollView, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { neutralizeUrls } from '../wallet/security/text-safety';
import type { ScamWarning } from '../wallet/security/scam-warnings';
import { Button } from './Button';

function sheetStyles({ colors, radius, spacing, type }: Theme) {
  return {
    backdrop: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'center' as const },
    scroll: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.lg },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.warning,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing.sm,
      padding: spacing.lg,
    },
    cardDanger: { borderColor: colors.danger },
    badge: {
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.warningSurface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    badgeDanger: { backgroundColor: colors.dangerSurface },
    badgeText: { color: colors.warning, fontSize: 12, fontWeight: '800' as const },
    badgeTextDanger: { color: colors.danger },
    title: { color: colors.text, fontSize: 22, fontWeight: '800' as const },
    summary: { ...type.body, fontSize: 15, lineHeight: 21 },
    reasons: { gap: 4 },
    reason: { ...type.body, color: colors.muted, fontSize: 13, lineHeight: 18 },
    row: { gap: 2 },
    label: type.label,
    value: { ...type.body, fontSize: 12 },
    footer: { ...type.meta, fontSize: 12 },
  };
}

/**
 * Calm, clear stop sign before something risky: a flagged site, an unlimited approval, a blind signature.
 * "Go back" is the primary (safe) button; "Continue anyway" is a quiet secondary when allowed.
 */
export function ScamWarningSheet({
  warning,
  site,
  onGoBack,
  onContinue,
}: {
  warning: ScamWarning | null;
  /** Site / dApp the request came from, if any. */
  site?: string | null;
  onGoBack: () => void;
  onContinue: () => void;
}) {
  const styles = useThemedStyles(sheetStyles);
  if (!warning) {
    return null;
  }
  const danger = warning.severity === 'danger';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onGoBack}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, danger && styles.cardDanger]} accessibilityRole="alert">
            <View style={[styles.badge, danger && styles.badgeDanger]}>
              <Text style={[styles.badgeText, danger && styles.badgeTextDanger]}>
                {danger ? 'Security warning' : 'Heads up'}
              </Text>
            </View>
            <Text style={styles.title}>{warning.title}</Text>
            <Text style={styles.summary}>{neutralizeUrls(warning.summary)}</Text>
            {warning.reasons.length ? (
              <View style={styles.reasons}>
                {warning.reasons.map((reason) => (
                  <Text key={reason} style={styles.reason}>
                    • {neutralizeUrls(reason)}
                  </Text>
                ))}
              </View>
            ) : null}
            {site ? (
              <View style={styles.row}>
                <Text style={styles.label}>Site</Text>
                <Text selectable style={styles.value}>{neutralizeUrls(site)}</Text>
              </View>
            ) : null}
            {warning.spender ? (
              <View style={styles.row}>
                <Text style={styles.label}>Spender</Text>
                <Text selectable style={styles.value}>{warning.spender}</Text>
              </View>
            ) : null}
            {warning.token ? (
              <View style={styles.row}>
                <Text style={styles.label}>Token / collection</Text>
                <Text selectable style={styles.value}>{warning.token}</Text>
              </View>
            ) : null}
            <Button label="Go back" onPress={onGoBack} accessibilityHint="Cancels this and keeps your wallet safe" />
            {warning.canContinue ? (
              <Button label="Continue anyway" variant="ghost" onPress={onContinue} />
            ) : (
              <Text style={styles.footer}>BoreDefi does not allow this one.</Text>
            )}
            <Text style={styles.footer}>Checked with public scam lists and GoPlus Security. They can miss new scams.</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

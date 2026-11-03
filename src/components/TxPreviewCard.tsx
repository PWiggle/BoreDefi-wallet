import { ActivityIndicator, Text, View } from 'react-native';

import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import type { PreviewTone, TxPreview } from '../wallet/tx-simulate';

function previewStyles({ colors, radius, spacing, type }: Theme) {
  return {
    box: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 8,
      padding: spacing.md,
    },
    boxDanger: { borderColor: colors.danger },
    head: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    title: { ...type.label, color: colors.text },
    chip: {
      borderRadius: radius.pill,
      fontSize: 11,
      fontWeight: '800' as const,
      overflow: 'hidden' as const,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    row: { alignItems: 'flex-start' as const, flexDirection: 'row' as const, gap: 10 },
    icon: { fontSize: 15, fontWeight: '900' as const, textAlign: 'center' as const, width: 18 },
    line: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 },
    note: { ...type.meta, fontSize: 12 },
  };
}

const ICON: Record<PreviewTone, string> = {
  out: '↑',
  in: '↓',
  approval: '!',
  revoke: '×',
  info: '•',
  danger: '!',
};

/** "What will happen" box shown on every confirm screen: what leaves, what arrives, who gets permission. */
export function TxPreviewCard({ preview, loading }: { preview: TxPreview | null; loading?: boolean }) {
  const styles = useThemedStyles(previewStyles);
  const { colors } = useTheme();
  const toneColor: Record<PreviewTone, string> = {
    out: colors.danger,
    in: colors.accent,
    approval: colors.warning,
    revoke: colors.muted,
    info: colors.muted,
    danger: colors.danger,
  };
  if (loading && !preview) {
    return (
      <View style={styles.box}>
        <View style={styles.head}>
          <Text style={styles.title}>What will happen</Text>
          <ActivityIndicator color={colors.accent} size="small" />
        </View>
        <Text style={styles.note}>Simulating before you sign…</Text>
      </View>
    );
  }
  if (!preview) {
    return null;
  }
  const bad = preview.willFail || preview.status === 'unavailable' || preview.lines.some((line) => line.tone === 'danger');
  const chip =
    preview.status === 'simulated'
      ? { label: preview.willFail ? 'WOULD FAIL' : 'SIMULATED', color: preview.willFail ? colors.danger : colors.accent }
      : preview.status === 'signature'
        ? { label: 'SIGNATURE', color: colors.warning }
        : preview.status === 'estimated'
          ? { label: 'ESTIMATED', color: colors.warning }
          : { label: 'NOT SIMULATED', color: colors.danger };
  return (
    <View style={[styles.box, bad && styles.boxDanger]}>
      <View style={styles.head}>
        <Text style={styles.title}>What will happen</Text>
        <Text style={[styles.chip, { backgroundColor: chip.color, color: colors.accentText }]}>{chip.label}</Text>
      </View>
      {preview.lines.map((line, index) => (
        <View key={`${index}-${line.text}`} style={styles.row}>
          <Text style={[styles.icon, { color: toneColor[line.tone] }]}>{ICON[line.tone]}</Text>
          <Text style={[styles.line, line.tone === 'danger' && { color: colors.danger }]}>{line.text}</Text>
        </View>
      ))}
      <Text style={styles.note}>{preview.note}</Text>
    </View>
  );
}

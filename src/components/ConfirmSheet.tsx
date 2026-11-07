import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { checksumAddress } from '../wallet/address-safety';
import type { TxPreview } from '../wallet/tx-simulate';
import { Button } from './Button';
import { TxPreviewCard } from './TxPreviewCard';
import { WarningBanner } from './WarningBanner';

export type ConfirmRow = {
  label: string;
  value: string;
};

type Props = {
  visible: boolean;
  title: string;
  /** Optional https icon shown next to the title (WalletConnect dApp logo). */
  icon?: string | null;
  network: string;
  from?: string;
  to?: string;
  amount?: string;
  fee?: string;
  /** Small grey line under the fee (e.g. the gas limit). */
  feeDetail?: string;
  extra?: ConfirmRow[];
  /** Transaction preview ("What will happen"). */
  preview?: TxPreview | null;
  previewLoading?: boolean;
  warnings?: string[];
  loading?: boolean;
  mode?: 'hold' | 'buttons';
  variant?: 'default' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const HOLD_MS = 1800;

function confirmStyles({ colors, radius, spacing, type }: Theme) {
  return {
    backdrop: {
      backgroundColor: colors.overlay,
      flex: 1,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center' as const,
      padding: spacing.lg,
    },
    detail: {
      ...type.meta,
      fontSize: 12,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing.sm,
      padding: spacing.lg,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '800' as const,
    },
    row: {
      gap: 4,
    },
    label: type.label,
    value: {
      ...type.body,
      fontSize: 14,
    },
    hold: {
      alignItems: 'center' as const,
      backgroundColor: colors.accentDim,
      borderRadius: radius.md,
      justifyContent: 'center' as const,
      minHeight: 52,
      overflow: 'hidden' as const,
    },
    holdDisabled: {
      opacity: 0.45,
    },
    holdFill: {
      backgroundColor: colors.accent,
      bottom: 0,
      left: 0,
      position: 'absolute' as const,
      top: 0,
    },
    holdLabel: {
      color: colors.accentText,
      fontSize: 16,
      fontWeight: '800' as const,
      zIndex: 1,
    },
    cardDanger: {
      borderColor: colors.danger,
    },
    titleDanger: {
      color: colors.danger,
    },
    titleRow: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      gap: spacing.sm,
    },
    icon: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      height: 40,
      width: 40,
    },
    holdDanger: {
      backgroundColor: colors.dangerHold,
    },
    holdFillDanger: {
      backgroundColor: colors.danger,
    },
    holdLabelDanger: {
      color: colors.dangerHoldText,
    },
  };
}

function displayAddress(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return checksumAddress(value) ?? value;
}

export function ConfirmSheet({
  visible,
  title,
  icon,
  network,
  from,
  to,
  amount,
  fee,
  feeDetail,
  extra = [],
  preview,
  previewLoading,
  warnings = [],
  loading,
  mode = 'hold',
  variant = 'default',
  confirmLabel = 'Hold to confirm',
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const styles = useThemedStyles(confirmStyles);
  const danger = variant === 'danger';
  const rejectLabel = cancelLabel ?? (danger ? 'Reject' : 'Cancel');
  const [held, setHeld] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);

  const stopHold = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setHeld(0);
  };

  useEffect(() => {
    if (!visible) {
      stopHold();
      fired.current = false;
    }
  }, [visible]);

  const startHold = () => {
    if (loading) {
      return;
    }
    fired.current = false;
    const started = Date.now();
    timer.current = setInterval(() => {
      const next = Math.min(1, (Date.now() - started) / HOLD_MS);
      setHeld(next);
      if (next >= 1 && !fired.current) {
        fired.current = true;
        stopHold();
        onConfirm();
      }
    }, 40);
  };

  const rows: ConfirmRow[] = [
    { label: 'Network', value: network },
    ...(from ? [{ label: 'From', value: displayAddress(from) ?? from }] : []),
    ...(to ? [{ label: 'To', value: displayAddress(to) ?? to }] : []),
    ...(amount ? [{ label: 'Amount', value: amount }] : []),
  ];
  const renderRow = (row: ConfirmRow) => (
    <View key={`${row.label}-${row.value}`} style={styles.row}>
      <Text style={styles.label}>{row.label}</Text>
      <Text selectable style={styles.value}>
        {row.value}
      </Text>
    </View>
  );

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, danger && styles.cardDanger]}>
          {icon && /^https:\/\//i.test(icon) ? (
            <View style={styles.titleRow}>
              <Image source={{ uri: icon }} style={styles.icon} accessibilityIgnoresInvertColors />
              <Text style={[styles.title, danger && styles.titleDanger, { flex: 1 }]}>{title}</Text>
            </View>
          ) : (
            <Text style={[styles.title, danger && styles.titleDanger]}>{title}</Text>
          )}
          {rows.map(renderRow)}
          {fee ? (
            <View style={styles.row}>
              <Text style={styles.label}>Estimated network fee</Text>
              <Text selectable style={styles.value}>
                {fee}
              </Text>
              {feeDetail ? <Text style={styles.detail}>{feeDetail}</Text> : null}
            </View>
          ) : null}
          {extra.map(renderRow)}
          {preview || previewLoading ? <TxPreviewCard preview={preview ?? null} loading={previewLoading} /> : null}
          <WarningBanner
            danger={danger}
            title={danger ? 'Do not approve unless you started this' : undefined}
            lines={warnings}
          />
          {danger || mode === 'hold' ? (
            <>
              {danger ? <Button label={rejectLabel} onPress={onCancel} /> : null}
              <Pressable
                disabled={loading}
                onPressIn={startHold}
                onPressOut={stopHold}
                style={[styles.hold, danger && styles.holdDanger, loading && styles.holdDisabled]}
              >
                <View
                  style={[
                    styles.holdFill,
                    danger ? styles.holdFillDanger : null,
                    { width: `${Math.round(held * 100)}%` },
                  ]}
                />
                <Text style={[styles.holdLabel, danger && styles.holdLabelDanger]}>
                  {previewLoading ? 'Checking…' : loading ? 'Submitting…' : confirmLabel}
                </Text>
              </Pressable>
              {danger ? null : <Button label={rejectLabel} variant="ghost" onPress={onCancel} />}
            </>
          ) : (
            <>
              <Button label={confirmLabel} loading={loading} onPress={onConfirm} />
              <Button label={rejectLabel} variant="secondary" onPress={onCancel} />
            </>
          )}
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

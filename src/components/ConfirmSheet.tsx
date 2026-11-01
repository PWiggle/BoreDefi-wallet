import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { checksumAddress } from '../wallet/address-safety';
import { Button } from './Button';
import { WarningBanner } from './WarningBanner';

export type ConfirmRow = {
  label: string;
  value: string;
};

type Props = {
  visible: boolean;
  title: string;
  network: string;
  from?: string;
  to?: string;
  amount?: string;
  fee?: string;
  extra?: ConfirmRow[];
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
      justifyContent: 'center' as const,
      padding: spacing.lg,
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
  network,
  from,
  to,
  amount,
  fee,
  extra = [],
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
    ...(fee ? [{ label: 'Estimated fee', value: fee }] : []),
    ...extra,
  ];

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.card, danger && styles.cardDanger]}>
          <Text style={[styles.title, danger && styles.titleDanger]}>{title}</Text>
          {rows.map((row) => (
            <View key={`${row.label}-${row.value}`} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text selectable style={styles.value}>
                {row.value}
              </Text>
            </View>
          ))}
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
                  {loading ? 'Submitting…' : confirmLabel}
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
      </View>
    </Modal>
  );
}

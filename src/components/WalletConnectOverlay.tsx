import { Modal, StyleSheet, Text, View } from 'react-native';

import { describeRequest, useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import { colors, radius, spacing } from '../theme';
import { hexToUtf8, pickSignMessage } from '../wallet/wc';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { useState } from 'react';

export function WalletConnectOverlay() {
  const { phase } = useWallet();
  const { pendingProposal, pendingRequest, approveProposal, rejectProposal, approveRequest, rejectRequest } =
    useWalletConnect();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (phase !== 'unlocked') {
    return null;
  }

  const visible = Boolean(pendingProposal || pendingRequest);
  if (!visible) {
    return null;
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ErrorBanner message={error} />
          {pendingProposal ? (
            <>
              <Text style={styles.title}>Connect to {pendingProposal.name}</Text>
              <Text style={styles.body}>{pendingProposal.url}</Text>
              <Text style={styles.body}>
                This shares your public address and lets the dApp request signatures. Keys stay on this
                device.
              </Text>
              <Button label="Connect" loading={busy} onPress={() => run(approveProposal)} />
              <Button label="Reject" variant="secondary" onPress={() => run(rejectProposal)} />
            </>
          ) : pendingRequest ? (
            <>
              <Text style={styles.title}>{pendingRequest.peerName}</Text>
              <Text style={styles.body}>{describeRequest(pendingRequest)}</Text>
              {pendingRequest.method === 'personal_sign' || pendingRequest.method === 'eth_sign' ? (
                <Text style={styles.preview}>{safePreview(pendingRequest.params)}</Text>
              ) : null}
              <Button label="Approve" loading={busy} onPress={() => run(approveRequest)} />
              <Button label="Reject" variant="secondary" onPress={() => run(rejectRequest)} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function safePreview(params: unknown[]): string {
  try {
    return hexToUtf8(pickSignMessage(params)).slice(0, 400);
  } catch {
    return 'Message preview unavailable.';
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  body: {
    color: colors.muted,
    lineHeight: 20,
  },
  preview: {
    color: colors.text,
    backgroundColor: colors.bg,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
});

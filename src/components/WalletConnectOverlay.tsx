import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { describeRequest, useWalletConnect } from '../context/WalletConnectContext';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { requiresReauth, routeWalletConnectRequest, verifyLabel } from '../wallet/wc-session';
import { readSolanaWcTransaction, reviewSolanaTransaction, decodeSignableMessage } from '../wallet/solana/wc-solana';
import { Button } from './Button';
import { ProtectedReauth } from './ProtectedReauth';
import { WarningBanner } from './WarningBanner';
import { inspectDappApproval } from '../wallet/approval-risk';
import { CHAINS } from '../wallet/chains';
import { formatNative } from '../wallet/format';
import { neutralizeUrls } from '../wallet/security/text-safety';
import { hexToUtf8, pickSignMessage } from '../wallet/wc';
import { resolveConnectAccount, sourceWalletNotice } from '../wallet/wc-source';
import { formatNetworkFee } from '../wallet/network-fee';
import { reviewDappRequest } from '../wallet/request-review';
import type { TxPreview } from '../wallet/tx-simulate';
import type { ProtectedVerdict } from '../wallet/protected-guard';
import { ConfirmSheet } from './ConfirmSheet';
import { ProtectedGuardSheet } from './ProtectedGuardSheet';
import { ScamWarningSheet } from './ScamWarningSheet';
import { goplus, goplusEnabled, type RiskReport } from '../wallet/security/goplus';
import { isKnownGoodSite } from '../wallet/security/phishing';
import { localSigningWarning, remoteSiteWarning, signingWarning, siteWarning, type ScamWarning } from '../wallet/security/scam-warnings';
import { networkFeeLabel, useNetworkFee } from './useNetworkFee';

function txValue(value: unknown, symbol: string): string | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  try {
    return `${formatNative(BigInt(value))} ${symbol}`;
  } catch {
    return value;
  }
}

export function WalletConnectOverlay() {
  const { phase, session, selectedChain, solanaAddress } = useWallet();
  const {
    pendingProposal,
    pendingRequest,
    queuedRequests,
    notice,
    clearNotice,
    accounts,
    approveProposal,
    rejectProposal,
    approveRequest,
    rejectRequest,
  } = useWalletConnect();
  // Account picked on the Connect sheet; null = the active wallet.
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  useEffect(() => {
    setPickedAccount(null);
  }, [pendingProposal?.id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ProtectedVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<TxPreview | null>(null);
  // Set after Hold to approve on a signing request: a fresh PIN / biometric check runs before the key is used.
  const [reauth, setReauth] = useState(false);
  // Scam warnings: shown before the normal sheet until the user taps "Continue anyway" (ack = that proposal / request id).
  const [scamWarning, setScamWarning] = useState<ScamWarning | null>(null);
  const [scamAck, setScamAck] = useState<number | null>(null);
  const [proposalSiteRisk, setProposalSiteRisk] = useState<RiskReport | null>(null);
  const [proposalChecking, setProposalChecking] = useState(false);
  const [scamChecking, setScamChecking] = useState(false);
  const styles = useThemedStyles(overlayStyles);

  useEffect(() => {
    let cancelled = false;
    setProposalSiteRisk(null);
    setProposalChecking(false);
    const url = pendingProposal?.url;
    if (!pendingProposal || pendingProposal.blockedReason || !url || !goplusEnabled() || isKnownGoodSite(url)) {
      return;
    }
    setProposalChecking(true);
    goplus()
      .siteRisk(url)
      .then((risk) => {
        if (!cancelled) setProposalSiteRisk(risk?.level === 'danger' ? risk : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setProposalChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingProposal]);

  useEffect(() => {
    let cancelled = false;
    setScamWarning(null);
    setScamChecking(false);
    if (!pendingRequest || routeWalletConnectRequest(pendingRequest.method) === 'solana') {
      return;
    }
    // Local decode first (instant), then GoPlus spender / recipient checks; approving waits for both.
    setScamWarning(localSigningWarning(pendingRequest.method, pendingRequest.params));
    setScamChecking(true);
    signingWarning({
      method: pendingRequest.method,
      params: pendingRequest.params,
      chainId: pendingRequest.chainId,
      client: goplusEnabled() ? goplus() : null,
    })
      .then((next) => {
        if (!cancelled) setScamWarning(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setScamChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingRequest]);
  const fee = useNetworkFee(pendingRequest?.chainId ?? 1, preview?.gasUsed ?? null, Boolean(pendingRequest));

  useEffect(() => {
    let cancelled = false;
    setVerdict(null);
    setPreview(null);
    setReauth(false);
    setError(null);
    if (!pendingRequest || !session) {
      return;
    }
    if (routeWalletConnectRequest(pendingRequest.method) === 'solana') {
      // Solana is decoded locally (wc-solana); the EVM simulator and Yuga guard don't apply.
      return;
    }
    setChecking(true);
    // Simulate first (transaction preview), then run the protected guard with what the simulation found.
    reviewDappRequest({
      method: pendingRequest.method,
      params: pendingRequest.params,
      chainId: pendingRequest.chainId,
      owner: session.address,
    })
      .then((next) => {
        if (!cancelled) {
          setVerdict(next.verdict);
          setPreview(next.preview);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingRequest, session]);

  const solanaReview = useMemo(() => {
    if (!pendingRequest || !solanaAddress) {
      return null;
    }
    try {
      if (pendingRequest.method === 'solana_signTransaction') {
        const { tx } = readSolanaWcTransaction(pendingRequest.params[0]);
        return { kind: 'tx' as const, review: reviewSolanaTransaction(tx, solanaAddress), error: null };
      }
      if (pendingRequest.method === 'solana_signMessage') {
        const message = (pendingRequest.params[0] as { message?: string } | undefined)?.message ?? '';
        return { kind: 'message' as const, text: decodeSignableMessage(message).text, error: null };
      }
    } catch (err) {
      return { kind: 'invalid' as const, error: err instanceof Error ? err.message : 'Request could not be read.' };
    }
    return null;
  }, [pendingRequest, solanaAddress]);

  if (phase !== 'unlocked') {
    return null;
  }

  if (notice && !pendingProposal && !pendingRequest) {
    return (
      <Modal transparent animationType="fade" visible onRequestClose={clearNotice}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>WalletConnect</Text>
            <WarningBanner danger lines={[neutralizeUrls(notice)]} />
            <Button label="OK" onPress={clearNotice} />
          </View>
        </View>
      </Modal>
    );
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

  if (pendingProposal) {
    const flaggedSite = pendingProposal.blockedReason
      ? siteWarning(
          {
            host: pendingProposal.blockedHost ?? pendingProposal.host,
            reason: pendingProposal.blockedReason,
            source: null,
            canContinue: pendingProposal.blockedCanContinue,
          },
          'walletconnect',
        )
      : proposalSiteRisk
        ? remoteSiteWarning(pendingProposal.host || pendingProposal.name, proposalSiteRisk.reasons, 'walletconnect')
        : null;
    if (flaggedSite && scamAck !== pendingProposal.id) {
      return (
        <ScamWarningSheet
          warning={flaggedSite}
          site={pendingProposal.url || pendingProposal.name}
          onGoBack={() => run(rejectProposal)}
          onContinue={() => setScamAck(pendingProposal.id)}
        />
      );
    }
    const mismatch = pendingProposal.verify === 'mismatch' || Boolean(flaggedSite);
    const account = resolveConnectAccount(accounts, pickedAccount);
    const wantsSolana = pendingProposal.chains.some((name) => name.startsWith('Solana'));
    return (
      <ConfirmSheet
        visible
        title={`Connect to ${pendingProposal.name}`}
        icon={pendingProposal.icon}
        network={pendingProposal.chains.length ? pendingProposal.chains.join(', ') : selectedChain.name}
        from={account?.address}
        notice={pendingProposal.sourceWallet ? sourceWalletNotice(pendingProposal.sourceWallet) : null}
        extra={[
          { label: 'dApp', value: pendingProposal.url || 'No website given' },
          { label: 'Verify', value: verifyLabel(pendingProposal.verify) },
          ...(pendingProposal.methods.length
            ? [{ label: 'Can ask you to', value: pendingProposal.methods.join(', ') }]
            : []),
          ...(pendingProposal.unsupportedChains.length
            ? [{ label: 'Not supported (skipped)', value: pendingProposal.unsupportedChains.join(', ') }]
            : []),
          ...(account?.solanaAddress && wantsSolana
            ? [{ label: 'Solana account', value: account.solanaAddress }]
            : []),
          { label: 'Access', value: 'Shares your public address. Keys stay on this device. Every signature asks you first.' },
        ]}
        warnings={[...(flaggedSite ? [flaggedSite.summary, ...flaggedSite.reasons] : []), ...pendingProposal.warnings, ...(error ? [error] : [])]}
        variant={mismatch ? 'danger' : 'default'}
        mode="buttons"
        confirmLabel={mismatch ? 'Connect anyway' : 'Connect'}
        cancelLabel="Reject"
        loading={busy || proposalChecking}
        onConfirm={() => run(() => approveProposal(account?.address ?? null))}
        onCancel={() => run(rejectProposal)}
      >
        <View style={styles.accounts} accessibilityRole="radiogroup" accessibilityLabel="BoreDefi account to connect">
          <Text style={styles.accountsLabel}>Connect as</Text>
          {accounts.map((item) => {
            const selected = account?.address === item.address;
            return (
              <Pressable
                key={item.address}
                onPress={() => setPickedAccount(item.address)}
                style={[styles.accountRow, selected && styles.accountRowSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={styles.accountName}>
                  {selected ? '● ' : '○ '}
                  {item.label}
                  {item.active ? ' (active)' : ''}
                </Text>
                <Text selectable style={styles.accountAddress}>
                  {item.address}
                </Text>
              </Pressable>
            );
          })}
          {accounts.length === 1 ? (
            <Text style={styles.accountsHint}>This is the only wallet in BoreDefi. To connect a different address, import that wallet in BoreDefi first.</Text>
          ) : null}
        </View>
      </ConfirmSheet>
    );
  }

  if (!pendingRequest) {
    return null;
  }

  const approve = () => {
    if (requiresReauth(pendingRequest.method)) {
      setError(null);
      setReauth(true);
      return;
    }
    void run(() => approveRequest());
  };

  if (reauth) {
    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => setReauth(false)}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.card}>
              <Text style={styles.title}>Confirm it's you</Text>
              <Text style={styles.body}>
                {neutralizeUrls(pendingRequest.peerName)} wants a signature. Nothing is signed until you confirm.
              </Text>
              {error ? <WarningBanner danger lines={[error]} /> : null}
              <ProtectedReauth
                reason="Sign a WalletConnect request"
                busy={busy}
                confirmLabel="Sign"
                onVerified={() => {
                  void run(async () => {
                    await approveRequest();
                    setReauth(false);
                  });
                }}
              />
              <Button
                label="Reject"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setReauth(false);
                  void run(rejectRequest);
                }}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  const queued = queuedRequests > 0 ? [`${queuedRequests} more request${queuedRequests === 1 ? '' : 's'} waiting after this one.`] : [];
  const verifyWarning =
    pendingRequest.verify === 'mismatch'
      ? ['Reown Verify: this request did not come from the site it claims. Reject unless you are sure.']
      : [];

  if (routeWalletConnectRequest(pendingRequest.method) === 'solana') {
    const review = solanaReview?.kind === 'tx' ? solanaReview.review : null;
    const invalid = solanaReview?.kind === 'invalid' ? solanaReview.error : null;
    const danger = Boolean(review?.danger) || Boolean(invalid);
    return (
      <ConfirmSheet
        visible
        title={review?.danger ? 'Danger: Solana transaction' : neutralizeUrls(pendingRequest.peerName)}
        network="Solana"
        from={solanaAddress ?? undefined}
        amount={
          invalid
            ? 'Cannot be signed'
            : solanaReview?.kind === 'message'
              ? 'Message signature'
              : review?.summary ?? pendingRequest.method
        }
        fee={pendingRequest.method === 'solana_signTransaction' ? 'Paid when the dApp sends it' : 'None (signature only)'}
        extra={[
          {
            label: 'Request',
            value:
              solanaReview?.kind === 'message'
                ? neutralizeUrls(solanaReview.text).slice(0, 400)
                : describeRequest(pendingRequest),
          },
          ...(review ? [{ label: 'Programs', value: review.programs.join(', ') }] : []),
          ...(review && !review.feePayerIsWallet ? [{ label: 'Fee payer', value: 'Another account (not you)' }] : []),
          { label: 'dApp', value: neutralizeUrls(pendingRequest.peerName) },
        ]}
        warnings={[...(invalid ? [invalid] : []), ...(review?.warnings ?? []), ...verifyWarning, ...queued, ...(error ? [error] : [])]}
        variant={danger ? 'danger' : 'default'}
        mode={invalid ? 'buttons' : 'hold'}
        loading={busy}
        confirmLabel={invalid ? 'Reject' : danger ? 'Hold to approve anyway' : 'Hold to approve'}
        cancelLabel="Reject"
        onConfirm={invalid ? () => run(rejectRequest) : approve}
        onCancel={() => run(rejectRequest)}
      />
    );
  }

  if (scamWarning && scamAck !== pendingRequest.id) {
    return (
      <ScamWarningSheet
        warning={scamWarning}
        site={neutralizeUrls(pendingRequest.peerName)}
        onGoBack={() => run(rejectRequest)}
        onContinue={() => setScamAck(pendingRequest.id)}
      />
    );
  }

  if (verdict?.protected) {
    return (
      <ProtectedGuardSheet
        verdict={verdict}
        network={CHAINS[pendingRequest.chainId].name}
        dapp={neutralizeUrls(pendingRequest.peerName)}
        preview={preview}
        busy={busy || scamChecking}
        error={error}
        onApprove={(clearance) => run(() => approveRequest(clearance))}
        onReject={() => run(rejectRequest)}
      />
    );
  }

  const tx = pendingRequest.params[0] as { from?: string; to?: string; value?: string; data?: string } | undefined;
  const isSend = pendingRequest.method === 'eth_sendTransaction' || pendingRequest.method === 'eth_signTransaction';
  const risk = inspectDappApproval(pendingRequest.method, pendingRequest.params);
  const requestText =
    pendingRequest.method === 'personal_sign' || pendingRequest.method === 'eth_sign'
      ? safePreview(pendingRequest.params)
      : describeRequest(pendingRequest);

  return (
    <ConfirmSheet
      visible
      title={risk?.danger ? 'Danger: collection-wide approval' : neutralizeUrls(pendingRequest.peerName)}
      network={CHAINS[pendingRequest.chainId].name}
      from={tx?.from ?? session?.address}
      to={isSend ? tx?.to : undefined}
      amount={
        risk?.danger
          ? risk.summary
          : isSend
            ? txValue(tx?.value, selectedChain.symbol) ?? pendingRequest.method
            : pendingRequest.method
      }
      fee={isSend ? (checking ? 'Estimating…' : networkFeeLabel(fee, 'Network gas (quoted at sign)', formatNetworkFee)) : 'None (signature only)'}
      preview={preview}
      previewLoading={checking}
      extra={[
        { label: 'Request', value: requestText },
        ...(risk?.operator ? [{ label: 'Operator', value: risk.operator }] : []),
        ...(risk?.token ? [{ label: 'Token / collection', value: risk.token }] : []),
        { label: 'dApp', value: neutralizeUrls(pendingRequest.peerName) },
      ]}
      warnings={[...(risk?.warnings ?? []), ...verifyWarning, ...queued, ...(error ? [error] : [])]}
      variant={risk?.danger || pendingRequest.verify === 'mismatch' ? 'danger' : 'default'}
      loading={busy || checking || scamChecking}
      confirmLabel={risk?.danger ? 'Hold to approve anyway' : 'Hold to approve'}
      cancelLabel="Reject"
      onConfirm={approve}
      onCancel={() => run(rejectRequest)}
    />
  );
}

function safePreview(params: unknown[]): string {
  try {
    return neutralizeUrls(hexToUtf8(pickSignMessage(params))).slice(0, 400);
  } catch {
    return 'Message preview unavailable.';
  }
}

function overlayStyles({ colors, radius, spacing, type }: Theme) {
  return {
    backdrop: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'center' as const },
    accounts: { gap: spacing.xs },
    accountsLabel: type.label,
    accountRow: {
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      gap: 2,
      padding: spacing.sm,
    },
    accountRowSelected: { borderColor: colors.accent },
    accountName: { ...type.body, fontSize: 14, fontWeight: '700' as const },
    accountAddress: { ...type.body, fontSize: 12 },
    accountsHint: { ...type.meta, fontSize: 12 },
    scroll: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.lg },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing.sm,
      margin: spacing.lg,
      padding: spacing.lg,
    },
    title: { color: colors.text, fontSize: 22, fontWeight: '800' as const },
    body: { ...type.body, fontSize: 14 },
  };
}

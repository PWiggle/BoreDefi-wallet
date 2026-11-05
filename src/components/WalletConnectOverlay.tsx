import { useEffect, useState } from 'react';

import { describeRequest, useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import { inspectDappApproval } from '../wallet/approval-risk';
import { CHAINS } from '../wallet/chains';
import { formatNative } from '../wallet/format';
import { neutralizeUrls } from '../wallet/security/text-safety';
import { hexToUtf8, pickSignMessage } from '../wallet/wc';
import { formatNetworkFee } from '../wallet/network-fee';
import { reviewDappRequest } from '../wallet/request-review';
import type { TxPreview } from '../wallet/tx-simulate';
import type { ProtectedVerdict } from '../wallet/protected-guard';
import { ConfirmSheet } from './ConfirmSheet';
import { ProtectedGuardSheet } from './ProtectedGuardSheet';
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
  const { phase, session, selectedChain } = useWallet();
  const { pendingProposal, pendingRequest, approveProposal, rejectProposal, approveRequest, rejectRequest } =
    useWalletConnect();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ProtectedVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const fee = useNetworkFee(pendingRequest?.chainId ?? 1, preview?.gasUsed ?? null, Boolean(pendingRequest));

  useEffect(() => {
    let cancelled = false;
    setVerdict(null);
    setPreview(null);
    if (!pendingRequest || !session) {
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

  if (phase !== 'unlocked') {
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

  if (pendingProposal) {
    return (
      <ConfirmSheet
        visible
        title={`Connect to ${neutralizeUrls(pendingProposal.name)}`}
        network={selectedChain.name}
        from={session?.address}
        extra={[
          { label: 'dApp', value: pendingProposal.url },
          { label: 'Access', value: 'Shares your public address. Keys stay on this device. Never auto-sign.' },
        ]}
        warnings={error ? [error] : []}
        mode="buttons"
        confirmLabel="Connect"
        loading={busy}
        onConfirm={() => run(approveProposal)}
        onCancel={() => run(rejectProposal)}
      />
    );
  }

  if (!pendingRequest) {
    return null;
  }

  if (verdict?.protected) {
    return (
      <ProtectedGuardSheet
        verdict={verdict}
        network={CHAINS[pendingRequest.chainId].name}
        dapp={neutralizeUrls(pendingRequest.peerName)}
        preview={preview}
        busy={busy}
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
      warnings={[...(risk?.warnings ?? []), ...(error ? [error] : [])]}
      variant={risk?.danger ? 'danger' : 'default'}
      loading={busy || checking}
      confirmLabel={risk?.danger ? 'Hold to approve anyway' : 'Hold to approve'}
      cancelLabel="Reject"
      onConfirm={() => run(() => approveRequest())}
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

import { useState } from 'react';

import { describeRequest, useWalletConnect } from '../context/WalletConnectContext';
import { useWallet } from '../context/WalletContext';
import { CHAINS } from '../wallet/chains';
import { formatNative } from '../wallet/format';
import { hexToUtf8, pickSignMessage } from '../wallet/wc';
import { ConfirmSheet } from './ConfirmSheet';

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
        title={`Connect to ${pendingProposal.name}`}
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

  const tx = pendingRequest.params[0] as { from?: string; to?: string; value?: string } | undefined;
  const isSend = pendingRequest.method === 'eth_sendTransaction' || pendingRequest.method === 'eth_signTransaction';
  const preview =
    pendingRequest.method === 'personal_sign' || pendingRequest.method === 'eth_sign'
      ? safePreview(pendingRequest.params)
      : describeRequest(pendingRequest);

  return (
    <ConfirmSheet
      visible
      title={pendingRequest.peerName}
      network={selectedChain.name}
      from={tx?.from ?? session?.address}
      to={isSend ? tx?.to : undefined}
      amount={isSend ? txValue(tx?.value, selectedChain.symbol) ?? pendingRequest.method : pendingRequest.method}
      fee={isSend ? 'Network gas (quoted at sign)' : 'None (signature only)'}
      extra={[{ label: 'Request', value: preview }]}
      warnings={error ? [error] : []}
      loading={busy}
      confirmLabel="Hold to approve"
      onConfirm={() => run(approveRequest)}
      onCancel={() => run(rejectRequest)}
    />
  );
}

function safePreview(params: unknown[]): string {
  try {
    return hexToUtf8(pickSignMessage(params)).slice(0, 400);
  } catch {
    return 'Message preview unavailable.';
  }
}

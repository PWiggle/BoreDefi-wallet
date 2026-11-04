import { Interface } from 'ethers';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ProtectedGuardSheet } from '../components/ProtectedGuardSheet';
import { SafeNftImage } from '../components/SafeNftImage';
import { Screen } from '../components/Screen';
import { SwapConfirmSheet } from '../components/SwapConfirmSheet';
import { networkFeeLabel, useNetworkFee } from '../components/useNetworkFee';
import { useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { CHAINS } from '../wallet/chains';
import { formatNative } from '../wallet/format';
import { nftImageCandidates, protectedNftImageUrl } from '../wallet/nft-media';
import { estimateNetworkFee, formatNetworkFee } from '../wallet/network-fee';
import type { ProtectedVerdict } from '../wallet/protected-guard';
import { reviewDappRequest } from '../wallet/request-review';
import { fetchSwapQuote, type SwapQuote } from '../wallet/swap';
import { prepareSwapReview, swapFeeGasUnits } from '../wallet/swap-preview';
import { tokensForChain } from '../wallet/tokens';
import type { TxPreview } from '../wallet/tx-simulate';

/**
 * PROOF BUILDS ONLY (see proof-mode.ts). Opens the real confirm screens with live data from safe test requests made
 * from this wallet's own address. Every confirm / approve button here only closes the sheet: nothing is signed or sent.
 */

const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const TEST_OPERATOR = '0x000000000000000000000000000000000000dEaD';
const APPROVAL_IFACE = new Interface(['function setApprovalForAll(address operator, bool approved)']);

// Real token images (read-only): Lil Mutants #4632 (protected collection) and BAYC #0, as their metadata gives them.
const LIL_MUTANT_4632 = protectedNftImageUrl({ imageOriginal: 'ipfs://QmShzmT9H3mnWxKoy3ib5aUCb2hjTUamrPPNsoFUEXPZ28/4632.png' });
const BAYC_0_FROM_IPFS_IO = 'https://ipfs.io/ipfs/QmRRPWG96cmgTn2qSzjwr2qvfNEuhunv6FNeMFGa9bx6mQ';

function proofStyles({ type }: Theme) {
  return {
    meta: type.meta,
    nftRow: { flexDirection: 'row' as const, gap: 12 },
    nftCell: { flex: 1, gap: 6 },
    nftImage: { width: '100%' as const, aspectRatio: 1 },
  };
}

function gatewayHost(url: string | null | undefined): string {
  const first = nftImageCandidates(url)[0];
  return first ? new URL(first).hostname : 'none';
}

export function ProofScreen() {
  const styles = useThemedStyles(proofStyles);
  const { session } = useWallet();
  const chain = CHAINS[1];
  const [status, setStatus] = useState('Test requests only. Nothing here is ever signed or sent.');
  const [busy, setBusy] = useState(false);
  const [swap, setSwap] = useState<{ quote: SwapQuote; preview: TxPreview | null; loading: boolean; needsApproval: boolean } | null>(null);
  const [dapp, setDapp] = useState<{ tx: Record<string, string>; preview: TxPreview; fee: string } | null>(null);
  const [blocked, setBlocked] = useState<{ verdict: ProtectedVerdict; preview: TxPreview } | null>(null);
  const swapFee = useNetworkFee(1, swap && !swap.loading ? swapFeeGasUnits(swap.quote, swap.preview?.gasUsed ?? null, swap.needsApproval) : null, Boolean(swap));
  if (!session) {
    return null;
  }
  const owner = session.address;
  const eth = tokensForChain(1)[0]!;
  const usdc = tokensForChain(1).find((token) => token.symbol === 'USDC')!;

  const quote = () => fetchSwapQuote({ chainId: 1, fromToken: eth, toToken: usdc, fromAmount: 10n ** 16n, fromAddress: owner });

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      await action();
      setStatus(`${label}: ready`);
    } catch (error) {
      setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const openSwap = () =>
    run('Swap confirm', async () => {
      const next = await quote();
      setSwap({ quote: next, preview: null, loading: true, needsApproval: false });
      const review = await prepareSwapReview({ chainId: 1, owner, fromToken: eth, quote: next });
      if (!review.ok) {
        throw new Error(review.message);
      }
      setSwap({ quote: next, preview: review.preview, loading: false, needsApproval: review.needsApproval });
    });

  const openDapp = () =>
    run('dApp request preview', async () => {
      const next = await quote();
      const tx = {
        from: owner,
        to: next.transactionRequest.to,
        value: `0x${next.transactionRequest.value.toString(16)}`,
        data: next.transactionRequest.data,
      };
      const { preview } = await reviewDappRequest({ method: 'eth_sendTransaction', params: [tx], chainId: 1, owner });
      const fee = preview.gasUsed ? await estimateNetworkFee(1, preview.gasUsed) : null;
      setDapp({ tx, preview, fee: fee ? formatNetworkFee(fee) : 'Network gas (quoted at sign)' });
    });

  const openBlocked = () =>
    run('Protected approval', async () => {
      const tx = { from: owner, to: BAYC, value: '0x0', data: APPROVAL_IFACE.encodeFunctionData('setApprovalForAll', [TEST_OPERATOR, true]) };
      const { verdict, preview } = await reviewDappRequest({ method: 'eth_sendTransaction', params: [tx], chainId: 1, owner });
      if (!verdict?.protected) {
        throw new Error('Expected the protected guard to catch this request.');
      }
      setBlocked({ verdict, preview });
    });

  return (
    <Screen title="Proof (test build)" subtitle="Live previews from safe test requests. Confirm buttons only close the sheet.">
      <View style={styles.nftRow}>
        <View style={styles.nftCell}>
          <SafeNftImage url={LIL_MUTANT_4632 ?? undefined} style={styles.nftImage} />
          <Text style={styles.meta}>{`Lil Mutants #4632 (protected) · ${gatewayHost(LIL_MUTANT_4632)}`}</Text>
        </View>
        <View style={styles.nftCell}>
          <SafeNftImage url={BAYC_0_FROM_IPFS_IO} style={styles.nftImage} />
          <Text style={styles.meta}>{`BAYC #0 (metadata: ipfs.io) · ${gatewayHost(BAYC_0_FROM_IPFS_IO)}`}</Text>
        </View>
      </View>
      <Button label="Swap confirm: 0.01 ETH → USDC (live quote)" loading={busy} onPress={openSwap} />
      <Button label="dApp request preview (normal swap)" variant="secondary" onPress={openDapp} disabled={busy} />
      <Button label="dApp request: BAYC approve-all (must block)" variant="secondary" onPress={openBlocked} disabled={busy} />
      <Text style={styles.meta}>{status}</Text>
      <SwapConfirmSheet
        visible={Boolean(swap)}
        network={chain.name}
        fromAddress={owner}
        quote={swap?.quote ?? null}
        fee={swap?.loading ? 'Estimating…' : networkFeeLabel(swapFee, 'Network gas (quoted at broadcast)', formatNetworkFee)}
        preview={swap?.preview ?? null}
        previewLoading={Boolean(swap?.loading)}
        loading={false}
        confirmLabel="Hold to confirm (test: not sent)"
        onConfirm={() => {
          setSwap(null);
          setStatus('Test only: nothing was signed or sent.');
        }}
        onCancel={() => setSwap(null)}
      />
      <ConfirmSheet
        visible={Boolean(dapp)}
        title="Approve request"
        network={chain.name}
        from={owner}
        to={dapp?.tx.to}
        amount={dapp ? `${formatNative(BigInt(dapp.tx.value))} ${chain.symbol}` : undefined}
        fee={dapp?.fee}
        preview={dapp?.preview}
        extra={[
          { label: 'Site', value: 'Test request (proof build)' },
          { label: 'Method', value: 'eth_sendTransaction' },
        ]}
        mode="hold"
        confirmLabel="Hold to sign (test: not sent)"
        cancelLabel="Reject"
        onConfirm={() => {
          setDapp(null);
          setStatus('Test only: nothing was signed or sent.');
        }}
        onCancel={() => setDapp(null)}
      />
      {blocked ? (
        <ProtectedGuardSheet
          verdict={blocked.verdict}
          network={chain.name}
          dapp="Test request (proof build)"
          preview={blocked.preview}
          onApprove={() => {
            setBlocked(null);
            setStatus('Test only: nothing was signed or sent.');
          }}
          onReject={() => setBlocked(null)}
        />
      ) : null}
    </Screen>
  );
}

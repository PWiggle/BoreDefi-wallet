import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { ProtectedReauth } from '../components/ProtectedReauth';
import { Screen } from '../components/Screen';
import { WarningBanner } from '../components/WarningBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { parseTokenAmount } from '../wallet/format';
import { fetchUsdPrices } from '../wallet/markets';
import { checkSwapPrice } from '../wallet/swap-guard';
import { bpsLabel, JUPITER_REFERRAL_FEE_BPS } from '../wallet/swap-config';
import { checkPriceImpact } from '../wallet/swap-summary';
import { explorerTxUrl, SOLANA_CLUSTER } from '../wallet/solana/config';
import { solanaKeypairFromMnemonic, signSolanaMessage } from '../wallet/solana/derive';
import { formatSolanaAmount } from '../wallet/solana/format';
import {
  executeJupiterOrder,
  fetchJupiterOrder,
  jupiterSummaryRows,
  signJupiterOrder,
  WSOL_MINT,
  type JupiterOrder,
} from '../wallet/solana/jupiter';
import { fetchSolanaPortfolio, type SolanaPortfolio } from '../wallet/solana/portfolio';
import { knownSolanaTokens, SOL_DECIMALS, SOL_GECKO_ID } from '../wallet/solana/tokens';
import { useNoScreenCapture } from '../components/useNoScreenCapture';

type Choice = { mint: string; symbol: string; decimals: number; geckoId?: string; balance: bigint | null };

/** Lamports kept back when selling SOL, so the wallet can still pay Solana fees and rent. */
const SOL_FEE_RESERVE = 10_000_000n;

function styles({ colors, card, chip, field, spacing, type }: Theme) {
  return {
    label: type.label,
    input: field,
    meta: type.meta,
    tokenRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    token: chip,
    tokenOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
    tokenText: { color: colors.muted, fontWeight: '700' as const },
    tokenTextOn: { color: colors.accent },
    quote: { ...card, gap: spacing.sm },
    quoteTitle: { color: colors.text, fontWeight: '700' as const, fontSize: 16 },
    row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing.sm },
    rowValue: { color: colors.text, fontWeight: '600' as const, flexShrink: 1, textAlign: 'right' as const },
    backdrop: { backgroundColor: colors.overlay, flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.lg },
    sheet: { ...card, gap: spacing.sm },
  };
}

/** Native Solana swap: Jupiter Ultra (Mevvy's server adds the 0.5% referral fee), signed by this wallet. */
export function SolanaSwapScreen() {
  useNoScreenCapture('solana-swap');
  const { colors } = useTheme();
  const s = useThemedStyles(styles);
  const route = useRoute<RouteProp<MainStackParamList, 'SolanaSwap'>>();
  const { session, solanaAddress } = useWallet();
  const [portfolio, setPortfolio] = useState<SolanaPortfolio | null>(null);
  const [fromMint, setFromMint] = useState<string>(route.params?.mint ?? WSOL_MINT);
  const [toMint, setToMint] = useState<string>(knownSolanaTokens(SOLANA_CLUSTER)[0]?.mint ?? WSOL_MINT);
  const [amount, setAmount] = useState('');
  const [order, setOrder] = useState<JupiterOrder | null>(null);
  const [orderKey, setOrderKey] = useState<string | null>(null);
  const [priceBlock, setPriceBlock] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!solanaAddress) {
      return;
    }
    fetchSolanaPortfolio(solanaAddress)
      .then(setPortfolio)
      .catch(() => setError('Could not load your Solana balances. Pull to refresh or try again.'));
  }, [solanaAddress, done]);

  const all: Choice[] = useMemo(() => {
    const sol: Choice = { mint: WSOL_MINT, symbol: 'SOL', decimals: SOL_DECIMALS, geckoId: SOL_GECKO_ID, balance: portfolio?.sol ?? null };
    const known = knownSolanaTokens(SOLANA_CLUSTER).map((token) => ({
      mint: token.mint,
      symbol: token.symbol,
      decimals: token.decimals,
      geckoId: token.geckoId,
      balance: portfolio ? (portfolio.tokens.find((row) => row.mint === token.mint)?.amount ?? 0n) : null,
    }));
    return [sol, ...known];
  }, [portfolio]);
  // From: only what the wallet holds (SOL always, for a new wallet).
  const fromChoices = all.filter((choice) => choice.mint === WSOL_MINT || (choice.balance ?? 0n) > 0n);
  const from = all.find((choice) => choice.mint === fromMint) ?? all[0]!;
  const to = all.find((choice) => choice.mint === toMint && choice.mint !== from.mint) ?? all.find((choice) => choice.mint !== from.mint)!;

  if (!session || !solanaAddress) {
    return null;
  }

  let units = 0n;
  try {
    units = amount.trim() ? parseTokenAmount(amount, from.decimals) : 0n;
  } catch {
    units = -1n;
  }
  const spendable = from.balance === null ? null : from.mint === WSOL_MINT ? (from.balance > SOL_FEE_RESERVE ? from.balance - SOL_FEE_RESERVE : 0n) : from.balance;
  const amountProblem =
    units < 0n
      ? 'Enter a valid amount.'
      : units > 0n && spendable !== null && units > spendable
        ? from.mint === WSOL_MINT
          ? 'Not enough SOL. Keep about 0.01 SOL for network fees.'
          : `Not enough ${from.symbol}.`
        : null;
  const key = `${from.mint}:${to.mint}:${units}`;
  const current = order !== null && orderKey === key;
  const impact = checkPriceImpact(order?.priceImpactPct);
  const canReview = current && !busy && !priceBlock && impact.level !== 'block' && !amountProblem;
  const rows = order ? jupiterSummaryRows(order, from, to) : [];

  const getQuote = async () => {
    setError(null);
    setPriceBlock(null);
    setBusy(true);
    try {
      const next = await fetchJupiterOrder({ inputMint: from.mint, outputMint: to.mint, amount: units, taker: solanaAddress });
      const ids = [from.geckoId, to.geckoId].filter((id): id is string => Boolean(id));
      const prices = await fetchUsdPrices(ids).catch(() => ({}) as Record<string, number>);
      const check = checkSwapPrice({
        fromAmount: next.inAmount,
        fromDecimals: from.decimals,
        toAmount: next.outAmount,
        toDecimals: to.decimals,
        fromPriceUsd: from.geckoId ? prices[from.geckoId] ?? null : null,
        toPriceUsd: to.geckoId ? prices[to.geckoId] ?? null : null,
        aggregatorFromUsd: next.inUsd,
        aggregatorToUsd: next.outUsd,
      });
      setPriceBlock(check.ok ? null : check.message);
      setOrder(next);
      setOrderKey(key);
    } catch (err) {
      setOrder(null);
      setOrderKey(null);
      setError(err instanceof Error ? err.message : 'Jupiter could not price this swap.');
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setReauth(false);
    if (!order || !canReview) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const keypair = await solanaKeypairFromMnemonic(session.mnemonic);
      if (keypair.address !== solanaAddress) {
        throw new Error('Wallet key mismatch. Nothing was signed.');
      }
      const signed = signJupiterOrder(order, solanaAddress, (message) => signSolanaMessage(keypair, message));
      const result = await executeJupiterOrder({ order, ...signed });
      setDone(result.signature);
      setOrder(null);
      setOrderKey(null);
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The swap did not go through. Check Activity before you try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen title="Swap sent" subtitle="Solana">
        <Text style={s.meta}>{done}</Text>
        <Button label="View on Solscan" variant="secondary" onPress={() => Linking.openURL(explorerTxUrl(done))} />
        <Button label="New swap" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Swap on Solana"
      subtitle={`Best price via Jupiter, signed by this wallet. BoreDefi fee ${bpsLabel(JUPITER_REFERRAL_FEE_BPS)}.`}
    >
      <ErrorBanner message={error} />
      <Text style={s.label}>From</Text>
      <View style={s.tokenRow}>
        {fromChoices.map((choice) => (
          <Pressable key={choice.mint} onPress={() => { setFromMint(choice.mint); setOrder(null); }} style={[s.token, choice.mint === from.mint && s.tokenOn]}>
            <Text style={[s.tokenText, choice.mint === from.mint && s.tokenTextOn]}>{choice.symbol}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={amount}
        onChangeText={(value) => { setAmount(value); setOrder(null); setOrderKey(null); }}
        keyboardType="decimal-pad"
        style={s.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <Text style={s.meta}>
        Balance {from.balance === null ? '…' : formatSolanaAmount(from.balance, from.decimals)} {from.symbol}
      </Text>
      <Text style={s.label}>To</Text>
      <View style={s.tokenRow}>
        {all.filter((choice) => choice.mint !== from.mint).map((choice) => (
          <Pressable key={choice.mint} onPress={() => { setToMint(choice.mint); setOrder(null); }} style={[s.token, choice.mint === to.mint && s.tokenOn]}>
            <Text style={[s.tokenText, choice.mint === to.mint && s.tokenTextOn]}>{choice.symbol}</Text>
          </Pressable>
        ))}
      </View>
      {amountProblem ? <Text style={s.meta}>{amountProblem}</Text> : null}
      {order && current ? (
        <View style={s.quote}>
          <Text style={s.quoteTitle}>Best route · Jupiter</Text>
          {rows.map((row) => (
            <View key={row.label} style={s.row}>
              <Text style={s.meta}>{row.label}</Text>
              <Text style={s.rowValue}>{row.value}</Text>
            </View>
          ))}
          {priceBlock ? <WarningBanner title="Price check failed" lines={[priceBlock]} danger /> : null}
          {impact.message ? <WarningBanner title="Price impact" lines={[impact.message]} danger={impact.level === 'block'} /> : null}
          <Button label="Review swap" loading={busy} disabled={!canReview} onPress={() => setReview(true)} />
        </View>
      ) : (
        <Button label="Get best quote" loading={busy} disabled={units <= 0n || Boolean(amountProblem)} onPress={getQuote} />
      )}
      <ConfirmSheet
        visible={review && Boolean(order) && canReview}
        title="Confirm swap"
        network={SOLANA_CLUSTER === 'devnet' ? 'Solana devnet' : 'Solana'}
        from={solanaAddress}
        amount={order ? `${amount} ${from.symbol} → ${to.symbol}` : undefined}
        extra={rows}
        warnings={order?.review?.warnings ?? []}
        loading={busy}
        onConfirm={() => { setReview(false); setReauth(true); }}
        onCancel={() => setReview(false)}
      />
      {reauth ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setReauth(false)}>
          <View style={s.backdrop}>
            <ScrollView contentContainerStyle={s.scroll}>
              <View style={s.sheet}>
                <Text style={s.quoteTitle}>Confirm it's you</Text>
                <Text style={s.meta}>Swap {amount} {from.symbol} for {to.symbol}. Nothing is signed until you confirm.</Text>
                <ProtectedReauth reason="Confirm Solana swap" busy={busy} confirmLabel="Swap" onVerified={() => void execute()} />
                <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setReauth(false)} />
              </View>
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}

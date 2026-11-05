import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { formatTokenAmount, formatUsd, parseTokenAmount } from '../wallet/format';
import { fetchMarketDetails, usdValueFromUnits } from '../wallet/markets';
import { checkSolanaRecipient } from '../wallet/solana/address';
import { explorerTxUrl, SOLANA_CLUSTER } from '../wallet/solana/config';
import { fetchSolanaPortfolio, type SolanaPortfolio } from '../wallet/solana/portfolio';
import {
  broadcastAndConfirm,
  formatLamports,
  friendlySolanaError,
  loadSendContext,
  maxSolSendable,
  planSolanaSend,
  signPlan,
  simulatePlanUnsigned,
  type SolanaSendAsset,
  type SolanaSendPlan,
  type SolanaSendOutcome,
} from '../wallet/solana/send';
import { SOL_DECIMALS, SOL_GECKO_ID } from '../wallet/solana/tokens';

function sendStyles({ colors, field, radius, spacing, type }: Theme) {
  return {
    label: type.label,
    input: field,
    meta: type.meta,
    hash: { ...type.meta, color: colors.text },
    hint: { color: colors.text, fontWeight: '600' as const },
    tokenRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    token: {
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    tokenOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    tokenText: { color: colors.text, fontWeight: '700' as const },
    tokenTextOn: { color: colors.accent },
    max: { color: colors.accent, fontWeight: '700' as const },
  };
}

type Choice = { key: string; symbol: string; decimals: number; balance: bigint; asset: SolanaSendAsset };

export function SolanaSendScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(sendStyles);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'SolanaSend'>>();
  const { session, solanaAddress } = useWallet();
  const [portfolio, setPortfolio] = useState<SolanaPortfolio | null>(null);
  const [choiceKey, setChoiceKey] = useState<string>(route.params?.mint ?? 'SOL');
  const [to, setTo] = useState(route.params?.to ?? '');
  const [amount, setAmount] = useState(route.params?.amount ?? '');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<SolanaSendPlan | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<SolanaSendOutcome | null>(null);
  /** SOL "Max": the exact amount is fixed at review time, once the priority fee is known. */
  const [sendMax, setSendMax] = useState(false);

  useEffect(() => {
    if (route.params?.to) setTo(route.params.to);
    if (route.params?.amount) setAmount(route.params.amount);
    if (route.params?.mint) setChoiceKey(route.params.mint);
  }, [route.params]);

  useEffect(() => {
    if (!solanaAddress) return;
    let live = true;
    fetchSolanaPortfolio(solanaAddress)
      .then((next) => live && setPortfolio(next))
      .catch(() => live && setError('Could not load your Solana balance.'));
    fetchMarketDetails([SOL_GECKO_ID])
      .then((rows) => live && setSolPrice(rows[0]?.priceUsd ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [solanaAddress]);

  const choices = useMemo<Choice[]>(() => {
    if (!portfolio) return [];
    return [
      { key: 'SOL', symbol: 'SOL', decimals: SOL_DECIMALS, balance: portfolio.sol, asset: { kind: 'sol' } },
      ...portfolio.tokens.map((row) => ({
        key: row.mint,
        symbol: row.symbol,
        decimals: row.decimals,
        balance: row.amount,
        asset: {
          kind: 'spl' as const,
          mint: row.mint,
          symbol: row.symbol,
          decimals: row.decimals,
          programId: row.programId,
          sourceAccount: row.account,
          balance: row.amount,
        },
      })),
    ];
  }, [portfolio]);
  // No silent fallback: a Solana Pay QR asking for a token you do not hold must never turn into a SOL send.
  const choice = choices.find((item) => item.key === choiceKey);
  const missingToken = Boolean(portfolio) && !choice;

  if (!session || !solanaAddress) {
    return (
      <Screen title="Send" subtitle="Solana">
        <Text style={styles.meta}>Preparing your Solana account…</Text>
      </Screen>
    );
  }

  const keyOf = (units: bigint) => `${choice?.key}:${to.trim()}:${units}`;
  const invalidate = () => {
    setPlan(null);
    setPlanKey(null);
    setReview(false);
  };

  const prepare = async () => {
    setError(null);
    if (!choice || !portfolio) {
      setError('Balance is still loading.');
      return;
    }
    const recipient = checkSolanaRecipient(to, solanaAddress);
    if (!recipient.ok) {
      setError(recipient.message);
      return;
    }
    let units = 0n;
    const maxSol = sendMax && choice.asset.kind === 'sol';
    if (!maxSol) {
      try {
        units = parseTokenAmount(amount, choice.decimals);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid amount.');
        return;
      }
    }
    setPreparing(true);
    try {
      const ctx = await loadSendContext(solanaAddress, recipient.address, choice.asset);
      if (maxSol) {
        units = maxSolSendable(portfolio.sol, ctx.priorityMicroLamports);
        setAmount(formatTokenAmount(units, SOL_DECIMALS, SOL_DECIMALS));
      }
      const result = planSolanaSend({ from: solanaAddress, to: recipient.address, amount: units, asset: choice.asset, solBalance: portfolio.sol, ...ctx });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Simulate the exact (unsigned) transaction before showing the confirmation sheet.
      const simulation = await simulatePlanUnsigned(solanaAddress, result.plan);
      if (simulation.err) {
        setError(friendlySolanaError(simulation.err, simulation.logs));
        return;
      }
      const clipboard = await Clipboard.getStringAsync().catch(() => '');
      const extra: string[] = [...result.plan.warnings];
      if (clipboard.trim() && checkSolanaRecipient(clipboard).ok && clipboard.trim() !== recipient.address) {
        extra.push('Clipboard address does not match the address you entered.');
      }
      extra.push('Solana addresses have no checksum. Check the first and last characters match.');
      setWarnings(extra);
      setPlan(result.plan);
      setPlanKey(keyOf(units));
      setSendMax(false);
      setReview(true);
    } catch (err) {
      setError(err instanceof Error && /Not enough|Leave at least/.test(err.message) ? err.message : 'Could not reach the Solana network. Try again.');
    } finally {
      setPreparing(false);
    }
  };

  const confirm = async () => {
    if (!plan || !choice) return;
    setBusy(true);
    setError(null);
    try {
      const units = parseTokenAmount(amount, choice.decimals);
      if (planKey !== keyOf(units)) {
        throw new Error('The send changed. Review it again.');
      }
      // Fresh blockhash at confirm time; simulation runs again inside broadcastAndConfirm.
      const signed = await signPlan(session.mnemonic, solanaAddress, plan);
      const result = await broadcastAndConfirm(signed);
      setReview(false);
      setOutcome(result);
    } catch (err) {
      setReview(false);
      setError(err instanceof Error ? err.message : 'Send failed. Nothing left this wallet.');
    } finally {
      setBusy(false);
    }
  };

  if (outcome) {
    return (
      <Screen title={outcome.status === 'confirmed' ? 'Sent' : 'Submitted'} subtitle="Solana">
        <Text style={styles.hint}>
          {outcome.status === 'confirmed'
            ? 'Confirmed on the Solana network.'
            : 'Sent to the network and still confirming. Check Solscan in a minute before sending again.'}
        </Text>
        <Text style={styles.hash} selectable>
          {outcome.signature}
        </Text>
        <Button label="View on Solscan" variant="secondary" onPress={() => Linking.openURL(explorerTxUrl(outcome.signature))} />
        <Button label="Done" onPress={() => navigation.navigate('Tabs', { screen: 'Wallet' })} />
      </Screen>
    );
  }

  const symbol = choice?.symbol ?? 'SOL';
  const feeLine = plan
    ? `${formatLamports(plan.feeLamports)} SOL${solPrice ? ` (${formatUsd(usdValueFromUnits(plan.feeLamports, SOL_DECIMALS, solPrice))})` : ''}`
    : '—';
  const extraRows = plan
    ? [
        ...(plan.rentLamports > 0n ? [{ label: 'New token account (one-time)', value: `${formatLamports(plan.rentLamports)} SOL` }] : []),
        ...(choice?.asset.kind === 'spl' ? [{ label: 'Token mint', value: choice.asset.mint }] : []),
      ]
    : undefined;

  return (
    <Screen title={`Send ${symbol}`} subtitle={SOLANA_CLUSTER === 'devnet' ? 'Solana devnet' : 'Solana'}>
      <ErrorBanner message={error} />
      <ErrorBanner message={missingToken ? 'This request is for a token this wallet does not hold. Pick what to send.' : null} />
      <View style={styles.tokenRow}>
        {choices.map((item) => {
          const on = item.key === choice?.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                setChoiceKey(item.key);
                setSendMax(false);
                invalidate();
              }}
              style={[styles.token, on && styles.tokenOn]}
            >
              <Text style={[styles.tokenText, on && styles.tokenTextOn]}>{item.symbol}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>To (Solana address)</Text>
      <TextInput
        value={to}
        onChangeText={(value) => {
          setTo(value);
          invalidate();
        }}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="Solana address"
        placeholderTextColor={colors.muted}
      />
      <Button label="Scan QR" variant="secondary" onPress={() => navigation.navigate('ScanQr', { purpose: 'solana' })} />
      <Text style={styles.label}>Amount ({symbol})</Text>
      <TextInput
        value={amount}
        onChangeText={(value) => {
          setAmount(value);
          setSendMax(false);
          invalidate();
        }}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="0.0"
        placeholderTextColor={colors.muted}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.meta}>
          Balance: {choice ? formatTokenAmount(choice.balance, choice.decimals) : '—'} {symbol}
        </Text>
        {choice ? (
          <Pressable
            onPress={() => {
              const units = choice.asset.kind === 'sol' ? maxSolSendable(choice.balance, 0n) : choice.balance;
              setAmount(formatTokenAmount(units, choice.decimals, choice.decimals));
              invalidate();
              setSendMax(choice.asset.kind === 'sol');
            }}
          >
            <Text style={styles.max}>Max</Text>
          </Pressable>
        ) : null}
      </View>
      <Button label={preparing ? 'Checking…' : 'Review'} onPress={prepare} loading={preparing} disabled={preparing || !choice} />
      <ConfirmSheet
        visible={review}
        title="Confirm Solana send"
        network={SOLANA_CLUSTER === 'devnet' ? 'Solana devnet' : 'Solana'}
        from={solanaAddress}
        to={to.trim()}
        amount={`${amount} ${symbol}`}
        fee={feeLine}
        feeDetail={plan ? `Base 0.000005 SOL + priority ${plan.priorityMicroLamports} µlamports/CU × ${plan.computeUnitLimit} CU` : undefined}
        extra={extraRows}
        warnings={warnings}
        loading={busy}
        onConfirm={confirm}
        onCancel={() => setReview(false)}
      />
    </Screen>
  );
}

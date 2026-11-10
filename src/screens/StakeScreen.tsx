import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { Button } from '../components/Button';
import { ChainPicker } from '../components/ChainPicker';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import type { MainStackParamList } from '../navigation';
import { formatTokenAmount, parseTokenAmount } from '../wallet/format';
import { fetchBalance, fetchMaxFeePerGas, retryRead } from '../wallet/rpc';
import { friendlyTxError } from '../wallet/tx-errors';
import { preflightLine, type PreflightResult } from '../wallet/preflight';
import {
  checkStakeScreenPreflight,
  claimLidoRequests,
  fetchStakedBalance,
  listLidoRequests,
  listStakeMarkets,
  positionText,
  stake,
  unstake,
  type BalanceStatus,
  type StakeAction,
  type StakeMarket,
  type WithdrawalRequest,
} from '../wallet/stake';
import { fetchTokenBalance } from '../wallet/swap';

function safeAmount(value: string, decimals: number): bigint {
  try {
    return value.trim() ? parseTokenAmount(value, decimals) : 0n;
  } catch {
    return -1n;
  }
}

function stakeStyles({ colors, card, chip, field, spacing }: Theme) {
  return {
    copy: { color: colors.muted },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
    meta: { color: colors.muted },
    input: field,
    actions: { gap: spacing.sm },
    box: {
      ...card,
      gap: spacing.sm,
    },
    boxTitle: { color: colors.text, fontWeight: '700' as const },
    hash: { color: colors.accent },
    hint: { color: colors.text, fontWeight: '600' as const },
    positionRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, flexWrap: 'wrap' as const },
    retry: { color: colors.accent, fontWeight: '700' as const },
  };
}

export function StakeScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(stakeStyles);
  const route = useRoute<RouteProp<MainStackParamList, 'Stake'>>();
  const { session, selectedChain, setSelectedChain } = useWallet();
  const markets = useMemo(
    () => listStakeMarkets().filter((item) => item.chainId === selectedChain.id),
    [selectedChain.id],
  );
  const hinted = route.params?.marketId
    ? listStakeMarkets().find((item) => item.id === route.params.marketId)
    : undefined;
  const [market, setMarket] = useState<StakeMarket | undefined>(hinted ?? markets[0]);
  const [amount, setAmount] = useState('');
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletStatus, setWalletStatus] = useState<BalanceStatus>('loading');
  const [stakedBalance, setStakedBalance] = useState<bigint | null>(null);
  const [positionStatus, setPositionStatus] = useState<BalanceStatus>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'stake' | 'unstake' | 'claim' | null>(null);

  useEffect(() => {
    if (route.params?.marketId) {
      const found = listStakeMarkets().find((item) => item.id === route.params.marketId);
      if (found) {
        if (found.chainId !== selectedChain.id) {
          void setSelectedChain(found.chainId);
        }
        setMarket(found);
        return;
      }
    }
    const next = listStakeMarkets().filter((item) => item.chainId === selectedChain.id);
    setMarket(next[0]);
    setAmount('');
    setTxHash(null);
    setRequests([]);
  }, [route.params?.marketId, selectedChain.id, setSelectedChain]);

  useEffect(() => {
    if (!session || !market) {
      return;
    }
    // A read error belongs to the market it came from. Clear it so it never sticks to another chain.
    let active = true;
    setError(null);
    setWalletBalance(null);
    setWalletStatus('loading');
    setStakedBalance(null);
    setPositionStatus('loading');
    setNativeBalance(null);
    setMaxFeePerGas(null);
    retryRead(() => fetchTokenBalance(session.address, market.asset, market.chainId))
      .then((value) => {
        if (active) {
          setWalletBalance(value);
          setWalletStatus('ok');
        }
      })
      .catch(() => {
        if (active) {
          setWalletStatus('unknown');
        }
      });
    retryRead(() => fetchStakedBalance(market, session.address))
      .then((value) => {
        if (active) {
          setStakedBalance(value);
          setPositionStatus('ok');
        }
      })
      .catch(() => {
        if (active) {
          setPositionStatus('unknown');
        }
      });
    fetchBalance(session.address, market.chainId)
      .then((value) => active && setNativeBalance(value))
      .catch(() => active && setNativeBalance(null));
    fetchMaxFeePerGas(market.chainId)
      .then((value) => active && setMaxFeePerGas(value))
      .catch(() => active && setMaxFeePerGas(null));
    if (market.protocol === 'lido') {
      listLidoRequests(session.address)
        .then((value) => active && setRequests(value))
        .catch(() => active && setRequests([]));
    }
    return () => {
      active = false;
    };
  }, [market, session, reloadKey]);

  useEffect(() => {
    if (positionStatus !== 'unknown' && walletStatus !== 'unknown') {
      return;
    }
    // Quiet background retry while the screen is open; no red banner for a read that may recover.
    const timer = setTimeout(() => setReloadKey((key) => key + 1), 15_000);
    return () => clearTimeout(timer);
  }, [positionStatus, walletStatus]);

  if (!session) {
    return null;
  }

  if (!market) {
    return (
      <Screen title="Stake" subtitle={selectedChain.name}>
        <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
        <Text style={styles.copy}>
          No stake markets on {selectedChain.name}. Switch to Ethereum for Lido ETH, or Ethereum /
          Base / Arbitrum / Optimism / Polygon / Avalanche for Aave V3 USDC.
        </Text>
      </Screen>
    );
  }

  const amountUnits = safeAmount(amount, market.asset.decimals);
  const check = (action: StakeAction): PreflightResult =>
    checkStakeScreenPreflight({
      market,
      action,
      amount: amountUnits,
      walletBalance,
      positionBalance: stakedBalance,
      nativeBalance,
      maxFeePerGas,
    });
  const stakeCheck = check('stake');
  const unstakeCheck = check('unstake');
  const claimCheck = check('claim');
  const hint = preflightLine([stakeCheck, unstakeCheck], amount.trim().length > 0);

  const run = async (action: 'stake' | 'unstake' | 'claim') => {
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'claim'
          ? await claimLidoRequests(session.mnemonic, session.address)
          : action === 'stake'
            ? await stake({
                mnemonic: session.mnemonic,
                market,
                owner: session.address,
                amount: parseTokenAmount(amount, market.asset.decimals),
              })
            : await unstake({
                mnemonic: session.mnemonic,
                market,
                owner: session.address,
                amount: parseTokenAmount(amount, market.asset.decimals),
              });
      setPendingAction(null);
      setTxHash(result.hash);
    } catch (err) {
      setError(friendlyTxError(err, { chainId: market.chainId, fallback: 'Stake action failed. Nothing was sent.' }));
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Stake" subtitle={selectedChain.name}>
      <Text style={styles.copy}>
        Lido ETH on Ethereum (withdrawal queue) and Aave V3 USDC supply on supported L2s. Keys stay
        on device.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <ChainPicker selected={selectedChain.id} onSelect={setSelectedChain} />
      <View style={styles.row}>
        {markets.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setMarket(item)}
            style={[styles.chip, market.id === item.id && styles.chipOn]}
          >
            <Text style={styles.chipText}>{item.title}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.copy}>{market.subtitle}</Text>
      <Text style={styles.meta}>
        Wallet {market.asset.symbol}:{' '}
        {walletStatus === 'ok' && walletBalance !== null
          ? formatTokenAmount(walletBalance, market.asset.decimals)
          : walletStatus === 'loading'
            ? 'checking…'
            : "couldn't check right now"}
      </Text>
      <View style={styles.positionRow}>
        <Text style={styles.meta}>{positionText(market, positionStatus, stakedBalance)}</Text>
        {positionStatus === 'unknown' || walletStatus === 'unknown' ? (
          <Pressable onPress={() => setReloadKey((key) => key + 1)} hitSlop={8}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder={`Amount (${market.asset.symbol})`}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Button
          label={market.protocol === 'aave-v3' ? 'Supply' : 'Stake'}
          onPress={() => setPendingAction('stake')}
          loading={busy}
          disabled={!stakeCheck.ok}
        />
        <Button
          label={market.protocol === 'aave-v3' ? 'Withdraw' : 'Unstake'}
          variant="secondary"
          onPress={() => setPendingAction('unstake')}
          loading={busy}
          disabled={!unstakeCheck.ok}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {market.protocol === 'lido' && requests.length > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Lido withdrawal queue</Text>
          {requests.map((item) => (
            <Text key={item.id.toString()} style={styles.meta}>
              #{item.id.toString()} · {formatTokenAmount(item.amount, 18)} stETH ·{' '}
              {item.claimed ? 'claimed' : item.finalized ? 'ready to claim' : 'pending'}
            </Text>
          ))}
          <Button
            label="Claim finalized"
            onPress={() => setPendingAction('claim')}
            loading={busy}
            disabled={!requests.some((item) => item.finalized && !item.claimed) || !claimCheck.ok}
          />
        </View>
      ) : null}
      {txHash ? <Text style={styles.hash}>Submitted {txHash}</Text> : null}
      <ConfirmSheet
        visible={pendingAction !== null}
        title={
          pendingAction === 'claim'
            ? 'Confirm claim'
            : pendingAction === 'unstake'
              ? 'Confirm unstake'
              : 'Confirm stake'
        }
        network={selectedChain.name}
        from={session.address}
        to={market.title}
        amount={
          pendingAction === 'claim'
            ? 'Finalized Lido withdrawals'
            : `${amount || '0'} ${market.asset.symbol}`
        }
        fee="Network gas (quoted at broadcast)"
        extra={[{ label: 'Protocol', value: market.protocol === 'lido' ? 'Lido' : 'Aave V3' }]}
        loading={busy}
        onConfirm={() => pendingAction && run(pendingAction)}
        onCancel={() => setPendingAction(null)}
      />
    </Screen>
  );
}

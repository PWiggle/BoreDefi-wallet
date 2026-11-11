import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { addressesForRegistration, createAlertsClient, parsePriceInput, type AlertsClient } from '../wallet/alerts/client';
import { ALERTS_API_URL, ALERTS_ENABLED, PRICE_CHECK_MINUTES } from '../wallet/alerts/config';
import { forgetDeviceCredentials, getDeviceCredentials, loadAlertPrefs, saveAlertPrefs, type AlertPrefs } from '../wallet/alerts/device';
import { configureNotifications, requestPushToken } from '../wallet/alerts/push';
import { formatAlertUsd, MAX_ALERTS_PER_DEVICE, type PriceAlert, type PriceDirection } from '../wallet/alerts/shared';
import { fetchWalletUsdPrices, searchMarkets, type MarketCoin } from '../wallet/markets';

function styles({ colors, card, field, chip, spacing, type }: Theme) {
  return {
    card: { ...card, gap: spacing.sm },
    row: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: spacing.md, justifyContent: 'space-between' as const },
    copy: { flex: 1, gap: 4 },
    label: { color: colors.text, fontWeight: '700' as const },
    help: type.meta,
    section: { ...type.label, marginTop: spacing.sm },
    error: { color: colors.danger, fontSize: 13 },
    field: { ...field },
    chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    chip: { ...chip },
    chipOn: { borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
    alertRow: { alignItems: 'center' as const, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row' as const, gap: spacing.sm, paddingVertical: 8 },
    alertText: { color: colors.text, flex: 1, fontSize: 15 },
    remove: { color: colors.danger, fontWeight: '700' as const },
    result: { paddingVertical: 8 },
  };
}

function alertLine(alert: PriceAlert): string {
  const verb = alert.direction === 'above' ? 'rises above' : 'falls below';
  return `${alert.symbol} ${verb} ${formatAlertUsd(alert.targetUsd)}`;
}

export function NotificationsScreen() {
  const s = useThemedStyles(styles);
  const { colors } = useTheme();
  const { address, solanaAddress } = useWallet();
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [client, setClient] = useState<AlertsClient | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketCoin[]>([]);
  const [coin, setCoin] = useState<MarketCoin | null>(null);
  const [coinPrice, setCoinPrice] = useState<number | null>(null);
  const [direction, setDirection] = useState<PriceDirection>('above');
  const [priceText, setPriceText] = useState('');
  const searchSeq = useRef(0);

  useEffect(() => {
    configureNotifications();
    void loadAlertPrefs().then(setPrefs);
    void getDeviceCredentials().then((credentials) => setClient(createAlertsClient({ baseUrl: ALERTS_API_URL, credentials })));
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !prefs?.notificationsOn) return;
    try {
      setAlerts(await client.listAlerts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load alerts.');
    }
  }, [client, prefs?.notificationsOn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** (Re)registers this phone: push token + toggle + public addresses only. */
  const register = useCallback(
    async (next: AlertPrefs) => {
      if (!client) return false;
      const token = await requestPushToken();
      if (!token.ok) {
        setError(token.message);
        return false;
      }
      await client.register({
        pushToken: token.token,
        platform: token.platform,
        incomingEnabled: next.incomingEnabled,
        ...addressesForRegistration(next.incomingEnabled, address, solanaAddress),
      });
      return true;
    },
    [address, client, solanaAddress],
  );

  const apply = useCallback(
    async (next: AlertPrefs) => {
      setBusy(true);
      setError(null);
      try {
        if (next.notificationsOn) {
          if (!(await register(next))) return;
        } else if (client) {
          await client.unregister().catch(() => undefined);
          await forgetDeviceCredentials();
          setClient(createAlertsClient({ baseUrl: ALERTS_API_URL, credentials: await getDeviceCredentials() }));
          setAlerts([]);
        }
        setPrefs(next);
        await saveAlertPrefs(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update notifications.');
      } finally {
        setBusy(false);
      }
    },
    [client, register],
  );

  // Keep the server's address list current if the wallet address changes (e.g. after import).
  useEffect(() => {
    if (prefs?.notificationsOn && client) {
      void register(prefs).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, solanaAddress, client]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || coin?.symbol === trimmed.toUpperCase()) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      searchMarkets(trimmed)
        .then((list) => seq === searchSeq.current && setResults(list.slice(0, 6)))
        .catch(() => seq === searchSeq.current && setResults([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [coin?.symbol, query]);

  const pick = useCallback((picked: MarketCoin) => {
    setCoin(picked);
    setQuery(picked.symbol);
    setResults([]);
    setCoinPrice(null);
    fetchWalletUsdPrices([picked.id])
      .then((prices) => setCoinPrice(prices[picked.id] ?? null))
      .catch(() => setCoinPrice(null));
  }, []);

  const target = parsePriceInput(priceText);
  const active = useMemo(() => alerts.filter((a) => a.active), [alerts]);
  const fired = useMemo(() => alerts.filter((a) => !a.active), [alerts]);

  const addAlert = useCallback(async () => {
    if (!client || !coin || target === null) return;
    setBusy(true);
    setError(null);
    try {
      await client.createAlert({ coinId: coin.id, symbol: coin.symbol, direction, targetUsd: target });
      setPriceText('');
      setCoin(null);
      setQuery('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the alert.');
    } finally {
      setBusy(false);
    }
  }, [client, coin, direction, refresh, target]);

  const removeAlert = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        await client.deleteAlert(id);
        setAlerts((list) => list.filter((a) => a.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete the alert.');
      }
    },
    [client],
  );

  if (!ALERTS_ENABLED) {
    return (
      <Screen title="Notifications" subtitle="Coming soon.">
        <Text style={s.help}>The alerts server is not switched on for this build yet.</Text>
      </Screen>
    );
  }

  if (!prefs) {
    return (
      <Screen title="Notifications">
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  return (
    <Screen title="Notifications" subtitle="Alerts on this phone, even when BoreDefi is closed.">
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.copy}>
            <Text style={s.label}>Push notifications</Text>
            <Text style={s.help}>
              Shares only this phone's notification token and your public wallet address with BoreDefi's alerts server. Never your recovery phrase, keys, or PIN.
            </Text>
          </View>
          <Switch
            value={prefs.notificationsOn}
            disabled={busy}
            onValueChange={(on) => void apply({ ...prefs, notificationsOn: on })}
            trackColor={{ true: colors.accentDim, false: colors.border }}
            thumbColor={prefs.notificationsOn ? colors.accent : colors.muted}
          />
        </View>
        {prefs.notificationsOn ? (
          <View style={s.row}>
            <View style={s.copy}>
              <Text style={s.label}>Incoming funds and swaps</Text>
              <Text style={s.help}>"You received 0.5 ETH", "Swap finished". All 8 EVM networks and Solana.</Text>
            </View>
            <Switch
              value={prefs.incomingEnabled}
              disabled={busy}
              onValueChange={(on) => void apply({ ...prefs, incomingEnabled: on })}
              trackColor={{ true: colors.accentDim, false: colors.border }}
              thumbColor={prefs.incomingEnabled ? colors.accent : colors.muted}
            />
          </View>
        ) : null}
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>

      {prefs.notificationsOn ? (
        <>
          <Text style={s.section}>Price alerts</Text>
          <View style={s.card}>
            <TextInput
              style={s.field}
              placeholder="Coin, e.g. ETH or SOL"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                if (coin && text.toUpperCase() !== coin.symbol) setCoin(null);
              }}
            />
            {results.map((item) => (
              <Pressable key={item.id} style={s.result} onPress={() => pick(item)} accessibilityRole="button">
                <Text style={s.alertText}>{`${item.symbol} · ${item.name}`}</Text>
              </Pressable>
            ))}
            {coin ? (
              <Text style={s.help}>{`${coin.name} now ${coinPrice !== null ? formatAlertUsd(coinPrice) : '…'} (BoreDash)`}</Text>
            ) : null}
            <View style={s.chips}>
              {(['above', 'below'] as const).map((value) => (
                <Pressable key={value} onPress={() => setDirection(value)} style={[s.chip, direction === value && s.chipOn]} accessibilityRole="button">
                  <Text style={s.chipText}>{value === 'above' ? 'Goes above' : 'Goes below'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={s.field}
              placeholder="Price in USD"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={priceText}
              onChangeText={setPriceText}
            />
            <Button
              label="Add price alert"
              disabled={busy || !coin || target === null || active.length >= MAX_ALERTS_PER_DEVICE}
              onPress={() => void addAlert()}
            />
            <Text style={s.help}>
              {`Prices from BoreDash, checked every ${PRICE_CHECK_MINUTES} minutes, so an alert can arrive a few minutes late. Each alert fires once, then switches off. Up to ${MAX_ALERTS_PER_DEVICE}.`}
            </Text>
          </View>

          {active.length > 0 ? <Text style={s.section}>Waiting</Text> : null}
          {active.length > 0 ? (
            <View style={s.card}>
              {active.map((alert) => (
                <View key={alert.id} style={s.alertRow}>
                  <Text style={s.alertText}>{alertLine(alert)}</Text>
                  <Pressable onPress={() => void removeAlert(alert.id)} accessibilityRole="button">
                    <Text style={s.remove}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {fired.length > 0 ? <Text style={s.section}>Already sent</Text> : null}
          {fired.length > 0 ? (
            <View style={s.card}>
              {fired.map((alert) => (
                <View key={alert.id} style={s.alertRow}>
                  <Text style={[s.alertText, { color: colors.muted }]}>{alertLine(alert)}</Text>
                  <Pressable onPress={() => void removeAlert(alert.id)} accessibilityRole="button">
                    <Text style={s.remove}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

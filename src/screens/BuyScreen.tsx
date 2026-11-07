import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { ONRAMP_APP_TOKEN, ONRAMP_ENDPOINT } from '../wallet/onramp/config';
import { openStripeHostedOnramp } from '../wallet/onramp/open';
import { assetChoices, offersForAsset, offersForWallet, initialOffer, type OnrampOffer } from '../wallet/onramp/offers';
import { buildOnrampSessionRequest, postOnrampSession } from '../wallet/onramp/request';
import { SOLANA_ENABLED } from '../wallet/solana/config';

function buyStyles({ colors, card, chip, spacing, type }: Theme) {
  return {
    copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    label: { color: colors.text, fontWeight: '700' as const },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '700' as const },
    box: { ...card, gap: spacing.sm },
    note: { color: colors.text, fontSize: 15, lineHeight: 22 },
    address: type.body,
    meta: type.meta,
    link: { color: colors.accent, fontWeight: '700' as const },
  };
}

export function BuyScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(buyStyles);
  const { session, solanaAddress, selectedChain } = useWallet();
  const offers = useMemo(() => offersForWallet(SOLANA_ENABLED), []);
  const [offerId, setOfferId] = useState(() => initialOffer(offers, selectedChain.id).id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const offer: OnrampOffer = offers.find((item) => item.id === offerId) ?? offers[0]!;
  const assets = assetChoices(offers);
  const networks = offersForAsset(offers, offer.asset);
  const built = buildOnrampSessionRequest({
    offerId: offer.id,
    evmAddress: session?.address,
    solanaAddress,
  });

  const selectAsset = (asset: string) => {
    const next = offersForAsset(offers, asset);
    const keep = next.find((item) => item.network === offer.network);
    const picked = keep ?? next[0];
    if (picked) {
      setOfferId(picked.id);
    }
    setError(null);
  };

  const copy = async () => {
    if (!built.ok) {
      return;
    }
    await Clipboard.setStringAsync(built.body.wallet_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const start = async () => {
    if (!ONRAMP_ENDPOINT) {
      setError('Set EXPO_PUBLIC_ONRAMP_URL to the test onramp endpoint and rebuild.');
      return;
    }
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postOnrampSession({
        endpoint: ONRAMP_ENDPOINT,
        body: built.body,
        appToken: ONRAMP_APP_TOKEN,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await openStripeHostedOnramp(result.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Stripe.');
    } finally {
      setBusy(false);
    }
  };

  if (!session || !offer) {
    return null;
  }

  const addressText = built.ok ? built.body.wallet_address : null;

  return (
    <Screen
      title="Buy crypto"
      subtitle="Card to crypto"
      footer={
        <Button
          label="Continue with Stripe"
          onPress={start}
          loading={busy}
          disabled={busy || !built.ok || !ONRAMP_ENDPOINT}
        />
      }
    >
      <View style={styles.box}>
        <Text style={styles.note}>Powered by Stripe.</Text>
        <Text style={styles.copy}>
          Stripe is the merchant of record and handles the card payment and identity checks. BoreDefi does not charge a fee. Any Stripe fee is shown before you pay.
        </Text>
      </View>
      <Text style={styles.label}>Asset</Text>
      <View style={styles.row}>
        {assets.map((asset) => {
          const selected = asset === offer.asset;
          return (
            <Pressable
              key={asset}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={busy}
              onPress={() => selectAsset(asset)}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={styles.chipText}>{asset}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>Network</Text>
      <View style={styles.row}>
        {networks.map((item) => {
          const selected = item.id === offer.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={busy}
              onPress={() => {
                setOfferId(item.id);
                setError(null);
              }}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={styles.chipText}>{item.networkLabel}</Text>
            </Pressable>
          );
        })}
      </View>
      {offer.detail ? <Text style={styles.meta}>{offer.detail}</Text> : null}
      <View style={styles.box}>
        <Text style={styles.label}>
          Receiving address · {offer.asset} on {offer.networkLabel}
        </Text>
        <Text selectable style={[styles.address, { color: colors.text }]}>
          {addressText ?? 'Address not ready'}
        </Text>
        {addressText ? (
          <Pressable accessibilityRole="button" onPress={copy}>
            <Text style={styles.link}>{copied ? 'Copied' : 'Copy address'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.meta}>
          Only this public address is sent. Your recovery phrase and private keys stay on this device. Stripe locks the
          address so the purchase cannot be redirected.
        </Text>
      </View>
      <Text style={styles.meta}>
        Checkout opens in the secure browser tab Stripe uses for card payments. When you come back, pull to refresh.
        Crypto arrives on-chain after Stripe finishes. Nothing is charged by BoreDefi.
      </Text>
      {!ONRAMP_ENDPOINT ? (
        <Text style={styles.meta}>This build has no onramp endpoint yet. Set EXPO_PUBLIC_ONRAMP_URL to the test server and rebuild.</Text>
      ) : null}
      <ErrorBanner message={error ?? (built.ok ? null : built.error)} />
    </Screen>
  );
}

import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { useWallet } from '../context/WalletContext';
import { ONRAMP_APP_TOKEN, ONRAMP_ENDPOINT, ONRAMP_VERCEL_BYPASS, STRIPE_BUY_AVAILABLE } from '../wallet/onramp/config';
import { openStripeHostedOnramp, openTransakHostedWidget } from '../wallet/onramp/open';
import { assetChoices, offersForAsset, offersForWallet, initialOffer, type OnrampOffer } from '../wallet/onramp/offers';
import { buildOnrampSessionRequest, postOnrampSession } from '../wallet/onramp/request';
import { TRANSAK_BUY_AVAILABLE, TRANSAK_WIDGET_ENDPOINT, buildTransakWidgetRequest, postTransakWidgetUrl } from '../wallet/onramp/transak';
import { SOLANA_ENABLED } from '../wallet/solana/config';

type BuyProvider = 'stripe' | 'transak';

function buyStyles({ colors, card, chip, spacing, type }: Theme) {
  return {
    copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    label: { color: colors.text, fontWeight: '700' as const },
    row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    chip,
    chipOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    chipOff: { opacity: 0.45 },
    chipText: { color: colors.text, fontWeight: '700' as const },
    box: { ...card, gap: spacing.sm },
    note: { color: colors.text, fontSize: 15, lineHeight: 22 },
    address: type.body,
    meta: type.meta,
    link: { color: colors.accent, fontWeight: '700' as const },
  };
}

function initialProvider(): BuyProvider {
  if (STRIPE_BUY_AVAILABLE) {
    return 'stripe';
  }
  return 'transak';
}

export function BuyScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(buyStyles);
  const { session, solanaAddress, selectedChain } = useWallet();
  const offers = useMemo(() => offersForWallet(SOLANA_ENABLED), []);
  const [offerId, setOfferId] = useState(() => initialOffer(offers, selectedChain.id).id);
  const [provider, setProvider] = useState<BuyProvider>(initialProvider);
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
  const providerReady = provider === 'stripe' ? STRIPE_BUY_AVAILABLE : TRANSAK_BUY_AVAILABLE;
  const canStart = Boolean(built.ok && providerReady);

  const selectAsset = (asset: string) => {
    const next = offersForAsset(offers, asset);
    const keep = next.find((item) => item.network === offer.network);
    const picked = keep ?? next[0];
    if (picked) {
      setOfferId(picked.id);
    }
    setError(null);
  };

  const selectProvider = (next: BuyProvider) => {
    if (next === 'stripe' && !STRIPE_BUY_AVAILABLE) {
      return;
    }
    if (next === 'transak' && !TRANSAK_BUY_AVAILABLE) {
      return;
    }
    setProvider(next);
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

  const startStripe = async () => {
    if (!ONRAMP_ENDPOINT) {
      setError('Set EXPO_PUBLIC_ONRAMP_URL to the test onramp endpoint and rebuild.');
      return;
    }
    if (!built.ok) {
      setError(built.error);
      return;
    }
    const result = await postOnrampSession({
      endpoint: ONRAMP_ENDPOINT,
      body: built.body,
      appToken: ONRAMP_APP_TOKEN,
      vercelBypass: ONRAMP_VERCEL_BYPASS,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await openStripeHostedOnramp(result.redirectUrl);
  };

  const startTransak = async () => {
    if (!TRANSAK_WIDGET_ENDPOINT) {
      setError('Set EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT to the Transak widget server and rebuild.');
      return;
    }
    const request = buildTransakWidgetRequest({
      offerId: offer.id,
      evmAddress: session?.address,
      solanaAddress,
    });
    if (!request.ok) {
      setError(request.error);
      return;
    }
    const widget = await postTransakWidgetUrl({
      endpoint: TRANSAK_WIDGET_ENDPOINT,
      body: request.body,
    });
    if (!widget.ok) {
      setError(widget.error);
      return;
    }
    await openTransakHostedWidget(widget.widgetUrl);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (provider === 'transak') {
        await startTransak();
      } else {
        await startStripe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : provider === 'transak' ? 'Could not open Transak.' : 'Could not open Stripe.');
    } finally {
      setBusy(false);
    }
  };

  if (!session || !offer) {
    return null;
  }

  const addressText = built.ok ? built.body.wallet_address : null;
  const usingTransak = provider === 'transak';
  const showStripeDetail = !usingTransak && Boolean(offer.detail);

  return (
    <Screen
      title="Buy crypto"
      subtitle="Card to crypto"
      footer={
        <Button
          label={usingTransak ? 'Continue with Transak' : 'Continue with Stripe'}
          onPress={start}
          loading={busy}
          disabled={busy || !canStart}
        />
      }
    >
      <View style={styles.box}>
        <Text style={styles.note}>{usingTransak ? 'Powered by Transak.' : 'Powered by Stripe.'}</Text>
        <Text style={styles.copy}>
          {usingTransak
            ? 'Transak is the merchant of record and handles the card or bank payment and identity checks. BoreDefi does not charge a fee. Any Transak fee is shown before you pay.'
            : 'Stripe is the merchant of record and handles the card payment and identity checks. BoreDefi does not charge a fee. Any Stripe fee is shown before you pay.'}
        </Text>
      </View>
      <Text style={styles.label}>Pay with</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: provider === 'stripe', disabled: !STRIPE_BUY_AVAILABLE }}
          disabled={busy || !STRIPE_BUY_AVAILABLE}
          onPress={() => selectProvider('stripe')}
          style={[styles.chip, provider === 'stripe' && styles.chipOn, !STRIPE_BUY_AVAILABLE && styles.chipOff]}
        >
          <Text style={styles.chipText}>Stripe</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: provider === 'transak', disabled: !TRANSAK_BUY_AVAILABLE }}
          disabled={busy || !TRANSAK_BUY_AVAILABLE}
          onPress={() => selectProvider('transak')}
          style={[styles.chip, provider === 'transak' && styles.chipOn, !TRANSAK_BUY_AVAILABLE && styles.chipOff]}
        >
          <Text style={styles.chipText}>Transak</Text>
        </Pressable>
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
      {showStripeDetail ? <Text style={styles.meta}>{offer.detail}</Text> : null}
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
          {usingTransak
            ? 'Only this public address is sent. Your recovery phrase and private keys stay on this device. The address is locked in Transak so the purchase cannot be redirected.'
            : 'Only this public address is sent. Your recovery phrase and private keys stay on this device. Stripe locks the address so the purchase cannot be redirected.'}
        </Text>
      </View>
      <Text style={styles.meta}>
        {usingTransak
          ? 'Checkout opens in the secure browser tab Transak uses for card payments. When you come back, pull to refresh. Crypto arrives on-chain after Transak finishes. Nothing is charged by BoreDefi.'
          : 'Checkout opens in the secure browser tab Stripe uses for card payments. When you come back, pull to refresh. Crypto arrives on-chain after Stripe finishes. Nothing is charged by BoreDefi.'}
      </Text>
      {!STRIPE_BUY_AVAILABLE && !usingTransak ? (
        <Text style={styles.meta}>This build has no onramp endpoint yet. Set EXPO_PUBLIC_ONRAMP_URL to the test server and rebuild.</Text>
      ) : null}
      {!TRANSAK_BUY_AVAILABLE ? (
        <Text style={styles.meta}>
          Transak is not in this build yet. Set EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT to the widget server and rebuild.
        </Text>
      ) : null}
      <ErrorBanner message={error ?? (built.ok ? null : built.error)} />
    </Screen>
  );
}

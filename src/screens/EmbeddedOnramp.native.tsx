import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Onramp, StripeProvider, useOnramp } from '@stripe/stripe-react-native';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { useTheme, useThemedStyles, type Theme } from '../context/ThemeContext';
import { embeddedPurchaseApi, runEmbeddedPurchase, validateEmbeddedForm, type EmbeddedPurchaseSdk } from '../wallet/onramp/embedded';
import type { EmbeddedOnrampProps } from './embedded-onramp-props';

const LINK_TERMS = 'https://link.com/terms';
const LINK_PRIVACY = 'https://link.com/privacy';

function formStyles({ colors, spacing, radius, type }: Theme) {
  return {
    block: { gap: spacing.sm },
    label: { color: colors.text, fontWeight: '700' as const },
    copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    row: { flexDirection: 'row' as const, gap: spacing.sm },
    grow: { flex: 1 },
    check: { color: colors.accent, fontWeight: '700' as const },
    link: { color: colors.accent, fontWeight: '700' as const },
    meta: type.meta,
  };
}

function safeStep(error: { message?: string; code?: string } | undefined, fallback: string): { error?: string; canceled?: boolean } {
  if (!error) {
    return {};
  }
  if (error.code === 'Canceled') {
    return { canceled: true };
  }
  const message = (error.message ?? '').replace(/\s+/g, ' ').trim();
  if (!message || /sk_|pk_|liwltoken|client_secret|mnemonic|private key/i.test(message)) {
    return { error: fallback };
  }
  return { error: message.slice(0, 300) };
}

function useEmbeddedSdk(): EmbeddedPurchaseSdk {
  const onramp = useOnramp();
  return useMemo<EmbeddedPurchaseSdk>(
    () => ({
      async configure() {
        const result = await onramp.configure({
          merchantDisplayName: 'BoreDefi',
          countryHint: 'US',
          appearance: {
            style: 'AUTOMATIC',
            lightColors: { primary: '#0B0F14', contentOnPrimary: '#F4F7FA', borderSelected: '#1A6B4E' },
            darkColors: { primary: '#2EE59D', contentOnPrimary: '#04140E', borderSelected: '#2EE59D' },
            primaryButton: { cornerRadius: 16, height: 52 },
          },
        });
        return safeStep(result.error, 'Stripe checkout is not ready.');
      },
      async hasLinkAccount(email) {
        const result = await onramp.hasLinkAccount(email);
        if (result.error) {
          return safeStep(result.error, 'Could not look up the Link account.');
        }
        return { hasLinkAccount: result.hasLinkAccount };
      },
      async registerLinkUser(info) {
        const result = await onramp.registerLinkUser({
          email: info.email,
          phone: info.phone,
          country: 'US',
          fullName: info.fullName,
        });
        if (!result.error) {
          return {};
        }
        const step = safeStep(result.error, 'Could not register with Link.');
        if (step.error && /already/i.test(step.error)) {
          return {};
        }
        return step;
      },
      async authorize(authIntentId) {
        const result = await onramp.authorize(authIntentId);
        if (result.error) {
          return safeStep(result.error, 'Link authorization did not finish.');
        }
        if (result.status === 'Denied') {
          return { denied: true };
        }
        if (result.status === 'Consented' && result.customerId) {
          return { customerId: result.customerId };
        }
        return { error: 'Link authorization did not finish.' };
      },
      async presentTermsOfService() {
        const result = await onramp.presentTermsOfServiceIfNeeded();
        return result.error ? safeStep(result.error, 'Accept the Stripe terms to continue.') : {};
      },
      async attachKyc(identity) {
        const result = await onramp.attachKycInfo({
          firstName: identity.firstName,
          lastName: identity.lastName,
          idNumber: identity.idNumber,
          idType: 'social_security_number',
          dateOfBirth: identity.dateOfBirth,
          address: identity.address,
        });
        if (!result.error) {
          return {};
        }
        const step = safeStep(result.error, 'Identity details were not accepted.');
        if (step.error && /already/i.test(step.error)) {
          return { alreadyVerified: true };
        }
        return step;
      },
      async presentKycVerification(address) {
        const result = await onramp.presentKycInfoVerification(address);
        if (result.error) {
          return safeStep(result.error, 'Identity review did not finish.');
        }
        if (result.status === 'UpdateAddress') {
          return { updateAddress: true };
        }
        return {};
      },
      async fulfillKyc() {
        const result = await onramp.fulfillKycRequirements();
        if (result.error) {
          return safeStep(result.error, 'Additional identity checks did not finish.');
        }
        if (result.status === 'PendingVerification') {
          return { pending: true };
        }
        return {};
      },
      async registerWallet(address, network) {
        const mapped =
          network === 'base'
            ? Onramp.CryptoNetwork.base
            : network === 'solana'
              ? Onramp.CryptoNetwork.solana
              : Onramp.CryptoNetwork.ethereum;
        const result = await onramp.registerWalletAddress(address, mapped);
        return safeStep(result.error, 'Could not register this wallet address.');
      },
      async collectCard() {
        const result = await onramp.collectPaymentMethod('Card');
        return safeStep(result.error, 'Add a card to continue.');
      },
      async createPaymentToken() {
        const result = await onramp.createCryptoPaymentToken();
        if (result.error || !result.cryptoPaymentToken) {
          return safeStep(result.error, 'Could not use that card.');
        }
        return { token: result.cryptoPaymentToken };
      },
      async presentPurchaseTerms() {
        const result = await onramp.presentTermsAndConditionsIfNeeded();
        return result.error ? safeStep(result.error, 'Accept the purchase terms to continue.') : {};
      },
      async verifyIdentity() {
        const result = await onramp.verifyIdentity();
        return safeStep(result.error, 'Identity verification did not finish.');
      },
      async performCheckout(sessionId, provideClientSecret) {
        const result = await onramp.performCheckout(sessionId, provideClientSecret);
        return safeStep(result.error, 'Checkout did not finish.');
      },
    }),
    [onramp],
  );
}

function EmbeddedOnrampForm(props: EmbeddedOnrampProps) {
  const styles = useThemedStyles(formStyles);
  const { colors } = useTheme();
  const sdk = useEmbeddedSdk();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+1');
  const [fullName, setFullName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [sourceAmount, setSourceAmount] = useState('50');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const start = async () => {
    const form = validateEmbeddedForm({
      email,
      phone,
      fullName,
      day,
      month,
      year,
      idNumber,
      line1,
      city,
      state,
      postalCode,
      sourceAmount,
      acceptedTerms,
    });
    if (!form.ok) {
      setError(form.error);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const result = await runEmbeddedPurchase({
        sdk,
        api: embeddedPurchaseApi({
          endpoint: props.endpoint,
          appToken: props.appToken,
          vercelBypass: props.vercelBypass,
          walletAddress: props.walletAddress,
          sourceAmount: form.value.sourceAmount,
        }),
        identity: form.value,
        currency: props.currency,
        network: props.network,
        walletAddress: props.walletAddress,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setIdNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 300) : 'Could not finish in-app checkout.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.block}>
      <Text style={styles.label}>In-app checkout</Text>
      <Text style={styles.copy}>
        Stripe handles the card payment and identity check inside this app. BoreDefi does not charge a fee and does not cover Stripe's fee.
        Any Stripe fee is shown before you pay. Crypto is sent only to your {props.assetLabel} address on {props.networkLabel}.
      </Text>
      <Text style={styles.meta}>
        Test mode. Amounts at or under 100 USD are what Stripe's sandbox allows. Test card 4242 4242 4242 4242. SMS code 000000. Test identity:
        name John Verified, identification number 000000000, address line address_full_match.
      </Text>
      <Text style={styles.label}>Amount (USD)</Text>
      <TextInput
        accessibilityLabel="Amount in US dollars"
        autoCorrect={false}
        editable={!busy}
        keyboardType="decimal-pad"
        onChangeText={setSourceAmount}
        placeholder="50.00"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={sourceAmount}
      />
      <Text style={styles.label}>Email</Text>
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={email}
      />
      <Text style={styles.label}>Phone</Text>
      <TextInput
        accessibilityLabel="Phone number"
        autoCorrect={false}
        editable={!busy}
        keyboardType="phone-pad"
        onChangeText={setPhone}
        placeholder="+12125551234"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={phone}
      />
      <Text style={styles.label}>Full name</Text>
      <TextInput
        accessibilityLabel="Full name"
        editable={!busy}
        onChangeText={setFullName}
        placeholder="First and last name"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={fullName}
      />
      <Text style={styles.label}>Date of birth</Text>
      <View style={styles.row}>
        <TextInput accessibilityLabel="Birth month" editable={!busy} keyboardType="number-pad" maxLength={2} onChangeText={setMonth} placeholder="MM" placeholderTextColor={colors.muted} style={[styles.input, styles.grow]} value={month} />
        <TextInput accessibilityLabel="Birth day" editable={!busy} keyboardType="number-pad" maxLength={2} onChangeText={setDay} placeholder="DD" placeholderTextColor={colors.muted} style={[styles.input, styles.grow]} value={day} />
        <TextInput accessibilityLabel="Birth year" editable={!busy} keyboardType="number-pad" maxLength={4} onChangeText={setYear} placeholder="YYYY" placeholderTextColor={colors.muted} style={[styles.input, styles.grow]} value={year} />
      </View>
      <Text style={styles.label}>Identification number</Text>
      <TextInput
        accessibilityLabel="Identification number"
        autoCorrect={false}
        editable={!busy}
        keyboardType="number-pad"
        maxLength={9}
        onChangeText={setIdNumber}
        placeholder="9 digits"
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={styles.input}
        value={idNumber}
      />
      <Text style={styles.label}>Address</Text>
      <TextInput accessibilityLabel="Street address" editable={!busy} onChangeText={setLine1} placeholder="Street" placeholderTextColor={colors.muted} style={styles.input} value={line1} />
      <TextInput accessibilityLabel="City" editable={!busy} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.muted} style={styles.input} value={city} />
      <View style={styles.row}>
        <TextInput accessibilityLabel="State" autoCapitalize="characters" editable={!busy} maxLength={2} onChangeText={setState} placeholder="State" placeholderTextColor={colors.muted} style={[styles.input, styles.grow]} value={state} />
        <TextInput accessibilityLabel="ZIP code" editable={!busy} keyboardType="number-pad" onChangeText={setPostalCode} placeholder="ZIP" placeholderTextColor={colors.muted} style={[styles.input, styles.grow]} value={postalCode} />
      </View>
      <Text style={styles.meta}>In-app checkout is for customers in the US, except New York. The address above is sent to Stripe, not stored by BoreDefi.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acceptedTerms }} disabled={busy} onPress={() => setAcceptedTerms((current) => !current)}>
        <Text style={styles.check}>{acceptedTerms ? '☑' : '☐'} I agree to create or use a Link account for this purchase.</Text>
      </Pressable>
      <Text style={styles.copy}>
        <Text style={styles.link} onPress={() => void Linking.openURL(LINK_TERMS)}>
          Link Terms
        </Text>
        {'  ·  '}
        <Text style={styles.link} onPress={() => void Linking.openURL(LINK_PRIVACY)}>
          Link Privacy Policy
        </Text>
      </Text>
      {done ? (
        <Text style={styles.copy}>
          Purchase submitted. Crypto is sent to this address after Stripe finishes. Pull to refresh on Home. Nothing was charged by BoreDefi.
        </Text>
      ) : null}
      <ErrorBanner message={error} />
      <Button label="Continue in the app" onPress={() => void start()} loading={busy} disabled={busy} />
    </View>
  );
}

declare function require(moduleName: string): unknown;

function nativeOnrampReady(): boolean {
  try {
    const hooks = require('@stripe/stripe-react-native/lib/module/hooks/useOnramp') as {
      requireOnrampModule?: () => void;
    };
    hooks.requireOnrampModule?.();
    return true;
  } catch {
    return false;
  }
}

export function EmbeddedOnramp(props: EmbeddedOnrampProps) {
  const styles = useThemedStyles(formStyles);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    setReady(nativeOnrampReady());
  }, []);
  if (ready === false) {
    return (
      <Text style={styles.meta}>
        In-app checkout needs a new iOS or Android build with the Stripe onramp module. Continue in the browser for this build.
      </Text>
    );
  }
  if (ready !== true) {
    return null;
  }
  return (
    <StripeProvider publishableKey={props.publishableKey} urlScheme="boredefi">
      <EmbeddedOnrampForm {...props} />
    </StripeProvider>
  );
}

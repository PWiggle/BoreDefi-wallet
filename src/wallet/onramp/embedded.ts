import { isAllowedOnrampEndpoint, onrampAppToken, onrampEndpointUrl, vercelBypassToken } from './config';
import { ONRAMP_OFFERS, type OnrampOffer } from './offers';

const PUBLISHABLE_PREFIX = 'pk_test_';
const CLIENT_SECRET = /^cos_[A-Za-z0-9]+_secret_[A-Za-z0-9_]+$/;
const SESSION_ID = /^cos_[A-Za-z0-9]+$/;
const AUTH_INTENT_ID = /^lai_[A-Za-z0-9]+$/;

export type EmbeddedNetwork = 'ethereum' | 'base' | 'solana';
export type EmbeddedCurrency = 'eth' | 'usdc' | 'sol';

/**
 * Test publishable key only. A live key, or anything that is not pk_test_, disables in-app checkout.
 * Expo inlines this literal. The secret key is never read here.
 */
const BUILD_STRIPE_PUBLISHABLE_KEY: string | undefined = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export function testPublishableKey(value: string | undefined): string | null {
  const key = value?.trim() ?? '';
  if (!key.startsWith(PUBLISHABLE_PREFIX) || key.length < PUBLISHABLE_PREFIX.length + 8) {
    return null;
  }
  if (key.toLowerCase().includes('live')) {
    return null;
  }
  return key;
}

export const STRIPE_TEST_PUBLISHABLE_KEY = testPublishableKey(BUILD_STRIPE_PUBLISHABLE_KEY);

export function embeddedOnrampPlatform(os: string): boolean {
  return os === 'ios' || os === 'android';
}

/** USDC and ETH on Ethereum and Base, and USDC and SOL on Solana. Polygon stays in the browser. */
export function isEmbeddedOnrampOffer(offerId: string): boolean {
  const offer = ONRAMP_OFFERS.find((item) => item.id === offerId);
  if (!offer) {
    return false;
  }
  return offer.network !== 'polygon' && (offer.currency === 'eth' || offer.currency === 'usdc' || offer.currency === 'sol');
}

export function embeddedOnrampEndpoint(sessionEndpoint: string | null): string | null {
  if (!sessionEndpoint || !isAllowedOnrampEndpoint(sessionEndpoint)) {
    return null;
  }
  const endpoint = sessionEndpoint.replace(/\/api\/onramp-session$/, '/api/onramp-embedded');
  return endpoint === sessionEndpoint ? null : endpoint;
}

export function embeddedOnrampEndpointFromBase(base: string | undefined): string | null {
  return embeddedOnrampEndpoint(onrampEndpointUrl(base));
}

export type EmbeddedFormInput = {
  email: string;
  phone: string;
  fullName: string;
  day: string;
  month: string;
  year: string;
  idNumber: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  sourceAmount: string;
  acceptedTerms: boolean;
};

export type EmbeddedIdentity = {
  email: string;
  phone: string;
  fullName: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  dateOfBirth: { day: number; month: number; year: number };
  address: { line1: string; city: string; state: string; postalCode: string; country: 'US' };
  sourceAmount: string;
};

export function validateEmbeddedForm(input: EmbeddedFormInput): { ok: true; value: EmbeddedIdentity } | { ok: false; error: string } {
  if (!input.acceptedTerms) {
    return { ok: false, error: 'Accept the Link terms to continue in the app.' };
  }
  const email = input.email.trim();
  if (email.length > 800 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter the email for your Link account.' };
  }
  const phone = input.phone.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return { ok: false, error: 'Enter a phone number in international format, starting with +.' };
  }
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const parts = fullName.split(' ');
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  if (!firstName || !lastName || fullName.length > 200) {
    return { ok: false, error: 'Enter a first and last name.' };
  }
  const day = Number(input.day);
  const month = Number(input.month);
  const year = Number(input.year);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year) || day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2008) {
    return { ok: false, error: 'Enter a date of birth Stripe can verify.' };
  }
  const idNumber = input.idNumber.trim();
  if (!/^\d{9}$/.test(idNumber)) {
    return { ok: false, error: 'Enter the 9-digit identification number Stripe asks for.' };
  }
  const line1 = input.line1.trim();
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  const postalCode = input.postalCode.trim();
  if (!line1 || line1.length > 200 || !city || city.length > 100) {
    return { ok: false, error: 'Enter the street address and city on your identification.' };
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return { ok: false, error: 'Enter a two-letter US state code.' };
  }
  if (state === 'NY') {
    return { ok: false, error: 'Stripe in-app checkout is not available in New York. Continue in the browser instead.' };
  }
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) {
    return { ok: false, error: 'Enter a US ZIP code.' };
  }
  const amount = input.sourceAmount.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(amount)) {
    return { ok: false, error: 'Enter a USD amount with at most two decimal places.' };
  }
  const dollars = Number(amount);
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 10000) {
    return { ok: false, error: 'Enter a USD amount greater than 0 and at most 10000.' };
  }
  return {
    ok: true,
    value: {
      email,
      phone,
      fullName,
      firstName,
      lastName,
      idNumber,
      dateOfBirth: { day, month, year },
      address: { line1, city, state, postalCode, country: 'US' },
      sourceAmount: dollars.toFixed(2),
    },
  };
}

type StepError = { error?: string; canceled?: boolean };

export type EmbeddedPurchaseSdk = {
  configure(): Promise<StepError>;
  hasLinkAccount(email: string): Promise<StepError & { hasLinkAccount?: boolean }>;
  registerLinkUser(input: { email: string; phone: string; fullName: string }): Promise<StepError>;
  authorize(authIntentId: string): Promise<StepError & { customerId?: string; denied?: boolean }>;
  presentTermsOfService(): Promise<StepError>;
  attachKyc(identity: EmbeddedIdentity): Promise<StepError & { alreadyVerified?: boolean }>;
  presentKycVerification(address: EmbeddedIdentity['address'] | null): Promise<StepError & { updateAddress?: boolean }>;
  fulfillKyc(): Promise<StepError & { pending?: boolean }>;
  registerWallet(address: string, network: EmbeddedNetwork): Promise<StepError>;
  collectCard(): Promise<StepError>;
  createPaymentToken(): Promise<StepError & { token?: string }>;
  presentPurchaseTerms(): Promise<StepError>;
  verifyIdentity(): Promise<StepError>;
  performCheckout(sessionId: string, provideClientSecret: () => Promise<string | null>): Promise<StepError>;
};

export type EmbeddedPurchaseApi = {
  linkAuth(email: string): Promise<{ ok: true; authIntentId: string } | { ok: false; error: string }>;
  session(input: {
    authIntentId: string;
    customerId: string;
    paymentToken: string;
    currency: EmbeddedCurrency;
    network: EmbeddedNetwork;
    walletAddress: string;
    sourceAmount: string;
  }): Promise<{ ok: true; sessionId: string } | { ok: false; error: string; identityRequired?: boolean }>;
  checkout(input: { authIntentId: string; sessionId: string }): Promise<{ ok: true; clientSecret: string } | { ok: false; error: string }>;
};

function stop(step: StepError, fallback: string): { ok: false; error: string } | null {
  if (step.canceled) {
    return { ok: false, error: 'Checkout canceled.' };
  }
  if (step.error) {
    return { ok: false, error: step.error };
  }
  return null;
}

export async function runEmbeddedPurchase(input: {
  sdk: EmbeddedPurchaseSdk;
  api: EmbeddedPurchaseApi;
  identity: EmbeddedIdentity;
  currency: EmbeddedCurrency;
  network: EmbeddedNetwork;
  walletAddress: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const configured = stop(await input.sdk.configure(), 'Stripe checkout is not ready.');
  if (configured) {
    return configured;
  }
  const link = await input.sdk.hasLinkAccount(input.identity.email);
  const linkError = stop(link, 'Could not look up the Link account.');
  if (linkError) {
    return linkError;
  }
  if (!link.hasLinkAccount) {
    const registered = stop(
      await input.sdk.registerLinkUser({
        email: input.identity.email,
        phone: input.identity.phone,
        fullName: input.identity.fullName,
      }),
      'Could not register with Link.',
    );
    if (registered) {
      return registered;
    }
  }
  const intent = await input.api.linkAuth(input.identity.email);
  if (!intent.ok) {
    return intent;
  }
  const authorized = await input.sdk.authorize(intent.authIntentId);
  const authError = stop(authorized, 'Link authorization did not finish.');
  if (authError) {
    return authError;
  }
  if (authorized.denied || !authorized.customerId) {
    return { ok: false, error: 'Link authorization was declined.' };
  }
  const terms = stop(await input.sdk.presentTermsOfService(), 'Accept the Stripe terms to continue.');
  if (terms) {
    return terms;
  }
  const kyc = await input.sdk.attachKyc(input.identity);
  const kycError = stop(kyc, 'Identity details were not accepted.');
  if (kycError && !kyc.alreadyVerified) {
    return kycError;
  }
  if (kyc.alreadyVerified) {
    const review = await input.sdk.presentKycVerification(null);
    const reviewError = stop(review, 'Identity review did not finish.');
    if (reviewError) {
      return reviewError;
    }
    if (review.updateAddress) {
      const updated = stop(await input.sdk.presentKycVerification(input.identity.address), 'The updated address was not accepted.');
      if (updated) {
        return updated;
      }
    }
  }
  const extra = await input.sdk.fulfillKyc();
  const extraError = stop(extra, 'Additional identity checks did not finish.');
  if (extraError) {
    return extraError;
  }
  if (extra.pending) {
    return { ok: false, error: 'Stripe is still verifying identity. Try again in a few minutes.' };
  }
  const wallet = stop(
    await input.sdk.registerWallet(input.walletAddress, input.network),
    'Could not register this wallet address.',
  );
  if (wallet) {
    return wallet;
  }
  const card = stop(await input.sdk.collectCard(), 'Add a card to continue.');
  if (card) {
    return card;
  }
  const token = await input.sdk.createPaymentToken();
  const tokenError = stop(token, 'Could not use that card.');
  if (tokenError || !token.token) {
    return tokenError ?? { ok: false, error: 'Could not use that card.' };
  }
  const purchaseTerms = stop(await input.sdk.presentPurchaseTerms(), 'Accept the purchase terms to continue.');
  if (purchaseTerms) {
    return purchaseTerms;
  }
  const customerId = authorized.customerId;
  const paymentToken = token.token;
  const openSession = () =>
    input.api.session({
      authIntentId: intent.authIntentId,
      customerId,
      paymentToken,
      currency: input.currency,
      network: input.network,
      walletAddress: input.walletAddress,
      sourceAmount: input.identity.sourceAmount,
    });
  let session = await openSession();
  if (!session.ok && session.identityRequired) {
    const verified = stop(await input.sdk.verifyIdentity(), 'Identity verification did not finish.');
    if (verified) {
      return verified;
    }
    session = await openSession();
  }
  if (!session.ok) {
    return session;
  }
  const sessionId = session.sessionId;
  try {
    const checkout = await input.sdk.performCheckout(sessionId, async () => {
      const secret = await input.api.checkout({ authIntentId: intent.authIntentId, sessionId });
      if (!secret.ok) {
        throw new Error(secret.error);
      }
      return secret.clientSecret;
    });
    const checkoutError = stop(checkout, 'Checkout did not finish.');
    if (checkoutError) {
      return checkoutError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { ok: false, error: message.trim().slice(0, 300) || 'Checkout did not finish.' };
  }
  return { ok: true };
}

function errorFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim().slice(0, 300);
  }
  return fallback;
}

export function readAuthIntentId(payload: unknown): { ok: true; authIntentId: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'The buy service returned an unexpected response.' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { ok: false, error: record.error.trim().slice(0, 300) };
  }
  if (typeof record.auth_intent_id !== 'string' || !AUTH_INTENT_ID.test(record.auth_intent_id)) {
    return { ok: false, error: 'Link authorization did not start.' };
  }
  return { ok: true, authIntentId: record.auth_intent_id };
}

export function readEmbeddedSessionId(payload: unknown): { ok: true; sessionId: string } | { ok: false; error: string; identityRequired?: boolean } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'The buy service returned an unexpected response.' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    const error = record.error.trim().slice(0, 300);
    return { ok: false, error, identityRequired: error === 'Identity verification is required before this purchase.' };
  }
  if (typeof record.session_id !== 'string' || !SESSION_ID.test(record.session_id)) {
    return { ok: false, error: 'In-app checkout did not start.' };
  }
  return { ok: true, sessionId: record.session_id };
}

export function readEmbeddedClientSecret(payload: unknown): { ok: true; clientSecret: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'The buy service returned an unexpected response.' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { ok: false, error: record.error.trim().slice(0, 300) };
  }
  if (typeof record.client_secret !== 'string' || !CLIENT_SECRET.test(record.client_secret)) {
    return { ok: false, error: 'Stripe did not return a checkout secret.' };
  }
  return { ok: true, clientSecret: record.client_secret };
}

export async function postEmbeddedOnramp(input: {
  endpoint: string;
  body: Record<string, string>;
  appToken: string | null;
  vercelBypass?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; status: number; payload: unknown } | { ok: false; error: string }> {
  if (!input.endpoint.endsWith('/api/onramp-embedded') || !isAllowedOnrampEndpoint(input.endpoint.replace(/\/api\/onramp-embedded$/, '/api/onramp-session'))) {
    return { ok: false, error: 'The buy service URL is not configured for https.' };
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const token = onrampAppToken(input.appToken ?? undefined);
  if (token) {
    headers['x-boredefi-onramp'] = token;
  }
  const bypass = vercelBypassToken(input.vercelBypass ?? undefined);
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(input.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, error: 'The buy service returned an unexpected response.' };
      }
    }
    if (!response.ok) {
      return { ok: false, error: errorFromPayload(payload, 'The buy service refused to start.') };
    }
    return { ok: true, status: response.status, payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The buy service took too long.' };
    }
    return { ok: false, error: 'Could not reach the buy service. Check the connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export function embeddedOfferNetwork(offer: OnrampOffer): EmbeddedNetwork | null {
  if (!isEmbeddedOnrampOffer(offer.id)) {
    return null;
  }
  if (offer.network === 'ethereum' || offer.network === 'base' || offer.network === 'solana') {
    return offer.network;
  }
  return null;
}

export function embeddedPurchaseApi(input: {
  endpoint: string;
  appToken: string | null;
  vercelBypass: string | null;
  walletAddress: string;
  sourceAmount: string;
}): EmbeddedPurchaseApi {
  return {
    async linkAuth(email) {
      const posted = await postEmbeddedOnramp({
        endpoint: input.endpoint,
        appToken: input.appToken,
        vercelBypass: input.vercelBypass,
        body: { action: 'link_auth', email },
      });
      if (!posted.ok) {
        return posted;
      }
      return readAuthIntentId(posted.payload);
    },
    async session(session) {
      const posted = await postEmbeddedOnramp({
        endpoint: input.endpoint,
        appToken: input.appToken,
        vercelBypass: input.vercelBypass,
        body: {
          action: 'session',
          auth_intent_id: session.authIntentId,
          crypto_customer_id: session.customerId,
          crypto_payment_token: session.paymentToken,
          destination_currency: session.currency,
          destination_network: session.network,
          wallet_address: input.walletAddress,
          source_amount: input.sourceAmount,
        },
      });
      if (!posted.ok) {
        return {
          ok: false,
          error: posted.error,
          identityRequired: posted.error === 'Identity verification is required before this purchase.',
        };
      }
      return readEmbeddedSessionId(posted.payload);
    },
    async checkout(checkout) {
      const posted = await postEmbeddedOnramp({
        endpoint: input.endpoint,
        appToken: input.appToken,
        vercelBypass: input.vercelBypass,
        body: {
          action: 'checkout',
          auth_intent_id: checkout.authIntentId,
          session_id: checkout.sessionId,
        },
      });
      if (!posted.ok) {
        return posted;
      }
      return readEmbeddedClientSecret(posted.payload);
    },
  };
}

export function embeddedOfferCurrency(offer: OnrampOffer): EmbeddedCurrency | null {
  if (offer.currency === 'eth' || offer.currency === 'usdc' || offer.currency === 'sol') {
    return offer.network === 'polygon' ? null : offer.currency;
  }
  return null;
}

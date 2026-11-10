/**
 * Transak hosted onramp widget (staging by default).
 *
 * The public API key is EXPO_PUBLIC_TRANSAK_API_KEY. It is a partner identifier,
 * not a secret, but it still comes from build config and is never hardcoded.
 * A missing key, or a REPLACE_ME-style placeholder, hides the Transak option.
 *
 * EXPO_PUBLIC_TRANSAK_ENVIRONMENT is STAGING (default) or PRODUCTION.
 * Staging opens https://global-stg.transak.com. Production opens
 * https://global.transak.com and must wait until PepLabs KYB is approved.
 *
 * Partner fee is not a widget parameter. It is set in the Transak Partner
 * Dashboard (Products) and must stay at 0% so BoreDefi charges nothing on a buy.
 *
 * Transak's Create Widget URL API is backend-only (API secret + IP allowlist).
 * This wallet opens the hosted widget with the public key and prefill params,
 * which is enough to build and test against staging. See
 * src/wallet/onramp/TRANSAK.md for the signup and go-live steps.
 *
 * Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads, so each one
 * below is read literally.
 */
import { isAddress } from 'ethers';

import { isValidSolanaAddress } from '../solana/address';
import { ONRAMP_OFFERS, type OnrampOffer } from './offers';

const BUILD_TRANSAK_API_KEY: string | undefined = process.env.EXPO_PUBLIC_TRANSAK_API_KEY;
const BUILD_TRANSAK_ENVIRONMENT: string | undefined = process.env.EXPO_PUBLIC_TRANSAK_ENVIRONMENT;

export const TRANSAK_STAGING_HOST = 'global-stg.transak.com';
export const TRANSAK_PRODUCTION_HOST = 'global.transak.com';
/** Android package and iOS bundle ID, which Transak asks for as referrerDomain on mobile. */
export const TRANSAK_REFERRER_DOMAIN = 'com.boredefi.wallet';
/** Dashboard fee. Never sent as a query parameter. */
export const TRANSAK_PARTNER_FEE_PERCENT = 0;

const PLACEHOLDER = /replace_me|your_api_key|your-api-key|changeme|placeholder|^xxx+$/i;
const LOOKS_LIKE_SECRET = /^(?:sk|rk)_|^secret/i;
const FEE_QUERY_KEYS = /^(partnerfee|partner_fee|partnerfeepercent|feepercentage|feeamount|partnerordermarkup)$/i;

export type TransakEnvironment = 'STAGING' | 'PRODUCTION';

export function isTransakPlaceholder(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 || PLACEHOLDER.test(trimmed);
}

export function transakApiKey(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (isTransakPlaceholder(trimmed) || trimmed.length < 8 || LOOKS_LIKE_SECRET.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function transakEnvironment(value: string | undefined): TransakEnvironment {
  const trimmed = value?.trim().toUpperCase() ?? '';
  if (trimmed === 'PRODUCTION' || trimmed === 'PROD' || trimmed === 'LIVE') {
    return 'PRODUCTION';
  }
  return 'STAGING';
}

export function transakHost(environment: TransakEnvironment): typeof TRANSAK_STAGING_HOST | typeof TRANSAK_PRODUCTION_HOST {
  return environment === 'PRODUCTION' ? TRANSAK_PRODUCTION_HOST : TRANSAK_STAGING_HOST;
}

/** Polygon's native token is POL in this wallet and on Transak. Stripe still calls it matic. */
export function transakCryptoForOffer(offer: OnrampOffer): { cryptoCurrencyCode: string; network: string } {
  const cryptoCurrencyCode = offer.currency === 'matic' ? 'POL' : offer.currency.toUpperCase();
  return { cryptoCurrencyCode, network: offer.network };
}

export function isTransakHostedWidgetUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return false;
  }
  if (url.hostname !== TRANSAK_STAGING_HOST && url.hostname !== TRANSAK_PRODUCTION_HOST) {
    return false;
  }
  const key = url.searchParams.get('apiKey');
  return Boolean(key && key.trim());
}

/** True when a query name would set a partner or markup fee. Those must never appear. */
export function isTransakFeeQueryParam(name: string): boolean {
  return FEE_QUERY_KEYS.test(name.replace(/[_-]/g, ''));
}

export function buildTransakWidgetUrl(input: {
  apiKey: string | null | undefined;
  environment?: string;
  offerId: string;
  evmAddress: string | null | undefined;
  solanaAddress: string | null | undefined;
}): { ok: true; url: string } | { ok: false; error: string } {
  const key = transakApiKey(input.apiKey ?? undefined);
  if (!key) {
    return { ok: false, error: 'Set EXPO_PUBLIC_TRANSAK_API_KEY to the staging API key and rebuild.' };
  }
  const offer = ONRAMP_OFFERS.find((item) => item.id === input.offerId);
  if (!offer) {
    return { ok: false, error: 'Choose a supported asset and network.' };
  }
  const raw = (offer.family === 'solana' ? input.solanaAddress : input.evmAddress)?.trim() ?? '';
  if (!raw) {
    return {
      ok: false,
      error: offer.family === 'solana' ? 'Your Solana address is not ready yet.' : 'Your wallet address is not ready yet.',
    };
  }
  if (offer.family === 'evm' && !isAddress(raw)) {
    return { ok: false, error: 'The wallet address is not a valid Ethereum-style address.' };
  }
  if (offer.family === 'solana' && !isValidSolanaAddress(raw)) {
    return { ok: false, error: 'The wallet address is not a valid Solana address.' };
  }
  const walletAddress = raw;
  const { cryptoCurrencyCode, network } = transakCryptoForOffer(offer);
  const environment = transakEnvironment(input.environment);
  const url = new URL(`https://${transakHost(environment)}/`);
  url.searchParams.set('apiKey', key);
  url.searchParams.set('environment', environment);
  url.searchParams.set('productsAvailed', 'BUY');
  url.searchParams.set('cryptoCurrencyCode', cryptoCurrencyCode);
  url.searchParams.set('network', network);
  url.searchParams.set('walletAddress', walletAddress);
  url.searchParams.set('disableWalletAddressForm', 'true');
  url.searchParams.set('referrerDomain', TRANSAK_REFERRER_DOMAIN);
  url.searchParams.set('colorMode', 'DARK');
  url.searchParams.set('themeColor', '2EE59D');
  url.searchParams.set('hideMenu', 'true');
  for (const name of url.searchParams.keys()) {
    if (isTransakFeeQueryParam(name)) {
      return { ok: false, error: 'Refusing to open Transak with a partner fee parameter.' };
    }
  }
  const href = url.toString();
  if (!isTransakHostedWidgetUrl(href)) {
    return { ok: false, error: 'Refusing to open a link that is not the Transak-hosted widget.' };
  }
  return { ok: true, url: href };
}

export const TRANSAK_API_KEY = transakApiKey(BUILD_TRANSAK_API_KEY);
export const TRANSAK_ENVIRONMENT = transakEnvironment(BUILD_TRANSAK_ENVIRONMENT);
/** True when this build can offer Transak as a Buy provider. */
export const TRANSAK_BUY_AVAILABLE = TRANSAK_API_KEY !== null;

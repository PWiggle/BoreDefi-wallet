/**
 * Transak hosted onramp widget, opened from a backend-created Secure Widget URL.
 *
 * Transak no longer accepts query parameters built in the app. The wallet POSTs
 * the public address and chosen asset to EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT,
 * then opens the returned https://global-stg.transak.com (or global.transak.com)
 * URL in a system browser tab. A missing or placeholder endpoint hides Transak.
 *
 * Partner credentials stay on the widget-url server, not in this app.
 * Partner fee is set in the Transak Partner Dashboard and must stay at 0%.
 * The app never sends a fee parameter.
 *
 * Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads, so each one
 * below is read literally.
 */
import { isAddress } from 'ethers';

import { isValidSolanaAddress } from '../solana/address';
import { ONRAMP_OFFERS, type OnrampOffer } from './offers';

const BUILD_TRANSAK_WIDGET_ENDPOINT: string | undefined = process.env.EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT;

export const TRANSAK_STAGING_HOST = 'global-stg.transak.com';
export const TRANSAK_PRODUCTION_HOST = 'global.transak.com';
/** Android package and iOS bundle ID, which Transak asks for as referrerDomain on mobile. */
export const TRANSAK_REFERRER_DOMAIN = 'com.boredefi.wallet';
/** Dashboard fee. Never sent as a request or query parameter. */
export const TRANSAK_PARTNER_FEE_PERCENT = 0;

const PLACEHOLDER = /replace_me|your_api_key|your-api-key|changeme|placeholder|^xxx+$/i;
const FEE_QUERY_KEYS = /^(partnerfee|partner_fee|partnerfeepercent|feepercentage|feeamount|partnerordermarkup)$/i;

export function isTransakPlaceholder(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 || PLACEHOLDER.test(trimmed);
}

/** Polygon's native token is POL in this wallet and on Transak. Stripe still calls it matic. */
export function transakCryptoForOffer(offer: OnrampOffer): { crypto: string; network: string } {
  const crypto = offer.currency === 'matic' ? 'POL' : offer.currency.toUpperCase();
  return { crypto, network: offer.network };
}

export function isTransakFeeQueryParam(name: string): boolean {
  return FEE_QUERY_KEYS.test(name.replace(/[_-]/g, ''));
}

export function isTransakHostedWidgetUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
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
  for (const name of url.searchParams.keys()) {
    if (isTransakFeeQueryParam(name)) {
      return false;
    }
  }
  const sessionId = url.searchParams.get('sessionId')?.trim();
  const apiKey = url.searchParams.get('apiKey')?.trim();
  return Boolean(sessionId || apiKey);
}

/** True for the widget-url endpoint the app is allowed to call. */
export function isAllowedTransakWidgetEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !loopback) {
    return false;
  }
  return url.pathname.endsWith('/api/widget-url');
}

/**
 * Accepts either the server origin (`https://preview.vercel.app`) or the full
 * endpoint (`https://preview.vercel.app/api/widget-url`).
 */
export function transakWidgetEndpointUrl(base: string | undefined): string | null {
  const trimmed = base?.trim() ?? '';
  if (!trimmed || isTransakPlaceholder(trimmed)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !loopback) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/api/widget-url') ? path || '/api/widget-url' : `${path}/api/widget-url`;
  url.search = '';
  url.hash = '';
  const endpoint = url.toString();
  return isAllowedTransakWidgetEndpoint(endpoint) ? endpoint : null;
}

export type TransakWidgetRequest = {
  walletAddress: string;
  network: string;
  crypto: string;
  fiatAmount?: number;
};

export function buildTransakWidgetRequest(input: {
  offerId: string;
  evmAddress: string | null | undefined;
  solanaAddress: string | null | undefined;
  fiatAmount?: number;
}): { ok: true; body: TransakWidgetRequest } | { ok: false; error: string } {
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
  const { crypto, network } = transakCryptoForOffer(offer);
  const body: TransakWidgetRequest = { walletAddress: raw, network, crypto };
  if (input.fiatAmount !== undefined) {
    if (!Number.isFinite(input.fiatAmount) || input.fiatAmount <= 0) {
      return { ok: false, error: 'Enter a positive amount.' };
    }
    body.fiatAmount = input.fiatAmount;
  }
  return { ok: true, body };
}

export function readTransakWidgetUrl(payload: unknown): { ok: true; widgetUrl: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'The buy service returned an unexpected response.' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { ok: false, error: record.error.trim().slice(0, 300) };
  }
  if (typeof record.widgetUrl !== 'string' || !isTransakHostedWidgetUrl(record.widgetUrl)) {
    return { ok: false, error: "The onramp link was missing or was not Transak's hosted widget." };
  }
  return { ok: true, widgetUrl: record.widgetUrl };
}

export async function postTransakWidgetUrl(input: {
  endpoint: string;
  body: TransakWidgetRequest;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; widgetUrl: string } | { ok: false; error: string }> {
  if (!isAllowedTransakWidgetEndpoint(input.endpoint)) {
    return { ok: false, error: 'The Transak service URL is not configured for https.' };
  }
  const payload: TransakWidgetRequest = {
    walletAddress: input.body.walletAddress,
    network: input.body.network,
    crypto: input.body.crypto,
  };
  if (input.body.fiatAmount !== undefined) {
    payload.fiatAmount = input.body.fiatAmount;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(input.endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, error: 'The buy service returned an unexpected response.' };
      }
    }
    const widget = readTransakWidgetUrl(parsed);
    if (!response.ok) {
      return { ok: false, error: widget.ok ? 'The buy service refused to start.' : widget.error };
    }
    return widget;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The buy service took too long.' };
    }
    return { ok: false, error: 'Could not reach the buy service. Check the connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export const TRANSAK_WIDGET_ENDPOINT = transakWidgetEndpointUrl(BUILD_TRANSAK_WIDGET_ENDPOINT);
/** True when this build can offer Transak as a Buy provider. */
export const TRANSAK_BUY_AVAILABLE = TRANSAK_WIDGET_ENDPOINT !== null;

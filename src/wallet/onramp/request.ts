import { isAddress } from 'ethers';

import { isValidSolanaAddress } from '../solana/address';
import { isAllowedOnrampEndpoint, onrampAppToken, vercelBypassToken } from './config';
import { ONRAMP_OFFERS, type OnrampOffer } from './offers';
import { isStripeHostedOnrampUrl } from './url';

/** JSON body posted to our server. The server maps this onto Stripe's session API. */
export type OnrampSessionRequest = {
  destination_currency: OnrampOffer['currency'];
  destination_network: OnrampOffer['network'];
  wallet_address: string;
};

export function buildOnrampSessionRequest(input: {
  offerId: string;
  evmAddress: string | null | undefined;
  solanaAddress: string | null | undefined;
}): { ok: true; body: OnrampSessionRequest } | { ok: false; error: string } {
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
  return {
    ok: true,
    body: {
      destination_currency: offer.currency,
      destination_network: offer.network,
      wallet_address: raw,
    },
  };
}

export function readOnrampRedirect(payload: unknown): { ok: true; redirectUrl: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'The buy service returned an unexpected response.' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { ok: false, error: record.error.trim().slice(0, 300) };
  }
  if (typeof record.redirect_url !== 'string' || !isStripeHostedOnrampUrl(record.redirect_url)) {
    return { ok: false, error: "The onramp link was missing or was not Stripe's hosted page." };
  }
  return { ok: true, redirectUrl: record.redirect_url };
}

export async function postOnrampSession(input: {
  endpoint: string;
  body: OnrampSessionRequest;
  appToken: string | null;
  /** Vercel Deployment Protection bypass. Omitted from the request when unset. */
  vercelBypass?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: string }> {
  if (!isAllowedOnrampEndpoint(input.endpoint)) {
    return { ok: false, error: 'The buy service URL is not configured for https.' };
  }
  const payload: OnrampSessionRequest = {
    destination_currency: input.body.destination_currency,
    destination_network: input.body.destination_network,
    wallet_address: input.body.wallet_address,
  };
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
    const redirect = readOnrampRedirect(parsed);
    if (!response.ok) {
      return { ok: false, error: redirect.ok ? 'The buy service refused to start.' : redirect.error };
    }
    return redirect;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The buy service took too long.' };
    }
    return { ok: false, error: 'Could not reach the buy service. Check the connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

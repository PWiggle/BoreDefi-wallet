/**
 * Card-to-crypto pairs this wallet can receive and Stripe's hosted onramp lists.
 *
 * Stripe enums (destination_currency / destination_network) and the hosted
 * availability table were checked on 2026-11-07:
 * https://docs.stripe.com/api/crypto/onramp_sessions/create
 * https://docs.stripe.com/crypto/onramp/stripe-hosted
 *
 * BTC, XLM, and other assets this wallet cannot hold are omitted. USDC on
 * Optimism, Arbitrum, and BNB is in the wallet but not in Stripe's hosted list.
 * Avalanche is a destination_network, but the session object's wallet_addresses
 * hash has no avalanche field (unknown keys are rejected, as `base` was).
 * Polygon's native token is POL in the wallet; Stripe's API enum is still `matic`.
 * Base is destination_network `base` and wallet_addresses key `base_network`.
 */

export type OnrampCurrency = 'eth' | 'usdc' | 'sol' | 'matic';
export type OnrampNetwork = 'ethereum' | 'base' | 'polygon' | 'solana';
export type OnrampFamily = 'evm' | 'solana';

export type OnrampOffer = {
  id: string;
  currency: OnrampCurrency;
  network: OnrampNetwork;
  /** Label shown in the app. */
  asset: string;
  networkLabel: string;
  family: OnrampFamily;
  /** Extra line when Stripe's name and the wallet's name differ. */
  detail?: string;
};

export const ONRAMP_OFFERS: readonly OnrampOffer[] = [
  { id: 'eth-ethereum', currency: 'eth', network: 'ethereum', asset: 'ETH', networkLabel: 'Ethereum', family: 'evm' },
  { id: 'usdc-ethereum', currency: 'usdc', network: 'ethereum', asset: 'USDC', networkLabel: 'Ethereum', family: 'evm' },
  { id: 'eth-base', currency: 'eth', network: 'base', asset: 'ETH', networkLabel: 'Base', family: 'evm' },
  { id: 'usdc-base', currency: 'usdc', network: 'base', asset: 'USDC', networkLabel: 'Base', family: 'evm' },
  {
    id: 'matic-polygon',
    currency: 'matic',
    network: 'polygon',
    asset: 'POL',
    networkLabel: 'Polygon',
    family: 'evm',
    detail: "Stripe calls Polygon's native token MATIC. It arrives as the POL balance in this wallet.",
  },
  { id: 'usdc-polygon', currency: 'usdc', network: 'polygon', asset: 'USDC', networkLabel: 'Polygon', family: 'evm' },
  { id: 'sol-solana', currency: 'sol', network: 'solana', asset: 'SOL', networkLabel: 'Solana', family: 'solana' },
  { id: 'usdc-solana', currency: 'usdc', network: 'solana', asset: 'USDC', networkLabel: 'Solana', family: 'solana' },
];

const DEFAULT_BY_CHAIN: Record<number, string> = {
  1: 'eth-ethereum',
  8453: 'eth-base',
  137: 'matic-polygon',
};

export function findOnrampOffer(currency: string, network: string): OnrampOffer | undefined {
  return ONRAMP_OFFERS.find((offer) => offer.currency === currency && offer.network === network);
}

export function offersForWallet(solanaEnabled: boolean): readonly OnrampOffer[] {
  return ONRAMP_OFFERS.filter((offer) => offer.family === 'evm' || solanaEnabled);
}

export function initialOffer(offers: readonly OnrampOffer[], chainId: number): OnrampOffer {
  const preferred = DEFAULT_BY_CHAIN[chainId] ?? 'eth-ethereum';
  const match = offers.find((offer) => offer.id === preferred) ?? offers[0];
  if (!match) {
    throw new Error('No onramp assets are available.');
  }
  return match;
}

export function assetChoices(offers: readonly OnrampOffer[]): string[] {
  const assets: string[] = [];
  for (const offer of offers) {
    if (!assets.includes(offer.asset)) {
      assets.push(offer.asset);
    }
  }
  return assets;
}

export function offersForAsset(offers: readonly OnrampOffer[], asset: string): OnrampOffer[] {
  return offers.filter((offer) => offer.asset === asset);
}

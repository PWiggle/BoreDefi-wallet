import type { EmbeddedCurrency, EmbeddedNetwork } from '../wallet/onramp/embedded';

export type EmbeddedOnrampProps = {
  publishableKey: string;
  endpoint: string;
  appToken: string | null;
  vercelBypass: string | null;
  currency: EmbeddedCurrency;
  network: EmbeddedNetwork;
  walletAddress: string;
  assetLabel: string;
  networkLabel: string;
};

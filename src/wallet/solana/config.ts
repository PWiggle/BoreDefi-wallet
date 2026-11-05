/**
 * Solana off switch. Default OFF in release builds until Patrick approves Solana for the stores.
 *
 *  - EXPO_PUBLIC_SOLANA=1  turns it on in any build (e.g. an internal proof build).
 *  - EXPO_PUBLIC_SOLANA=0  forces it off, even in dev.
 *  - unset                 on only in __DEV__ (Metro dev builds), off in every release/store build.
 *
 * Expo only inlines literal `process.env.EXPO_PUBLIC_*` reads, so each one below is read literally.
 */
const BUILD_SOLANA_FLAG: string | undefined = process.env.EXPO_PUBLIC_SOLANA;
const BUILD_SOLANA_CLUSTER: string | undefined = process.env.EXPO_PUBLIC_SOLANA_CLUSTER;
/** Optional custom RPC (e.g. a Helius free-tier URL). EXPO_PUBLIC_* is bundled into the app: use a domain-locked key. */
const BUILD_SOLANA_RPC_URL: string | undefined = process.env.EXPO_PUBLIC_SOLANA_RPC_URL;

declare const __DEV__: boolean | undefined;

export function solanaEnabled(flag: string | undefined, dev: boolean): boolean {
  const value = flag?.trim();
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  return dev;
}

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const SOLANA_ENABLED = solanaEnabled(BUILD_SOLANA_FLAG, IS_DEV);

export type SolanaCluster = 'mainnet-beta' | 'devnet';

export function solanaCluster(value: string | undefined): SolanaCluster {
  return value?.trim() === 'devnet' ? 'devnet' : 'mainnet-beta';
}

export const SOLANA_CLUSTER: SolanaCluster = solanaCluster(BUILD_SOLANA_CLUSTER);

/** Free public endpoints only. No paid plan is used or required. */
export const PUBLIC_RPC_URLS: Record<SolanaCluster, string[]> = {
  'mainnet-beta': ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
  devnet: ['https://api.devnet.solana.com'],
};

export function solanaRpcUrls(cluster: SolanaCluster, custom: string | undefined): string[] {
  const urls = [...PUBLIC_RPC_URLS[cluster]];
  const trimmed = custom?.trim();
  if (trimmed && /^https:\/\//.test(trimmed)) {
    urls.unshift(trimmed);
  }
  return urls;
}

export const SOLANA_RPC_URLS = solanaRpcUrls(SOLANA_CLUSTER, BUILD_SOLANA_RPC_URL);

export function explorerTxUrl(signature: string, cluster: SolanaCluster = SOLANA_CLUSTER): string {
  return `https://solscan.io/tx/${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function explorerAccountUrl(address: string, cluster: SolanaCluster = SOLANA_CLUSTER): string {
  return `https://solscan.io/account/${address}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

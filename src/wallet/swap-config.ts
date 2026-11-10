/**
 * Native in-wallet swap: where quotes come from and what fee BoreDefi expects.
 *
 * The wallet never holds a 0x or Jupiter API key and never contains the fee wallet. Quotes come from the
 * swap proxies that already run for BoredSwap (0x Swap API) and Mevvy (Jupiter Ultra). Those servers keep the
 * API keys and add the fee recipient / referral account themselves, so customer code only sees the fee in the
 * quote it gets back (and the wallet checks that fee is the one BoreDefi promises, see zerox.ts / jupiter.ts).
 *
 * Build config (Expo inlines only literal process.env.EXPO_PUBLIC_* reads):
 *  - EXPO_PUBLIC_EVM_SWAP_PROXY     base URL of a BoredSwap-compatible /api/quote (default https://boredswap.app)
 *  - EXPO_PUBLIC_SOLANA_SWAP_PROXY  base URL of a Mevvy-compatible /api/jupiter/{order,execute} (default https://mevvy.app)
 *  - EXPO_PUBLIC_NATIVE_SWAP=0      turns the native 0x / Jupiter swap off (the screen falls back to the old route)
 */
import type { ChainId } from './chains';

const BUILD_EVM_SWAP_PROXY: string | undefined = process.env.EXPO_PUBLIC_EVM_SWAP_PROXY;
const BUILD_SOLANA_SWAP_PROXY: string | undefined = process.env.EXPO_PUBLIC_SOLANA_SWAP_PROXY;
const BUILD_NATIVE_SWAP: string | undefined = process.env.EXPO_PUBLIC_NATIVE_SWAP;

export const DEFAULT_EVM_SWAP_PROXY = 'https://boredswap.app';
export const DEFAULT_SOLANA_SWAP_PROXY = 'https://mevvy.app';

/** BoreDefi's swap fee on EVM chains: 0.30%, the same as BoredSwap. */
export const BOREDEFI_SWAP_FEE_BPS = 30;
/** Jupiter referral fee on Solana: 0.5%, the same as Mevvy. */
export const JUPITER_REFERRAL_FEE_BPS = 50;

/** Chains the BoredSwap 0x proxy quotes (checked against boredswap.app/api/tokens on 2026-11-10). ApeChain is not one. */
export const ZEROX_CHAINS: ReadonlySet<ChainId> = new Set<ChainId>([1, 10, 56, 137, 8453, 42161, 43114]);

/** Default slippage for the native swap (0.5%, BoredSwap's auto default for majors). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** A proxy URL must be https (http only for localhost dev servers). Trailing slashes are dropped. */
export function proxyBase(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '10.0.2.2';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return fallback;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function nativeSwapEnabled(flag: string | undefined): boolean {
  const value = flag?.trim();
  return !(value === '0' || value === 'false');
}

export const EVM_SWAP_PROXY = proxyBase(BUILD_EVM_SWAP_PROXY, DEFAULT_EVM_SWAP_PROXY);
export const SOLANA_SWAP_PROXY = proxyBase(BUILD_SOLANA_SWAP_PROXY, DEFAULT_SOLANA_SWAP_PROXY);
export const NATIVE_SWAP_ENABLED = nativeSwapEnabled(BUILD_NATIVE_SWAP);

export function zeroExSupported(chainId: ChainId): boolean {
  return NATIVE_SWAP_ENABLED && ZEROX_CHAINS.has(chainId);
}

/** "0.30%" from 30 bps. */
export function bpsLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

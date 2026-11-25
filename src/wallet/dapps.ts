export type DappBookmark = {
  name: string;
  url: string;
  blurb: string;
};

/** In-app connect check. No longer a bookmark; reachable from Settings → Support → Test dApp connection. */
export const CONNECT_DEMO_URL = 'https://www.boredefi.com/connect';

export const BOREDEFI_SITE_URL = 'https://www.boredefi.com';
export const BOREDEFI_SUPPORT_URL = 'https://www.boredefi.com/support';

export const DAPP_BOOKMARKS: DappBookmark[] = [
  { name: 'BoreDefi', url: BOREDEFI_SITE_URL, blurb: 'Portfolio and Safety check' },
  { name: 'BoreDash', url: 'https://www.boredash.com', blurb: 'Live markets' },
  // BoredSwap (built by Mev): 0x-powered EVM swaps, 0.30% fee.
  { name: 'BoredSwap', url: 'https://boredswap.app', blurb: 'Swap and bridge' },
  { name: 'Aave', url: 'https://app.aave.com', blurb: 'Supply and borrow' },
  { name: 'Lido', url: 'https://stake.lido.fi', blurb: 'Stake ETH' },
  { name: 'Morpho', url: 'https://app.morpho.org', blurb: 'Lending' },
  // Mevvy (built by Mev): Jupiter-powered Solana swaps; signs in Phantom until in-app Solana swaps ship.
  { name: 'Mevvy', url: 'https://mevvy.app', blurb: 'Solana swaps' },
];

export const DEFAULT_BROWSER_URL = 'https://boredswap.app';

export function normalizeDappUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Enter a URL.');
  }
  if (trimmed.startsWith('wc:')) {
    return trimmed;
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^http:\/\//i.test(trimmed)) {
    // Plain http can be changed by anyone on the network. Always use the secure version.
    return `https://${trimmed.slice('http://'.length)}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/:]+:\d+/.test(trimmed)) {
    throw new Error('Only https:// web pages can be opened in the browser.');
  }
  return `https://${trimmed}`;
}

export type WebViewSchemeDecision =
  | { action: 'allow' }
  /** Plain http page: load the https:// version instead. */
  | { action: 'upgrade'; url: string }
  | { action: 'block'; reason: string };

export const INSECURE_HTTP_NOTICE =
  'This page asked for an insecure http:// link. BoreDefi opened the secure https:// version instead. ' +
  'If it does not load, the site has no secure version and is not safe to use with your wallet.';

/**
 * Which URLs the dApp WebView may load (checked after app links are handled):
 * https everywhere; http is upgraded to https at the top level and blocked in frames;
 * about:blank / about:srcdoc, blob: and data: only inside frames; javascript: and other schemes never.
 */
export function webViewSchemePolicy(raw: string | null | undefined, isTopFrame = true): WebViewSchemeDecision {
  const url = (raw ?? '').trim();
  if (!url) {
    return { action: 'allow' };
  }
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  const scheme = match?.[1]?.toLowerCase() ?? '';
  if (scheme === 'https') {
    return { action: 'allow' };
  }
  if (scheme === 'http') {
    return isTopFrame
      ? { action: 'upgrade', url: `https://${url.slice(url.indexOf('//') + 2)}` }
      : { action: 'block', reason: 'Insecure http:// frame blocked.' };
  }
  if (scheme === 'about') {
    return /^about:(blank|srcdoc)$/i.test(url) ? { action: 'allow' } : { action: 'block', reason: 'Blocked page.' };
  }
  if (scheme === 'blob' || scheme === 'data') {
    return isTopFrame
      ? { action: 'block', reason: 'Pages cannot open raw data: or blob: links as a whole page.' }
      : { action: 'allow' };
  }
  return { action: 'block', reason: `Blocked a ${scheme || 'non-web'} link.` };
}

export const READ_RPC_METHODS = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_feeHistory',
  'eth_getLogs',
]);

export const SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);

export const CONNECT_METHODS = new Set(['eth_requestAccounts', 'wallet_requestPermissions']);

export const DISCONNECT_METHODS = new Set(['wallet_revokePermissions']);

export type BrowserMethodKind =
  | 'accounts'
  | 'connect'
  | 'disconnect'
  | 'local'
  | 'read'
  | 'sign'
  | 'switch'
  | 'unsupported';

export function classifyBrowserMethod(method: string): BrowserMethodKind {
  if (method === 'eth_accounts') {
    return 'accounts';
  }
  if (CONNECT_METHODS.has(method)) {
    return 'connect';
  }
  if (DISCONNECT_METHODS.has(method)) {
    return 'disconnect';
  }
  // wallet_addEthereumChain (EIP-3085) is accepted only for chains the wallet already ships (e.g. ApeChain 0x8173):
  // the dApp's RPC / explorer URLs are never used, it just becomes a confirmed switch.
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    return 'switch';
  }
  if (method === 'eth_chainId' || method === 'net_version' || method === 'wallet_getCapabilities') {
    return 'local';
  }
  if (READ_RPC_METHODS.has(method)) {
    return 'read';
  }
  if (SIGNING_METHODS.has(method)) {
    return 'sign';
  }
  return 'unsupported';
}

/** Origin (scheme://host[:port]) of a loaded http(s) page, or null for anything else (about:blank, data:, wc:). */
export function dappOrigin(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Host shown on prompts, e.g. "www.boredefi.com" (keeps a non-default port). */
export function dappHost(raw: string | null | undefined): string | null {
  const origin = dappOrigin(raw);
  return origin ? new URL(origin).host : null;
}

/**
 * What the URL bar should show after a navigation event. Follows redirects to the page actually loaded,
 * but never overwrites what the user is typing, and ignores non-http(s) states.
 */
export function urlBarAfterNavigation(current: string, navUrl: string | null | undefined, editing: boolean): string {
  if (editing || !dappOrigin(navUrl)) {
    return current;
  }
  return navUrl as string;
}

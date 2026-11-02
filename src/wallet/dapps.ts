export type DappBookmark = {
  name: string;
  url: string;
  blurb: string;
};

export const CONNECT_DEMO_URL = 'https://www.boredefi.com/connect';

export const DAPP_BOOKMARKS: DappBookmark[] = [
  { name: 'Connect', url: CONNECT_DEMO_URL, blurb: 'BoreDefi Connect demo' },
  { name: 'BoreDash', url: 'https://www.boredash.com', blurb: 'Live markets' },
  { name: 'Uniswap', url: 'https://app.uniswap.org', blurb: 'Swap tokens' },
  { name: 'Aave', url: 'https://app.aave.com', blurb: 'Supply and borrow' },
  { name: 'Lido', url: 'https://stake.lido.fi', blurb: 'Stake ETH' },
  { name: 'Jumper', url: 'https://jumper.exchange', blurb: 'Bridge and swap' },
];

export const DEFAULT_BROWSER_URL = 'https://app.uniswap.org';

export function normalizeDappUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Enter a URL.');
  }
  if (trimmed.startsWith('wc:')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
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
  if (method === 'wallet_switchEthereumChain') {
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

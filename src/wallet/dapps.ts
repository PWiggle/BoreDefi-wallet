export type DappBookmark = {
  name: string;
  url: string;
  blurb: string;
};

export const DAPP_BOOKMARKS: DappBookmark[] = [
  { name: 'CoinGecko', url: 'https://www.coingecko.com', blurb: 'Live markets' },
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

export type BrowserMethodKind =
  | 'accounts'
  | 'connect'
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

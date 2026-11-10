/**
 * Where a WalletConnect pairing link came from, and which BoreDefi account a session uses.
 * Pure helpers so the proposal sheet logic can be unit tested.
 */

/**
 * Known wallets: link schemes, universal-link hosts, and store listings (used when the app isn't
 * installed, so a tap never just does nothing). App Store ids checked against itunes lookup.
 */
const WALLET_LINKS: { name: string; schemes: string[]; hosts: string[]; appStoreId?: string; androidPackage?: string }[] = [
  { name: 'MetaMask', schemes: ['metamask'], hosts: ['metamask.app.link'], appStoreId: '1438144202', androidPackage: 'io.metamask' },
  { name: 'Trust Wallet', schemes: ['trust'], hosts: ['link.trustwallet.com'], appStoreId: '1288339409', androidPackage: 'com.wallet.crypto.trustapp' },
  { name: 'Rainbow', schemes: ['rainbow'], hosts: ['rnbwapp.com', 'rainbow.me'], appStoreId: '1457119021', androidPackage: 'me.rainbow' },
  { name: 'Coinbase Wallet', schemes: ['cbwallet'], hosts: ['go.cb-w.com', 'keys.coinbase.com'], appStoreId: '1278383455', androidPackage: 'org.toshi' },
  { name: 'Phantom', schemes: ['phantom'], hosts: ['phantom.app'], appStoreId: '1598432977', androidPackage: 'app.phantom' },
  { name: 'Zerion', schemes: ['zerion'], hosts: ['app.zerion.io', 'wallet.zerion.io'], appStoreId: '1456732565', androidPackage: 'io.zerion.android' },
  { name: 'OKX Wallet', schemes: ['okex', 'okx'], hosts: ['www.okx.com'], appStoreId: '1327268470', androidPackage: 'com.okinc.okex.gp' },
  { name: 'Uniswap Wallet', schemes: ['uniswap'], hosts: ['uniswap.org'], appStoreId: '6443944476', androidPackage: 'com.uniswap.mobile' },
  { name: 'Ledger Live', schemes: ['ledgerlive'], hosts: [], appStoreId: '1361671700', androidPackage: 'com.ledger.live' },
  { name: 'Exodus', schemes: ['exodus'], hosts: [], appStoreId: '1414384820', androidPackage: 'exodusmovement.exodus' },
  { name: 'Safe', schemes: ['safe'], hosts: [], androidPackage: 'io.gnosis.safe' },
];

/**
 * Where to send the user when a known wallet's app isn't installed: its App Store page on iOS,
 * its Play Store page on Android. Null for unknown wallets (the page's own "Get" button still works).
 */
export function walletStoreUrl(walletName: string | null | undefined, platform: 'ios' | 'android' | string): string | null {
  const wallet = WALLET_LINKS.find((item) => item.name === walletName);
  if (!wallet) {
    return null;
  }
  if (platform === 'ios') {
    return wallet.appStoreId ? `https://apps.apple.com/app/id${wallet.appStoreId}` : null;
  }
  if (platform === 'android') {
    return wallet.androidPackage ? `https://play.google.com/store/apps/details?id=${wallet.androidPackage}` : null;
  }
  return null;
}

/** https link on a known wallet's universal-link host (opens that wallet like Safari would). */
export function isKnownWalletUniversalLink(raw: string): boolean {
  const match = /^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(raw.trim());
  const host = match?.[1]?.toLowerCase() ?? '';
  const path = match?.[2] ?? '';
  if (!host) {
    return false;
  }
  if (UNIVERSAL_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return true;
  }
  // Wallet sites whose app links live under one path (the rest of the site browses in-app).
  return UNIVERSAL_LINK_PATHS.some((rule) => host === rule.host && path.toLowerCase().startsWith(rule.path));
}

/**
 * Web links the injected script hands to the wallet instead of opening a popup/new window:
 * wallet universal links, store pages, and Coinbase's popup. Kept in sync with the classifier
 * (browser-nav.ts decides what actually happens; this only stops the WebView from swallowing them).
 */
export const HANDOFF_WEB_HOSTS = [
  ...['metamask.app.link', 'link.trustwallet.com', 'rnbwapp.com', 'go.cb-w.com'],
  'keys.coinbase.com',
  'apps.apple.com',
  'itunes.apple.com',
  'play.google.com',
];

export const HANDOFF_WEB_PATHS: { host: string; path: string }[] = [
  { host: 'phantom.app', path: '/ul/' },
  { host: 'rainbow.me', path: '/wc' },
  { host: 'uniswap.org', path: '/app/wc' },
];

const UNIVERSAL_LINK_PATHS = [
  { host: 'phantom.app', path: '/ul/' },
  { host: 'rainbow.me', path: '/wc' },
  { host: 'uniswap.org', path: '/app/wc' },
];

/**
 * Hosts that exist only to open a wallet app (not websites people browse). Other wallet hosts
 * (phantom.app, uniswap.org, keys.coinbase.com, ...) load in-app unless they carry a wc: link.
 */
const UNIVERSAL_LINK_HOSTS = ['metamask.app.link', 'link.trustwallet.com', 'rnbwapp.com', 'go.cb-w.com'];

/**
 * The other wallet a page meant to open, when a WalletConnect link was addressed to it
 * (metamask://wc?uri=..., https://metamask.app.link/wc?uri=..., intent://...;scheme=trust;...).
 * Null for BoreDefi's own links (wc:, boredefi://, https://www.boredefi.com/wc).
 */
export function walletLinkSource(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!schemeMatch) {
    return null;
  }
  let scheme = schemeMatch[1].toLowerCase();
  if (scheme === 'wc' || scheme === 'boredefi') {
    return null;
  }
  if (scheme === 'intent') {
    const inner = /#Intent;(?:.*;)?scheme=([a-z][a-z0-9+.-]*)/i.exec(url);
    if (!inner) {
      return 'another wallet app';
    }
    scheme = inner[1].toLowerCase();
    if (scheme === 'wc' || scheme === 'boredefi') {
      return null;
    }
  }
  if (scheme === 'http' || scheme === 'https') {
    const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
    if (!host || host === 'boredefi.com' || host.endsWith('.boredefi.com')) {
      return null;
    }
    const known = WALLET_LINKS.find((item) => item.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    return known ? known.name : 'another wallet app';
  }
  const known = WALLET_LINKS.find((item) => item.schemes.includes(scheme));
  return known ? known.name : 'another wallet app';
}

export function sourceWalletNotice(source: string): string {
  return `You picked ${source} on this site. This connects your BoreDefi wallet instead, not ${source}. To use ${source}, open the site in the ${source} app.`;
}

/** Pairing topic of a wc: URI (wc:<topic>@2?...). */
export function pairingTopic(wcUri: string): string | null {
  const match = /^wc:([^@?]+)/i.exec(wcUri.trim());
  return match ? match[1] : null;
}

export type ConnectAccount = {
  /** EVM address (0x...). */
  address: string;
  label: string;
  /** Solana address from the same recovery phrase, if Solana is on. */
  solanaAddress: string | null;
  active: boolean;
};

/**
 * Accounts the user can connect. BoreDefi holds one recovery phrase and uses its first account
 * (m/44'/60'/0'/0/0, Solana m/44'/501'/0'/0'), so today this is the active wallet only. The
 * picker is built on this list so extra accounts show up without changing the sheet.
 */
export function connectableAccounts(input: {
  address: string | null | undefined;
  solanaAddress?: string | null;
}): ConnectAccount[] {
  if (!input.address || !/^0x[0-9a-fA-F]{40}$/.test(input.address)) {
    return [];
  }
  return [{ address: input.address, label: 'Wallet 1', solanaAddress: input.solanaAddress ?? null, active: true }];
}

/** The account to approve: the one the user picked if it is really one of theirs, else the active one. */
export function resolveConnectAccount(accounts: ConnectAccount[], picked: string | null | undefined): ConnectAccount | null {
  if (picked) {
    const match = accounts.find((item) => item.address.toLowerCase() === picked.toLowerCase());
    if (match) {
      return match;
    }
  }
  return accounts.find((item) => item.active) ?? accounts[0] ?? null;
}

/**
 * Name of a known wallet whose link the user may choose to open (custom scheme or universal-link
 * host from the list above). Null for unknown apps, intent:// links and BoreDefi's own links, so
 * an untrusted page can never get an arbitrary app launched through the "Open <wallet>" choice.
 */
export function openableWalletLink(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  if (/^intent:/i.test(url)) {
    return null;
  }
  const name = walletLinkSource(url);
  return name && WALLET_LINKS.some((item) => item.name === name) ? name : null;
}

export type HandoffTarget = 'boredefi' | 'external';

/**
 * One pairing link goes to exactly one wallet. Records the first choice for a pairing topic and
 * refuses the other target afterwards, so the same wc: URI can never be paired by BoreDefi and
 * also handed to another wallet. Returns true when the caller may proceed.
 */
export function claimHandoff(claims: Map<string, HandoffTarget>, wcUri: string, target: HandoffTarget): boolean {
  const topic = pairingTopic(wcUri);
  if (!topic) {
    return false;
  }
  const existing = claims.get(topic);
  if (existing && existing !== target) {
    return false;
  }
  claims.set(topic, target);
  return true;
}

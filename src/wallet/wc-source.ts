/**
 * Where a WalletConnect pairing link came from, and which BoreDefi account a session uses.
 * Pure helpers so the proposal sheet logic can be unit tested.
 */

/** Known wallet link prefixes (custom schemes and universal-link hosts) -> display name. */
const WALLET_LINKS: { name: string; schemes: string[]; hosts: string[] }[] = [
  { name: 'MetaMask', schemes: ['metamask'], hosts: ['metamask.app.link'] },
  { name: 'Trust Wallet', schemes: ['trust'], hosts: ['link.trustwallet.com'] },
  { name: 'Rainbow', schemes: ['rainbow'], hosts: ['rnbwapp.com', 'rainbow.me'] },
  { name: 'Coinbase Wallet', schemes: ['cbwallet'], hosts: ['go.cb-w.com', 'keys.coinbase.com'] },
  { name: 'Phantom', schemes: ['phantom'], hosts: ['phantom.app'] },
  { name: 'Zerion', schemes: ['zerion'], hosts: ['app.zerion.io', 'wallet.zerion.io'] },
  { name: 'OKX Wallet', schemes: ['okex', 'okx'], hosts: ['www.okx.com'] },
  { name: 'Uniswap Wallet', schemes: ['uniswap'], hosts: ['uniswap.org'] },
  { name: 'Ledger Live', schemes: ['ledgerlive'], hosts: [] },
  { name: 'Exodus', schemes: ['exodus'], hosts: [] },
  { name: 'Safe', schemes: ['safe'], hosts: [] },
];

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

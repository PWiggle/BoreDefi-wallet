import { CHAIN_LIST, parseChainId, type ChainId } from './chains';

export const WALLETCONNECT_METHODS = [
  'eth_accounts',
  'eth_requestAccounts',
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_getCapabilities',
  'wallet_revokePermissions',
] as const;

/**
 * Public Reown Cloud client ID used by the live BoreDefi listing.
 * Not a secret. Override with EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.
 */
export const PUBLIC_WALLETCONNECT_PROJECT_ID = 'c884e13aaa967e608946ee76f636f27b';

/** Relay allowlists this HTTPS origin. The package name is also accepted. */
export const WALLETCONNECT_RELAY_ORIGIN = 'https://boredefi.money';

export const WALLETCONNECT_EVENTS = ['accountsChanged', 'chainChanged', 'disconnect'] as const;

export function getWalletConnectProjectId(): string | null {
  const value = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return value ? value : PUBLIC_WALLETCONNECT_PROJECT_ID;
}

export function relayWebSocketOptions(
  url: string,
  options?: { headers?: Record<string, string> },
): { headers?: Record<string, string> } | undefined {
  if (!url.includes('relay.walletconnect')) {
    return options;
  }
  return {
    ...(options ?? {}),
    headers: {
      ...(options?.headers ?? {}),
      Origin: WALLETCONNECT_RELAY_ORIGIN,
    },
  };
}

export function caipChainId(chainId: ChainId): string {
  return `eip155:${chainId}`;
}

export function caipAccount(chainId: ChainId, address: string): string {
  return `eip155:${chainId}:${address}`;
}

export function parseCaipChainId(value: string): ChainId | null {
  const parts = value.split(':');
  const raw = parts.length > 1 ? parts[1] : value;
  if (!raw) {
    return null;
  }
  if (raw.startsWith('0x') || raw.startsWith('0X')) {
    return parseChainId(Number.parseInt(raw, 16));
  }
  return parseChainId(raw);
}

export function supportedCaipChains(): string[] {
  return CHAIN_LIST.map((chain) => caipChainId(chain.id));
}

export function supportedCaipAccounts(address: string): string[] {
  return CHAIN_LIST.map((chain) => caipAccount(chain.id, address));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A usable WalletConnect v2 pairing URI: wc:<topic>@2?...symKey=... */
function normalizeWc(candidate: string): string | null {
  let value = candidate.trim();
  // Accept URL-encoded forms (wc%3A..., or a once-more-encoded copy) by decoding up to twice.
  for (let i = 0; i < 2 && !/^wc:/i.test(value) && /%[0-9a-f]{2}/i.test(value); i += 1) {
    value = safeDecode(value).trim();
  }
  if (!/^wc:/i.test(value)) {
    return null;
  }
  value = `wc:${value.slice(3)}`;
  if (!value.includes('@') && !value.includes('?')) {
    return null;
  }
  if (/%[0-9a-f]{2}/i.test(value) && !/symKey=/i.test(value)) {
    value = safeDecode(value);
  }
  const body = value.slice(3);
  const topic = body.split(/[@?]/)[0];
  if (!topic) {
    return null;
  }
  return value;
}

/**
 * Pull a pairing URI out of anything a user, QR, page or deep link might hand us:
 * wc:..., WC:..., wc%3A..., boredefi://wc?uri=..., https://.../wc?uri=..., with or without
 * encoding. Parses the query by hand (React Native's URL is incomplete for custom schemes).
 */
export function extractWalletConnectUri(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const direct = normalizeWc(trimmed);
  if (direct) {
    return direct;
  }
  const q = trimmed.indexOf('?');
  if (q < 0) {
    return null;
  }
  const query = trimmed.slice(q + 1).split('#')[0];
  // uri= is normally the only/last param, and its value may itself contain unencoded & and =.
  const match = /(?:^|&)uri=(.*)$/i.exec(query);
  if (!match) {
    return null;
  }
  return normalizeWc(match[1].replace(/\+/g, '%20'));
}

export function isWalletConnectUri(raw: string): boolean {
  return extractWalletConnectUri(raw) !== null;
}

export function hexToUtf8(value: string): string {
  if (!value.startsWith('0x') && !value.startsWith('0X')) {
    return value;
  }
  try {
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) {
      return value;
    }
    const bytes = Uint8Array.from(hex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

export function pickSignMessage(params: unknown[]): string {
  const strings = params.filter((item): item is string => typeof item === 'string');
  const addressLike = strings.find((item) => /^0x[a-fA-F0-9]{40}$/.test(item));
  const message = strings.find((item) => item !== addressLike);
  if (message) {
    return message;
  }
  throw new Error('Sign request is missing a message.');
}

export function parseSwitchChainId(params: unknown[]): ChainId | null {
  const first = params[0];
  if (!first || typeof first !== 'object') {
    return null;
  }
  const chainId = (first as { chainId?: string }).chainId;
  if (!chainId) {
    return null;
  }
  return parseCaipChainId(chainId.startsWith('eip155:') ? chainId : `eip155:${chainId}`);
}

/** A WebView navigation that is a WalletConnect hand-off (wc:..., boredefi://wc...), valid or not. */
export function isWalletConnectNavigation(url: string): boolean {
  const value = (url || '').trim().toLowerCase();
  return value.startsWith('wc:') || value.startsWith('wc%3a') || value.startsWith('boredefi://wc');
}

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
  'wallet_getCapabilities',
  'wallet_revokePermissions',
] as const;

/** Public Reown Cloud client ID for the TEST-ONLY Connect demo. Not a secret. */
export const PUBLIC_TEST_WALLETCONNECT_PROJECT_ID = 'b56e18d47c72ab683b10814fe9495694';

export const WALLETCONNECT_EVENTS = ['accountsChanged', 'chainChanged', 'disconnect'] as const;

export function getWalletConnectProjectId(): string | null {
  const value = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return value ? value : PUBLIC_TEST_WALLETCONNECT_PROJECT_ID;
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

export function extractWalletConnectUri(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('wc:')) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const uri = url.searchParams.get('uri');
    if (uri?.startsWith('wc:')) {
      return decodeURIComponent(uri);
    }
  } catch {
    return null;
  }
  return null;
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

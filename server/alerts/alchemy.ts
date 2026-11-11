import { CHAINS, type ChainId } from '../../src/wallet/chains';
import { findToken } from '../../src/wallet/tokens';
import type { Transfer } from './activity';
import type { FetchLike } from './prices';

/**
 * Alchemy Notify "Address Activity" webhooks. The free plan allows 5 webhooks (one network each), so:
 *   ETH_MAINNET, BASE_MAINNET, APECHAIN_MAINNET, ARB_MAINNET, MATIC_MAINNET   (Patrick's priority order)
 * Optimism, BNB Chain and Avalanche are covered by free public-RPC polling instead (see evm-poll.ts).
 */
export const ALCHEMY_NETWORKS: Record<string, ChainId> = {
  ETH_MAINNET: 1,
  BASE_MAINNET: 8453,
  APECHAIN_MAINNET: 33139,
  ARB_MAINNET: 42161,
  MATIC_MAINNET: 137,
  // Supported by Alchemy but not in the 5 free webhooks; accepted if Patrick ever re-shuffles.
  OPT_MAINNET: 10,
  BNB_MAINNET: 56,
  AVAX_MAINNET: 43114,
};

export const ALCHEMY_FREE_PLAN_NETWORKS = ['ETH_MAINNET', 'BASE_MAINNET', 'APECHAIN_MAINNET', 'ARB_MAINNET', 'MATIC_MAINNET'] as const;
export const ALCHEMY_UPDATE_URL = 'https://dashboard.alchemy.com/api/update-webhook-addresses';

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(key: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(body)));
}

/** X-Alchemy-Signature = hex HMAC-SHA256 of the raw body with that webhook's signing key. Any configured key may match. */
export async function verifyAlchemySignature(rawBody: string, signature: string | null, signingKeys: string[]): Promise<boolean> {
  if (!signature || signingKeys.length === 0) return false;
  const wanted = signature.trim().toLowerCase();
  for (const key of signingKeys) {
    if (timingSafeEqual(await hmacSha256Hex(key, rawBody), wanted)) return true;
  }
  return false;
}

type AlchemyActivity = {
  fromAddress?: string;
  toAddress?: string;
  hash?: string;
  value?: number;
  asset?: string;
  category?: string;
  rawContract?: { address?: string; decimals?: number; rawValue?: string };
};

export type AlchemyPayload = {
  webhookId?: string;
  id?: string;
  type?: string;
  event?: { network?: string; activity?: AlchemyActivity[] };
};

/** Native + ERC-20 transfers only (NFT transfers are skipped for now). */
export function alchemyTransfers(payload: AlchemyPayload): { chainId: ChainId | null; transfers: Transfer[] } {
  const network = payload.event?.network?.toUpperCase() ?? '';
  const chainId = ALCHEMY_NETWORKS[network] ?? null;
  if (!chainId || payload.type !== 'ADDRESS_ACTIVITY') {
    return { chainId: null, transfers: [] };
  }
  const chain = CHAINS[chainId];
  const transfers: Transfer[] = [];
  for (const activity of payload.event?.activity ?? []) {
    const { fromAddress, toAddress, hash } = activity;
    const amount = Number(activity.value);
    if (!fromAddress || !toAddress || !hash || !Number.isFinite(amount)) continue;
    const category = (activity.category ?? '').toLowerCase();
    if (category === 'external' || category === 'internal') {
      transfers.push({ chainName: chain.name, chainKey: String(chainId), tx: hash, from: fromAddress, to: toAddress, symbol: chain.symbol, amount, known: true });
    } else if (category === 'token' || category === 'erc20') {
      const contract = activity.rawContract?.address ?? '';
      const token = contract ? findToken(chainId, contract) : undefined;
      transfers.push({
        chainName: chain.name,
        chainKey: String(chainId),
        tx: hash,
        from: fromAddress,
        to: toAddress,
        symbol: token?.symbol ?? (activity.asset || 'tokens').slice(0, 12),
        amount,
        known: Boolean(token && !token.native),
      });
    }
  }
  return { chainId, transfers };
}

export function diffAddresses(desired: string[], synced: string[]): { add: string[]; remove: string[] } {
  const want = new Set(desired);
  const have = new Set(synced);
  return { add: desired.filter((a) => !have.has(a)), remove: synced.filter((a) => !want.has(a)) };
}

/** PATCH the webhook's address list. Returns true on success. Never logs the token. */
export async function updateAlchemyWebhookAddresses(
  webhookId: string,
  add: string[],
  remove: string[],
  authToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(ALCHEMY_UPDATE_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Alchemy-Token': authToken },
      body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: add, addresses_to_remove: remove }),
    });
    if (!response.ok) console.warn('alchemy address update failed', response.status);
    return response.ok;
  } catch {
    console.warn('alchemy address update threw');
    return false;
  }
}

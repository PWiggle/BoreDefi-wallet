import { findKnownToken, SOL_DECIMALS } from '../../src/wallet/solana/tokens';
import type { Transfer } from './activity';
import type { FetchLike } from './prices';

/**
 * Helius "enhanced" webhook for Solana. Free plan: 1M credits/month; each delivered event costs 1 credit and
 * each address-list edit costs 100, so edits are batched (default at most once an hour).
 */
export const HELIUS_WEBHOOKS_BASE = 'https://mainnet.helius-rpc.com/v0/webhooks';
const WSOL = 'So11111111111111111111111111111111111111112';

type HeliusTx = {
  signature?: string;
  type?: string;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
  tokenTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; tokenAmount?: number; mint?: string }>;
};

export function heliusTransfers(payload: unknown): Transfer[] {
  if (!Array.isArray(payload)) return [];
  const out: Transfer[] = [];
  for (const tx of payload as HeliusTx[]) {
    const signature = tx?.signature;
    if (!signature) continue;
    for (const native of tx.nativeTransfers ?? []) {
      const lamports = Number(native.amount);
      if (!native.fromUserAccount || !native.toUserAccount || !Number.isFinite(lamports)) continue;
      out.push({
        chainName: 'Solana',
        chainKey: 'solana',
        tx: signature,
        from: native.fromUserAccount,
        to: native.toUserAccount,
        symbol: 'SOL',
        amount: lamports / 10 ** SOL_DECIMALS,
        known: true,
      });
    }
    for (const token of tx.tokenTransfers ?? []) {
      const amount = Number(token.tokenAmount);
      if (!token.fromUserAccount || !token.toUserAccount || !token.mint || !Number.isFinite(amount)) continue;
      const info = token.mint === WSOL ? { symbol: 'SOL' } : findKnownToken(token.mint, 'mainnet-beta');
      out.push({
        chainName: 'Solana',
        chainKey: 'solana',
        tx: signature,
        from: token.fromUserAccount,
        to: token.toUserAccount,
        symbol: info?.symbol ?? 'tokens',
        amount,
        known: Boolean(info),
      });
    }
  }
  return out;
}

/** Replaces the webhook's full address list (Helius has no add/remove; one edit = 100 credits). */
export async function putHeliusAddresses(
  options: { webhookId: string; apiKey: string; webhookUrl: string; authHeader: string; addresses: string[] },
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${HELIUS_WEBHOOKS_BASE}/${encodeURIComponent(options.webhookId)}?api-key=${encodeURIComponent(options.apiKey)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookURL: options.webhookUrl,
          webhookType: 'enhanced',
          transactionTypes: ['ANY'],
          accountAddresses: options.addresses,
          authHeader: options.authHeader,
        }),
      },
    );
    if (!response.ok) console.warn('helius address update failed', response.status);
    return response.ok;
  } catch {
    console.warn('helius address update threw');
    return false;
  }
}

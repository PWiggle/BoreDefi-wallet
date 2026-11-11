import { CHAINS, type ChainId } from '../../src/wallet/chains';
import { tokensForChain } from '../../src/wallet/tokens';
import type { Transfer } from './activity';
import type { SubrequestBudget } from './budget';
import type { FetchLike } from './prices';
import type { AlertsStore } from './store';

/**
 * Free fallback for EVM chains with no Alchemy webhook (free plan = 5 webhooks): Optimism, BNB Chain and
 * Avalanche by default. Every cron tick (5 min) and per chain:
 *   1 x eth_blockNumber
 *   2 x eth_getLogs per 100 watched addresses (ERC-20 Transfer to / from them, known wallet tokens only)
 *   1 x batched eth_getBalance per 100 watched addresses (native coin: alert when the balance goes up)
 * using the wallet's own free public RPC list (src/wallet/chains.ts). No account or key.
 */
export const DEFAULT_POLL_CHAIN_IDS: ChainId[] = [10, 56, 43114];
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ADDRESSES_PER_CALL = 100;
/** Never scan more than this many blocks in one tick (public RPC getLogs range limits). */
export const MAX_BLOCK_RANGE = 500;

type RpcResponse<T> = { id?: number; result?: T; error?: { message?: string } };

export function padTopic(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

export function topicAddress(topic: string | undefined): string | null {
  if (!topic || topic.length !== 66) return null;
  return `0x${topic.slice(26)}`.toLowerCase();
}

export function subrequestsPerChain(addressCount: number): number {
  const chunks = Math.max(1, Math.ceil(addressCount / ADDRESSES_PER_CALL));
  return 1 + chunks * 3;
}

async function rpc<T>(chainId: ChainId, body: unknown, fetchImpl: FetchLike, budget: SubrequestBudget): Promise<T | null> {
  // One URL per call: trying fallbacks would burn the subrequest budget. The next tick may hit the same URL;
  // rotate by minute so a dead first host is not retried forever.
  const urls = CHAINS[chainId].rpcUrls;
  const url = urls[Math.floor(Date.now() / 300_000) % urls.length] ?? urls[0];
  if (!url || !budget.take()) return null;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

type Log = { address?: string; topics?: string[]; data?: string; transactionHash?: string; logIndex?: string };

/** Polls one chain. Returns transfers to classify, or null when skipped (budget / RPC failure) so the cursor stays. */
export async function pollChain(
  chainId: ChainId,
  watched: string[],
  store: AlertsStore,
  budget: SubrequestBudget,
  fetchImpl: FetchLike = fetch,
): Promise<Transfer[] | null> {
  if (watched.length === 0) return [];
  if (budget.left < subrequestsPerChain(watched.length)) {
    console.warn('poll skipped: subrequest budget', chainId);
    return null;
  }
  const chain = CHAINS[chainId];
  const head = await rpc<RpcResponse<string>>(chainId, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, fetchImpl, budget);
  const latest = head?.result ? Number.parseInt(head.result, 16) : Number.NaN;
  if (!Number.isFinite(latest)) return null;

  const cursorKey = `poll:${chainId}:block`;
  const last = Number.parseInt((await store.getMeta(cursorKey)) ?? '', 10);
  const from = Number.isFinite(last) ? Math.max(last + 1, latest - MAX_BLOCK_RANGE) : latest;
  const tokens = tokensForChain(chainId).filter((token) => !token.native);
  const byContract = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const transfers: Transfer[] = [];

  for (let i = 0; i < watched.length; i += ADDRESSES_PER_CALL) {
    const chunk = watched.slice(i, i + ADDRESSES_PER_CALL);
    const topics = chunk.map(padTopic);

    if (tokens.length > 0 && from <= latest) {
      const range = { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}`, address: tokens.map((t) => t.address) };
      for (const topicFilter of [[TRANSFER_TOPIC, null, topics], [TRANSFER_TOPIC, topics]]) {
        const logs = await rpc<RpcResponse<Log[]>>(chainId, { jsonrpc: '2.0', id: 2, method: 'eth_getLogs', params: [{ ...range, topics: topicFilter }] }, fetchImpl, budget);
        if (!logs || logs.error || !Array.isArray(logs.result)) return null;
        for (const log of logs.result) {
          const token = byContract.get((log.address ?? '').toLowerCase());
          const fromAddr = topicAddress(log.topics?.[1]);
          const toAddr = topicAddress(log.topics?.[2]);
          if (!token || !fromAddr || !toAddr || !log.transactionHash || !log.data) continue;
          const raw = BigInt(log.data === '0x' ? '0x0' : log.data);
          transfers.push({
            chainName: chain.name,
            chainKey: String(chainId),
            tx: log.transactionHash,
            from: fromAddr,
            to: toAddr,
            symbol: token.symbol,
            amount: Number(raw) / 10 ** token.decimals,
            known: true,
          });
        }
      }
    }

    const balances = await rpc<Array<RpcResponse<string>>>(
      chainId,
      chunk.map((address, index) => ({ jsonrpc: '2.0', id: index, method: 'eth_getBalance', params: [address, 'latest'] })),
      fetchImpl,
      budget,
    );
    if (!Array.isArray(balances)) return null;
    for (const entry of balances) {
      const address = typeof entry.id === 'number' ? chunk[entry.id] : undefined;
      if (!address || !entry.result) continue;
      const now = BigInt(entry.result);
      const key = `bal:${chainId}:${address}`;
      const stored = await store.getMeta(key);
      if (stored !== now.toString()) {
        await store.setMeta(key, now.toString());
      }
      if (stored !== null && now > BigInt(stored)) {
        transfers.push({
          chainName: chain.name,
          chainKey: String(chainId),
          // Not a real tx hash: one balance bump per address per block range.
          tx: `balance:${address}:${latest}`,
          from: 'balance-change',
          to: address,
          symbol: chain.symbol,
          amount: Number(now - BigInt(stored)) / 1e18,
          known: true,
        });
      }
    }
  }
  await store.setMeta(cursorKey, String(latest));
  return transfers;
}

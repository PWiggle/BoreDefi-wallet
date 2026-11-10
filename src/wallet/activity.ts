import { logger } from '../logger';
import { alchemyEnabledFor, fetchAlchemyActivity, getAlchemyKey } from './alchemy';
import { CHAINS, type ChainId } from './chains';

export type ActivityItem = {
  hash: string;
  from: string;
  to: string;
  valueWei: bigint;
  timestamp: number;
  inbound: boolean;
  status: 'success' | 'failed';
};

type BlockscoutTx = {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  txreceipt_status?: string;
  isError?: string;
};

export async function fetchActivity(
  address: string,
  chainId: ChainId,
  offset = 25,
  alchemyKey: string | null = getAlchemyKey(),
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityItem[]> {
  if (alchemyKey && alchemyEnabledFor(chainId, alchemyKey)) {
    try {
      return await fetchAlchemyActivity(address, chainId, alchemyKey, offset, fetchImpl as never);
    } catch (error) {
      logger.warn('Alchemy activity failed, using Blockscout', {
        chainId,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return fetchBlockscoutActivity(address, chainId, offset, fetchImpl);
}

export async function fetchBlockscoutActivity(
  address: string,
  chainId: ChainId,
  offset = 25,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityItem[]> {
  const url = new URL(CHAINS[chainId].activityUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', String(offset));

  try {
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { status?: string; result?: BlockscoutTx[] | string };
    if (!Array.isArray(body.result)) {
      return [];
    }
    const lower = address.toLowerCase();
    return body.result.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      valueWei: BigInt(tx.value || '0'),
      timestamp: Number(tx.timeStamp),
      inbound: tx.to?.toLowerCase() === lower,
      status: tx.txreceipt_status === '0' || tx.isError === '1' ? 'failed' : 'success',
    }));
  } catch (error) {
    logger.error('Activity request failed', {
      chainId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new Error('Could not load activity.');
  }
}

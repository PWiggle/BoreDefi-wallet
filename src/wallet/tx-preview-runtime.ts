import { Interface } from 'ethers';

import { logger } from '../logger';
import { isChainId, type ChainId } from './chains';
import { requestFingerprint } from './protected-guard';
import { getEndpointProviders } from './rpc';
import { findToken } from './tokens';
import {
  buildTxPreview,
  mergeEffects,
  NATIVE_LOG_ADDRESS,
  simCallFromTx,
  simulateCalls,
  simulationEffects,
  type RpcSend,
  type SimCall,
  type Simulation,
  type TokenLabel,
  type TxPreview,
} from './tx-simulate';
import { protectedAssetFor } from './yuga-allowlist';

/** Network side of the transaction preview: free public RPCs (eth_simulateV1), short cache, token labels. */

const CACHE_TTL_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 8_000;
const TX_METHODS = new Set(['eth_sendTransaction', 'eth_signTransaction']);

const cache = new Map<string, { simulation: Simulation; at: number }>();

function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('RPC timed out')), ms);
  });
  return Promise.race([run, limit]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function rpcSendsFor(chainId: ChainId): RpcSend[] {
  return getEndpointProviders(chainId).map(
    (provider) => (method: string, params: unknown[]) => withTimeout(provider.send(method, params), ATTEMPT_TIMEOUT_MS),
  );
}

export function isTxMethod(method: string): boolean {
  return TX_METHODS.has(method);
}

async function cached(key: string, run: () => Promise<Simulation>): Promise<Simulation> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.simulation;
  }
  const simulation = await run();
  if (simulation.kind !== 'unavailable') {
    cache.set(key, { simulation, at: Date.now() });
  }
  return simulation;
}

/** Simulates a dApp eth_sendTransaction / eth_signTransaction request. Null for signatures and unknown chains. */
export async function simulateRequest(input: {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
}): Promise<Simulation | null> {
  if (!isTxMethod(input.method) || !isChainId(input.chainId)) {
    return null;
  }
  const chainId = input.chainId;
  const key = `${chainId}:${input.owner.toLowerCase()}:${requestFingerprint(input.method, input.params)}`;
  return cached(key, () => simulateCalls(rpcSendsFor(chainId), [simCallFromTx(input.owner, input.params[0])]));
}

/** Simulates in-app calls in order (e.g. approve + swap). */
export async function simulateInAppCalls(chainId: ChainId, calls: SimCall[]): Promise<Simulation> {
  const key = `${chainId}:inapp:${requestFingerprint('inapp', calls.map((call) => ({ ...call, value: call.value?.toString() ?? null, gas: call.gas?.toString() ?? null })))}`;
  return cached(key, () => simulateCalls(rpcSendsFor(chainId), calls));
}

const META_IFACE = new Interface([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
]);

async function readString(send: RpcSend, to: string, fn: 'symbol' | 'name'): Promise<string | null> {
  try {
    const raw = (await send('eth_call', [{ to, data: META_IFACE.encodeFunctionData(fn) }, 'latest'])) as string;
    const [value] = META_IFACE.decodeFunctionResult(fn, raw);
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : null;
  } catch {
    return null;
  }
}

async function readDecimals(send: RpcSend, to: string): Promise<number | null> {
  try {
    const raw = (await send('eth_call', [{ to, data: META_IFACE.encodeFunctionData('decimals') }, 'latest'])) as string;
    const [value] = META_IFACE.decodeFunctionResult('decimals', raw);
    const decimals = Number(value);
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null;
  } catch {
    return null;
  }
}

/** Symbol / decimals / name for tokens in the preview: wallet token list first, then a few on-chain reads. */
export async function resolveTokenLabels(chainId: ChainId, simulation: Simulation | null, owner: string): Promise<Map<string, TokenLabel>> {
  const labels = new Map<string, TokenLabel>();
  const effects = mergeEffects(simulationEffects(simulation, owner));
  const unknown: { token: string; nft: boolean }[] = [];
  for (const effect of effects) {
    const token = effect.token;
    if (token.toLowerCase() === NATIVE_LOG_ADDRESS.toLowerCase() || labels.has(token.toLowerCase())) {
      continue;
    }
    const known = findToken(chainId, token);
    if (known) {
      labels.set(token.toLowerCase(), { symbol: known.symbol, decimals: known.decimals });
      continue;
    }
    if (protectedAssetFor(chainId, token)) {
      continue; // buildTxPreview names protected assets itself.
    }
    const nft = effect.standard === 'erc721' || effect.standard === 'erc1155' || (effect.type === 'approval' && effect.standard !== 'erc20');
    if (!unknown.some((item) => item.token === token)) {
      unknown.push({ token, nft });
    }
  }
  const send = rpcSendsFor(chainId)[0];
  if (!send) {
    return labels;
  }
  await Promise.all(
    unknown.slice(0, 6).map(async ({ token, nft }) => {
      const [symbol, name, decimals] = await Promise.all([
        readString(send, token, 'symbol'),
        nft ? readString(send, token, 'name') : Promise.resolve(null),
        nft ? Promise.resolve(0) : readDecimals(send, token),
      ]);
      if (symbol || name) {
        labels.set(token.toLowerCase(), { symbol: symbol ?? name!, decimals, name: name ?? undefined });
      }
    }),
  );
  return labels;
}

/** Full plain-words preview of a request. Never throws: a failure becomes an "unavailable" preview. */
export async function previewRequest(input: {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
  blind?: boolean;
}): Promise<{ preview: TxPreview; simulation: Simulation | null }> {
  let simulation: Simulation | null = null;
  let labels = new Map<string, TokenLabel>();
  try {
    simulation = await simulateRequest(input);
    if (simulation && isChainId(input.chainId)) {
      labels = await resolveTokenLabels(input.chainId, simulation, input.owner);
    }
  } catch (error) {
    logger.warn('tx preview failed', { error: String(error) });
    simulation = isTxMethod(input.method) ? { kind: 'unavailable', error: String(error), at: Date.now() } : null;
  }
  return { preview: buildTxPreview({ ...input, simulation, labels }), simulation };
}

/** Preview of in-app calls (Send / Swap). The request shown is the last call; earlier calls set up state. */
export async function previewInAppCalls(chainId: ChainId, owner: string, calls: SimCall[]): Promise<{ preview: TxPreview; simulation: Simulation }> {
  let simulation: Simulation;
  try {
    simulation = await simulateInAppCalls(chainId, calls);
  } catch (error) {
    simulation = { kind: 'unavailable', error: String(error), at: Date.now() };
  }
  const labels = await resolveTokenLabels(chainId, simulation, owner).catch(() => new Map<string, TokenLabel>());
  const last = calls[calls.length - 1];
  const params = last
    ? [{ from: last.from, to: last.to ?? undefined, value: last.value ? `0x${last.value.toString(16)}` : undefined, data: last.data ?? undefined }]
    : [];
  return { preview: buildTxPreview({ method: 'eth_sendTransaction', params, chainId, owner, simulation, labels }), simulation };
}

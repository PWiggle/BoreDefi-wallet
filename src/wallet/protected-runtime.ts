import { getAlchemyKey } from './alchemy';
import { approvalsAllowed, type ProtectedPolicy } from './protected-policy';
import { analyzeProtectedRequest, type ProtectedVerdict } from './protected-guard';
import { cachedFloorWei, fetchFloorWei } from './protected-floor';
import { loadProtectedPolicy } from './storage';
import { PROTECTED_ASSETS } from './yuga-allowlist';

const SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);

/**
 * Loads the saved policy and any needed floor prices, then runs the pure guard.
 * Used by the confirm UI and again by wc-sign right before the key signs.
 */
export async function evaluateProtectedRequest(input: {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
  policy?: ProtectedPolicy;
}): Promise<ProtectedVerdict | null> {
  if (!SIGNING_METHODS.has(input.method)) {
    return null;
  }
  const policy = input.policy ?? (await loadProtectedPolicy());
  const now = Date.now();
  const base = {
    method: input.method,
    params: input.params,
    chainId: input.chainId,
    owner: input.owner,
    approvalsAllowed: (key: string) => approvalsAllowed(policy, key, now),
  };
  // First pass with cached floors only; fetch floors for any listing it found, then re-run.
  const first = analyzeProtectedRequest({ ...base, floorWei: (key) => cachedFloorWei(key) });
  const listed = [...new Set(first.findings.filter((item) => item.action === 'listing').map((item) => item.asset.key))];
  if (!listed.length) {
    return first;
  }
  const alchemyKey = getAlchemyKey();
  const floors = new Map<string, bigint | null>();
  await Promise.all(
    listed.map(async (key) => {
      floors.set(key, await fetchFloorWei(key, alchemyKey));
    }),
  );
  return analyzeProtectedRequest({ ...base, floorWei: (key) => floors.get(key) ?? cachedFloorWei(key) });
}

export const PROTECTED_NFT_ASSETS = PROTECTED_ASSETS.filter((asset) => asset.standard !== 'ERC-20');

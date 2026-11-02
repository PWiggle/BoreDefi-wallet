import { getAddress, Interface, isAddress, zeroPadValue } from 'ethers';

import { PROTECTED_ASSETS, type ProtectedAsset } from './yuga-allowlist';

/**
 * Finds live approvals on protected (Yuga Labs / BAYC / ApeCoin) contracts and builds one-tap revokes.
 * Candidates = well-known marketplace operators + every operator/spender seen in this wallet's
 * ApprovalForAll / Approval logs (Ethereum, via the public Blockscout logs API; Alchemy's free tier only
 * allows 10-block log ranges). Each candidate is then confirmed on-chain with isApprovedForAll /
 * allowance through Multicall3, so the list only shows approvals that are live right now.
 */

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const KNOWN_OPERATORS: { address: string; label: string }[] = [
  { address: '0x1E0049783F008A0085193E00003D00cd54003c71', label: 'OpenSea conduit' },
  { address: '0x0000000000000068F116a894984e2DB1123eB395', label: 'Seaport 1.6' },
  { address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC', label: 'Seaport 1.5' },
  { address: '0x00000000000111AbE46ff893f3B2fdF1F759a8A8', label: 'Blur execution delegate' },
  { address: '0x000000000060C4Ca14CfC4325359062ace33Fe3D', label: 'LooksRare transfer manager' },
  { address: '0xF849de01B080aDC3A814FaBE1E2087475cF2E354', label: 'X2Y2 ERC-721 delegate' },
  { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Permit2' },
];

export const TOPIC_APPROVAL_FOR_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
export const TOPIC_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

const TOKEN_IFACE = new Interface([
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amount)',
]);
const MULTICALL_IFACE = new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);

export type ApprovalLog = { address: string; topics: (string | null)[] };

export type LiveApproval = {
  asset: ProtectedAsset;
  spender: string;
  spenderLabel: string;
  kind: 'operator' | 'allowance';
  allowance?: bigint;
};

function topicAddress(topic: string | null | undefined): string | null {
  if (!topic || topic.length !== 66) {
    return null;
  }
  const address = `0x${topic.slice(26)}`;
  return isAddress(address) ? getAddress(address) : null;
}

/** Operators / spenders from this wallet's logs on protected contracts (chain 1). */
export function candidatesFromLogs(logs: ApprovalLog[], chainId = 1): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const log of logs) {
    if (!log.address || !isAddress(log.address)) {
      continue;
    }
    const asset = PROTECTED_ASSETS.find(
      (item) => item.chainId === chainId && item.address.toLowerCase() === log.address.toLowerCase(),
    );
    const topic0 = (log.topics[0] ?? '').toLowerCase();
    if (!asset) {
      continue;
    }
    const isOperatorLog = topic0 === TOPIC_APPROVAL_FOR_ALL && asset.standard !== 'ERC-20';
    const isAllowanceLog = topic0 === TOPIC_APPROVAL && asset.standard === 'ERC-20';
    if (!isOperatorLog && !isAllowanceLog) {
      continue;
    }
    const spender = topicAddress(log.topics[2]);
    if (!spender) {
      continue;
    }
    const set = out.get(asset.key) ?? new Set<string>();
    set.add(spender);
    out.set(asset.key, set);
  }
  return out;
}

export type ApprovalProbe = { asset: ProtectedAsset; spender: string; callData: string };

export function buildApprovalProbes(owner: string, chainId: number, fromLogs: Map<string, Set<string>>): ApprovalProbe[] {
  const probes: ApprovalProbe[] = [];
  for (const asset of PROTECTED_ASSETS) {
    if (asset.chainId !== chainId || asset.standard === 'CryptoPunks') {
      continue; // CryptoPunks have no operator approvals.
    }
    const spenders = new Set<string>(KNOWN_OPERATORS.map((item) => item.address));
    for (const spender of fromLogs.get(asset.key) ?? []) {
      spenders.add(spender);
    }
    for (const spender of spenders) {
      const callData =
        asset.standard === 'ERC-20'
          ? TOKEN_IFACE.encodeFunctionData('allowance', [owner, spender])
          : TOKEN_IFACE.encodeFunctionData('isApprovedForAll', [owner, spender]);
      probes.push({ asset, spender, callData });
    }
  }
  return probes;
}

export function encodeProbeBatch(probes: ApprovalProbe[]): string {
  return MULTICALL_IFACE.encodeFunctionData('aggregate3', [
    probes.map((probe) => ({ target: probe.asset.address, allowFailure: true, callData: probe.callData })),
  ]);
}

export function spenderLabel(spender: string): string {
  return KNOWN_OPERATORS.find((item) => item.address === spender)?.label ?? 'Unknown contract or wallet';
}

export function decodeProbeBatch(probes: ApprovalProbe[], result: string): LiveApproval[] {
  const [rows] = MULTICALL_IFACE.decodeFunctionResult('aggregate3', result) as unknown as [{ success: boolean; returnData: string }[]];
  const live: LiveApproval[] = [];
  rows.forEach((row, index) => {
    const probe = probes[index];
    if (!probe || !row.success || row.returnData === '0x') {
      return;
    }
    try {
      if (probe.asset.standard === 'ERC-20') {
        const [allowance] = TOKEN_IFACE.decodeFunctionResult('allowance', row.returnData) as unknown as [bigint];
        if (allowance > 0n) {
          live.push({ asset: probe.asset, spender: probe.spender, spenderLabel: spenderLabel(probe.spender), kind: 'allowance', allowance });
        }
      } else {
        const [approved] = TOKEN_IFACE.decodeFunctionResult('isApprovedForAll', row.returnData) as unknown as [boolean];
        if (approved) {
          live.push({ asset: probe.asset, spender: probe.spender, spenderLabel: spenderLabel(probe.spender), kind: 'operator' });
        }
      }
    } catch {
      // Ignore undecodable rows.
    }
  });
  return live;
}

/** Calldata that removes the approval: setApprovalForAll(op, false) or approve(spender, 0). */
export function revokeCalldata(approval: Pick<LiveApproval, 'kind' | 'spender'>): string {
  return approval.kind === 'allowance'
    ? TOKEN_IFACE.encodeFunctionData('approve', [approval.spender, 0n])
    : TOKEN_IFACE.encodeFunctionData('setApprovalForAll', [approval.spender, false]);
}

export function blockscoutLogsUrl(base: string, owner: string, topic0: string): string {
  const root = base.replace(/\/api\/v2\/?$/, '');
  const ownerTopic = zeroPadValue(getAddress(owner), 32).toLowerCase();
  return `${root}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&topic0=${topic0}&topic1=${ownerTopic}&topic0_1_opr=and`;
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export async function scanProtectedApprovals(input: {
  owner: string;
  ethLogsBase: string | undefined;
  call: (chainId: number, to: string, data: string) => Promise<string>;
  fetchImpl?: FetchLike;
}): Promise<{ approvals: LiveApproval[]; logsChecked: boolean; failedChains: number[] }> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const owner = getAddress(input.owner);
  let logs: ApprovalLog[] = [];
  let logsChecked = false;
  if (input.ethLogsBase) {
    try {
      const results = await Promise.all(
        [TOPIC_APPROVAL_FOR_ALL, TOPIC_APPROVAL].map(async (topic) => {
          const response = await fetchImpl(blockscoutLogsUrl(input.ethLogsBase!, owner, topic), { headers: { Accept: 'application/json' } });
          if (!response.ok) {
            throw new Error('logs unavailable');
          }
          const body = (await response.json()) as { result?: unknown };
          return Array.isArray(body.result) ? (body.result as ApprovalLog[]) : [];
        }),
      );
      logs = results.flat();
      logsChecked = true;
    } catch {
      logsChecked = false;
    }
  }
  const fromLogs = candidatesFromLogs(logs, 1);
  const approvals: LiveApproval[] = [];
  const failedChains: number[] = [];
  for (const chainId of [1, 42161, 56]) {
    const probes = buildApprovalProbes(owner, chainId, chainId === 1 ? fromLogs : new Map());
    if (!probes.length) {
      continue;
    }
    try {
      const result = await input.call(chainId, MULTICALL3, encodeProbeBatch(probes));
      approvals.push(...decodeProbeBatch(probes, result));
    } catch {
      failedChains.push(chainId);
    }
  }
  return { approvals, logsChecked, failedChains };
}

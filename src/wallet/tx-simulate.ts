import { getAddress, Interface, isAddress, ZeroAddress } from 'ethers';

import { decodeApprovalCalldata, decodeTypedApproval } from './approval-risk';
import { CHAINS, type ChainId } from './chains';
import { formatNative, formatTokenAmount, shortenAddress } from './format';
import { KNOWN_OPERATORS } from './protected-approvals';
import type { ProtectedFinding, ProtectedVerdict } from './protected-guard';
import { protectedAssetFor, protectedNativeFor, type ProtectedAsset } from './yuga-allowlist';

/**
 * Transaction preview: every dApp / WalletConnect / Send / Swap transaction is simulated before signing with the
 * free, standard eth_simulateV1 JSON-RPC method (traceTransfers on, so native ETH/APE moves show up as logs) on the
 * chain's public RPCs. No paid simulation API. When no RPC supports it, eth_call + eth_estimateGas still tell us
 * whether it would fail, and calldata decoding fills in the rest.
 *
 * Everything below the network helpers is pure and unit-tested.
 */

export type SimCall = { from: string; to?: string | null; value?: bigint | null; data?: string | null; gas?: bigint | null };
export type SimLog = { address: string; topics: string[]; data: string };
export type SimCallResult = { ok: boolean; gasUsed: bigint | null; logs: SimLog[]; error: string | null };

export type Simulation =
  | { kind: 'simulated'; calls: SimCallResult[]; at: number }
  | { kind: 'estimated'; ok: boolean; gasUsed: bigint | null; error: string | null; at: number }
  | { kind: 'unavailable'; error: string; at: number };

export const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const TOPIC_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
export const TOPIC_APPROVAL_FOR_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
export const TOPIC_TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
export const TOPIC_TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
/** eth_simulateV1 (traceTransfers) reports native-token moves as ERC-20 Transfer logs from this address. */
export const NATIVE_LOG_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const UNLIMITED_FLOOR = 2n ** 200n;

// ---------------------------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------------------------

export type RpcSend = (method: string, params: unknown[]) => Promise<unknown>;

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function toBig(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
      return BigInt(value.trim());
    }
  } catch {
    return null;
  }
  return null;
}

function callJson(call: SimCall): Record<string, string> {
  const out: Record<string, string> = { from: call.from };
  if (call.to) {
    out.to = call.to;
  }
  if (call.value && call.value > 0n) {
    out.value = hex(call.value);
  }
  if (call.data && call.data !== '0x') {
    out.data = call.data;
  }
  if (call.gas && call.gas > 0n) {
    out.gas = hex(call.gas);
  }
  return out;
}

/** Parses an eth_simulateV1 result (one block). Throws when the shape is wrong, so the next RPC is tried. */
export function parseSimulateV1(result: unknown): SimCallResult[] {
  const block = Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : undefined;
  const calls = block && Array.isArray(block.calls) ? (block.calls as Record<string, unknown>[]) : null;
  if (!calls) {
    throw new Error('eth_simulateV1: unexpected result');
  }
  return calls.map((call) => {
    const status = toBig(call.status);
    const error = call.error && typeof call.error === 'object' ? (call.error as { message?: string }) : null;
    const logs = Array.isArray(call.logs)
      ? (call.logs as Record<string, unknown>[]).map((log) => ({
          address: String(log.address ?? ''),
          topics: Array.isArray(log.topics) ? (log.topics as unknown[]).map(String) : [],
          data: typeof log.data === 'string' ? log.data : '0x',
        }))
      : [];
    return {
      ok: status === 1n && !error,
      gasUsed: toBig(call.gasUsed),
      logs,
      error: status === 1n && !error ? null : cleanRevert(error?.message ?? 'Execution reverted'),
    };
  });
}

export function cleanRevert(message: string): string {
  const trimmed = message.replace(/^execution reverted:?\s*/i, '').trim();
  return trimmed ? trimmed.slice(0, 160) : 'Execution reverted';
}

/**
 * Simulates calls in order in one block on each RPC until one answers. Read-only: nothing is signed or sent.
 * validation:false = fees and nonces are not enforced, so an empty wallet can still preview.
 */
export async function simulateCalls(sends: RpcSend[], calls: SimCall[], now: () => number = Date.now): Promise<Simulation> {
  let lastError = 'No RPC available';
  for (const send of sends) {
    try {
      const result = await send('eth_simulateV1', [
        { blockStateCalls: [{ calls: calls.map(callJson) }], traceTransfers: true, validation: false },
        'latest',
      ]);
      return { kind: 'simulated', calls: parseSimulateV1(result), at: now() };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  // Fallback: eth_call + eth_estimateGas on the last call (earlier calls such as an approve cannot be chained here).
  const last = calls[calls.length - 1];
  if (!last) {
    return { kind: 'unavailable', error: 'Nothing to simulate', at: now() };
  }
  for (const send of sends) {
    try {
      const gas = toBig(await send('eth_estimateGas', [callJson(last)]));
      return { kind: 'estimated', ok: true, gasUsed: gas, error: null, at: now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/revert|execution|insufficient/i.test(message)) {
        return { kind: 'estimated', ok: false, gasUsed: null, error: cleanRevert(message), at: now() };
      }
      lastError = message;
    }
  }
  return { kind: 'unavailable', error: lastError, at: now() };
}

// ---------------------------------------------------------------------------------------------
// Effects (pure)
// ---------------------------------------------------------------------------------------------

export type Standard = 'native' | 'erc20' | 'erc721' | 'erc1155';

export type MoveEffect = {
  type: 'out' | 'in';
  standard: Standard;
  /** Token contract (checksummed). NATIVE_LOG_ADDRESS for the chain's native token. */
  token: string;
  amount: bigint | null;
  tokenIds: string[];
  counterparty: string;
};

export type ApprovalEffect = {
  type: 'approval';
  standard: 'erc20' | 'erc721' | 'nft-all';
  token: string;
  spender: string;
  amount: bigint | null;
  tokenId: string | null;
  revoke: boolean;
};

export type Effect = MoveEffect | ApprovalEffect;

function topicAddress(topic: string | undefined): string | null {
  if (!topic || topic.length < 42) {
    return null;
  }
  const candidate = `0x${topic.slice(-40)}`;
  return isAddress(candidate) ? getAddress(candidate) : null;
}

function word(data: string, index: number): bigint | null {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  const chunk = body.slice(index * 64, index * 64 + 64);
  if (chunk.length !== 64) {
    return null;
  }
  return BigInt(`0x${chunk}`);
}

const BATCH_IFACE = new Interface(['event X(uint256[] ids, uint256[] values)']);

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** Turns simulation logs into what leaves / arrives / gets approved for `owner`. */
export function effectsFromLogs(logs: SimLog[], owner: string): Effect[] {
  const effects: Effect[] = [];
  for (const log of logs) {
    const topic0 = (log.topics[0] ?? '').toLowerCase();
    const token = isAddress(log.address) ? getAddress(log.address) : log.address;
    const native = sameAddress(token, NATIVE_LOG_ADDRESS);
    if (topic0 === TOPIC_TRANSFER) {
      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);
      const nft = !native && log.topics.length === 4;
      const amount = nft ? 1n : word(log.data, 0);
      const tokenIds = nft ? [BigInt(log.topics[3]!).toString()] : [];
      const standard: Standard = native ? 'native' : nft ? 'erc721' : 'erc20';
      if (sameAddress(from, owner) && !sameAddress(to, owner)) {
        effects.push({ type: 'out', standard, token, amount, tokenIds, counterparty: to ?? ZeroAddress });
      } else if (sameAddress(to, owner) && !sameAddress(from, owner)) {
        effects.push({ type: 'in', standard, token, amount, tokenIds, counterparty: from ?? ZeroAddress });
      }
      continue;
    }
    if (topic0 === TOPIC_TRANSFER_SINGLE || topic0 === TOPIC_TRANSFER_BATCH) {
      const from = topicAddress(log.topics[2]);
      const to = topicAddress(log.topics[3]);
      let ids: string[] = [];
      let total: bigint | null = null;
      if (topic0 === TOPIC_TRANSFER_SINGLE) {
        const id = word(log.data, 0);
        total = word(log.data, 1);
        ids = id === null ? [] : [id.toString()];
      } else {
        try {
          const decoded = BATCH_IFACE.decodeEventLog('X', log.data, [BATCH_IFACE.getEvent('X')!.topicHash]);
          ids = (decoded[0] as bigint[]).map((item) => item.toString());
          total = (decoded[1] as bigint[]).reduce((sum, item) => sum + item, 0n);
        } catch {
          ids = [];
        }
      }
      if (sameAddress(from, owner) && !sameAddress(to, owner)) {
        effects.push({ type: 'out', standard: 'erc1155', token, amount: total, tokenIds: ids, counterparty: to ?? ZeroAddress });
      } else if (sameAddress(to, owner) && !sameAddress(from, owner)) {
        effects.push({ type: 'in', standard: 'erc1155', token, amount: total, tokenIds: ids, counterparty: from ?? ZeroAddress });
      }
      continue;
    }
    if (topic0 === TOPIC_APPROVAL && sameAddress(topicAddress(log.topics[1]), owner)) {
      const spender = topicAddress(log.topics[2]) ?? ZeroAddress;
      if (log.topics.length === 4) {
        effects.push({ type: 'approval', standard: 'erc721', token, spender, amount: null, tokenId: BigInt(log.topics[3]!).toString(), revoke: spender === ZeroAddress });
      } else {
        const amount = word(log.data, 0);
        effects.push({ type: 'approval', standard: 'erc20', token, spender, amount, tokenId: null, revoke: amount === 0n });
      }
      continue;
    }
    if (topic0 === TOPIC_APPROVAL_FOR_ALL && sameAddress(topicAddress(log.topics[1]), owner)) {
      const approved = (word(log.data, 0) ?? 0n) !== 0n;
      effects.push({ type: 'approval', standard: 'nft-all', token, spender: topicAddress(log.topics[2]) ?? ZeroAddress, amount: null, tokenId: null, revoke: !approved });
    }
  }
  // ERC-20 Approval logs emitted by transferFrom are allowance bookkeeping, not a new permission: drop them
  // when the same token also leaves the wallet in this simulation.
  return effects.filter(
    (effect) =>
      !(
        effect.type === 'approval' &&
        effect.standard === 'erc20' &&
        effects.some((other) => other.type === 'out' && sameAddress(other.token, effect.token))
      ),
  );
}

export function simulationEffects(simulation: Simulation | null, owner: string): Effect[] {
  if (!simulation || simulation.kind !== 'simulated') {
    return [];
  }
  return simulation.calls.flatMap((call) => (call.ok ? effectsFromLogs(call.logs, owner) : []));
}

// ---------------------------------------------------------------------------------------------
// Protected assets (pure)
// ---------------------------------------------------------------------------------------------

export function protectedForEffect(chainId: number, effect: Effect): ProtectedAsset | null {
  if (effect.type !== 'approval' && effect.standard === 'native') {
    return protectedNativeFor(chainId);
  }
  return protectedAssetFor(chainId, effect.token);
}

const APPROVAL_LIKE = new Set(['approval-all', 'approve', 'permit', 'permit2']);

/**
 * Adds what the simulation found to the static guard verdict. A protected asset that would leave the wallet, or be
 * approved, without the request saying so is a hidden move: it is hard-blocked unless the user opened that
 * collection's 10-minute approvals window (then it needs the red typed-name + PIN confirm like any protected move).
 * A protected asset going to a different address than the request names is always blocked.
 */
export function applySimulationToVerdict(
  verdict: ProtectedVerdict,
  effects: Effect[],
  ctx: { chainId: number; approvalsAllowed: (assetKey: string) => boolean },
): ProtectedVerdict {
  const findings: ProtectedFinding[] = [...verdict.findings];
  const blockReasons = [...verdict.blockReasons];
  const lines: string[] = [];
  let hidden: ProtectedFinding | null = null;
  for (const effect of effects) {
    if (effect.type === 'in' || (effect.type === 'approval' && effect.revoke)) {
      continue;
    }
    const asset = protectedForEffect(ctx.chainId, effect);
    if (!asset) {
      continue;
    }
    const known = verdict.findings.filter((item) => item.asset.key === asset.key && item.action !== 'revoke');
    const what = describeEffect(effect, { chainId: ctx.chainId, labels: new Map() }).text;
    if (effect.type === 'out') {
      const named = known.filter((item) => item.action === 'transfer' && item.counterparty);
      if (named.length && !named.some((item) => sameAddress(item.counterparty, effect.counterparty))) {
        blockReasons.push(
          `The preview shows your ${asset.name} going to ${effect.counterparty}, not the address this request names. Blocked.`,
        );
        continue;
      }
    }
    const coveredByRequest =
      effect.type === 'approval' ? known.some((item) => APPROVAL_LIKE.has(item.action)) : known.length > 0;
    if (coveredByRequest) {
      continue;
    }
    const finding: ProtectedFinding = {
      asset,
      action: effect.type === 'approval' ? (effect.standard === 'nft-all' ? 'approval-all' : 'approve') : 'transfer',
      counterparty: effect.type === 'approval' ? effect.spender : effect.counterparty,
      tokenIds: effect.type === 'approval' ? (effect.tokenId ? [effect.tokenId] : []) : effect.tokenIds,
      detail: `Preview: ${what}`,
    };
    findings.push(finding);
    hidden = hidden ?? finding;
    lines.push(`The transaction preview found this hidden move: ${what}. The request itself does not show it.`);
    if (!ctx.approvalsAllowed(asset.key)) {
      blockReasons.push(
        `Hidden ${effect.type === 'approval' ? 'approval' : 'transfer'} of your ${asset.name}: ${what}. Blocked. If you started this yourself, allow approvals for ${asset.name} in Settings → Protected collections (it turns itself off after 10 minutes) and try again.`,
      );
    }
  }
  if (findings.length === verdict.findings.length && blockReasons.length === verdict.blockReasons.length) {
    return verdict;
  }
  const isProtected = true;
  return {
    ...verdict,
    protected: isProtected,
    findings,
    blocked: blockReasons.length > 0,
    blockReasons: [...new Set(blockReasons)],
    confirmPhrase: verdict.protected ? verdict.confirmPhrase : (hidden?.asset.name ?? verdict.confirmPhrase),
    headline: hidden && !verdict.protected ? `${hidden.asset.name}: hidden move found by the preview` : verdict.headline,
    lines: [...lines, ...verdict.lines.filter((line) => !lines.includes(line))],
  };
}

// ---------------------------------------------------------------------------------------------
// Plain-words preview (pure)
// ---------------------------------------------------------------------------------------------

export type TokenLabel = { symbol: string; decimals: number | null; name?: string };
export type PreviewTone = 'out' | 'in' | 'approval' | 'revoke' | 'info' | 'danger';
export type PreviewLine = { tone: PreviewTone; text: string };

export type TxPreview = {
  status: 'simulated' | 'estimated' | 'signature' | 'unavailable';
  willFail: boolean;
  failReason: string | null;
  lines: PreviewLine[];
  /** Gas the simulation used (sum over calls), for the fee estimate. */
  gasUsed: bigint | null;
  note: string;
};

function who(address: string): string {
  const known = KNOWN_OPERATORS.find((item) => sameAddress(item.address, address));
  return known ? `${known.label} (${shortenAddress(address)})` : shortenAddress(address);
}

function labelFor(chainId: number, token: string, labels: Map<string, TokenLabel>): TokenLabel {
  if (sameAddress(token, NATIVE_LOG_ADDRESS) || sameAddress(token, ZeroAddress)) {
    const chain = CHAINS[chainId as ChainId];
    return { symbol: chain?.symbol ?? 'ETH', decimals: 18 };
  }
  const known = labels.get(token.toLowerCase());
  if (known) {
    return known;
  }
  const asset = protectedAssetFor(chainId, token);
  if (asset) {
    return { symbol: asset.short, decimals: asset.standard === 'ERC-20' ? 18 : 0, name: asset.name };
  }
  return { symbol: shortenAddress(token), decimals: null };
}

function amountText(amount: bigint | null, label: TokenLabel): string {
  if (amount === null) {
    return label.symbol;
  }
  if (amount >= UNLIMITED_FLOOR) {
    return `unlimited ${label.symbol}`;
  }
  if (label.decimals === null) {
    return `${amount.toString()} units of ${label.symbol}`;
  }
  return `${formatTokenAmount(amount, label.decimals)} ${label.symbol}`;
}

function nftText(effect: MoveEffect, label: TokenLabel): string {
  const name = label.name ?? label.symbol;
  if (effect.tokenIds.length === 1) {
    return `${name} #${effect.tokenIds[0]}`;
  }
  if (effect.tokenIds.length > 1) {
    return `${effect.tokenIds.length} ${name} NFTs (#${effect.tokenIds.slice(0, 3).join(', #')}${effect.tokenIds.length > 3 ? '…' : ''})`;
  }
  return `${name} NFT`;
}

export function describeEffect(
  effect: Effect,
  ctx: { chainId: number; labels: Map<string, TokenLabel> },
): PreviewLine {
  const label = labelFor(ctx.chainId, effect.token, ctx.labels);
  if (effect.type === 'approval') {
    const name = label.name ?? label.symbol;
    if (effect.revoke) {
      return { tone: 'revoke', text: `Removes ${who(effect.spender)}'s permission over your ${name}` };
    }
    if (effect.standard === 'nft-all') {
      return { tone: 'approval', text: `${who(effect.spender)} gets permission to take ALL your ${name}` };
    }
    if (effect.standard === 'erc721') {
      return { tone: 'approval', text: `${who(effect.spender)} gets permission to take ${name} #${effect.tokenId}` };
    }
    return { tone: 'approval', text: `${who(effect.spender)} gets permission to spend ${amountText(effect.amount, label)}` };
  }
  const nft = effect.standard === 'erc721' || effect.standard === 'erc1155';
  const thing = nft ? nftText(effect, label) : amountText(effect.amount, label);
  if (effect.type === 'out') {
    return { tone: 'out', text: `You send ${thing} to ${who(effect.counterparty)}` };
  }
  return { tone: 'in', text: `You receive ${thing}` };
}

/** Merges same-token, same-direction moves so a swap reads "You send 1 ETH" once. */
export function mergeEffects(effects: Effect[]): Effect[] {
  const out: Effect[] = [];
  for (const effect of effects) {
    if (effect.type === 'approval' || effect.standard === 'erc721' || effect.standard === 'erc1155') {
      out.push(effect);
      continue;
    }
    const existing = out.find(
      (item): item is MoveEffect => item.type === effect.type && sameAddress(item.token, effect.token),
    );
    if (existing && existing.amount !== null && effect.amount !== null) {
      existing.amount += effect.amount;
    } else {
      out.push({ ...effect });
    }
  }
  return out;
}

const SIGN_METHODS = new Set(['personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4']);

function staticTxLines(chainId: number, owner: string, tx: Record<string, unknown>, labels: Map<string, TokenLabel>): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const value = toBig(tx.value) ?? 0n;
  const to = typeof tx.to === 'string' && isAddress(tx.to) ? getAddress(tx.to) : null;
  const data = typeof tx.data === 'string' ? tx.data : typeof tx.input === 'string' ? tx.input : '';
  if (value > 0n) {
    lines.push(describeEffect({ type: 'out', standard: 'native', token: NATIVE_LOG_ADDRESS, amount: value, tokenIds: [], counterparty: to ?? ZeroAddress }, { chainId, labels }));
  }
  const approval = decodeApprovalCalldata(to ?? undefined, data);
  if (approval && approval.operator && to) {
    const nftAll = approval.kind === 'setApprovalForAll';
    lines.push(
      describeEffect(
        { type: 'approval', standard: nftAll ? 'nft-all' : 'erc20', token: to, spender: approval.operator, amount: approval.unlimited ? UNLIMITED_FLOOR : null, tokenId: null, revoke: nftAll ? !approval.danger : false },
        { chainId, labels },
      ),
    );
  }
  if (!lines.length && data && data !== '0x') {
    lines.push({ tone: 'info', text: `Calls contract ${to ? shortenAddress(to) : '(new contract)'}` });
  }
  void owner;
  return lines;
}

function signatureLines(method: string, params: unknown[], blind: boolean): PreviewLine[] {
  if (method === 'personal_sign') {
    return blind
      ? [{ tone: 'danger', text: 'Signs unreadable data. It could authorize anything. Reject unless you are sure.' }]
      : [{ tone: 'info', text: 'Signs a text message. Nothing leaves your wallet and there is no fee.' }];
  }
  if (method === 'eth_sign') {
    return [{ tone: 'danger', text: 'Blind eth_sign: could approve or move anything. Reject unless you are sure.' }];
  }
  const payload = params.find((item) => typeof item === 'string' && item.trim().startsWith('{')) ?? params[1];
  const approval = decodeTypedApproval(payload);
  if (approval) {
    const spender = approval.operator ? who(approval.operator) : 'A contract';
    const token = approval.token ? shortenAddress(approval.token) : 'your tokens';
    return [
      { tone: 'approval', text: `${spender} gets permission to spend ${approval.unlimited ? 'unlimited ' : ''}${token} with this signature` },
      { tone: 'info', text: 'No fee now, but the signature can be used later to move tokens.' },
    ];
  }
  let primary = '';
  let domain = '';
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    primary = String((parsed as { primaryType?: unknown })?.primaryType ?? '');
    domain = String((parsed as { domain?: { name?: unknown } })?.domain?.name ?? '');
  } catch {
    primary = '';
  }
  if (/order/i.test(primary) || domain.toLowerCase() === 'seaport') {
    return [{ tone: 'approval', text: `Signs a marketplace order${domain ? ` (${domain})` : ''}. It can sell or buy NFTs/tokens later without asking again.` }];
  }
  return [{ tone: 'info', text: `Signs structured data${domain ? ` for ${domain}` : ''}${primary ? ` (${primary})` : ''}. Nothing moves and there is no fee.` }];
}

/** Plain-words "what would happen" for any request. Pure: the runtime supplies the simulation and token labels. */
export function buildTxPreview(input: {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
  simulation: Simulation | null;
  labels?: Map<string, TokenLabel>;
  blind?: boolean;
}): TxPreview {
  const labels = input.labels ?? new Map<string, TokenLabel>();
  const chainName = CHAINS[input.chainId as ChainId]?.name ?? `chain ${input.chainId}`;
  if (SIGN_METHODS.has(input.method)) {
    return {
      status: 'signature',
      willFail: false,
      failReason: null,
      lines: signatureLines(input.method, input.params, Boolean(input.blind)),
      gasUsed: null,
      note: 'Signature only: nothing is sent on-chain.',
    };
  }
  const tx = (input.params[0] && typeof input.params[0] === 'object' ? input.params[0] : {}) as Record<string, unknown>;
  const simulation = input.simulation;
  if (simulation?.kind === 'simulated') {
    const failed = simulation.calls.find((call) => !call.ok) ?? null;
    const effects = mergeEffects(simulationEffects(simulation, input.owner));
    const lines = effects.map((effect) => describeEffect(effect, { chainId: input.chainId, labels }));
    if (failed) {
      lines.unshift({ tone: 'danger', text: `This would fail: ${failed.error ?? 'reverted'}. Nothing would move, but a fee could still be charged.` });
    } else if (!lines.length) {
      lines.push({ tone: 'info', text: 'No tokens or NFTs move. Only the network fee is paid.' });
    }
    const gasUsed = simulation.calls.reduce<bigint | null>((sum, call) => (call.gasUsed === null || sum === null ? sum : sum + call.gasUsed), 0n);
    return {
      status: 'simulated',
      willFail: Boolean(failed),
      failReason: failed?.error ?? null,
      lines,
      gasUsed: gasUsed && gasUsed > 0n ? gasUsed : null,
      note: `Simulated on ${chainName} just now. Nothing was sent.`,
    };
  }
  const lines = staticTxLines(input.chainId, input.owner, tx, labels);
  if (simulation?.kind === 'estimated') {
    if (!simulation.ok) {
      lines.unshift({ tone: 'danger', text: `This would fail: ${simulation.error ?? 'reverted'}.` });
    }
    return {
      status: 'estimated',
      willFail: !simulation.ok,
      failReason: simulation.error,
      lines: lines.length ? lines : [{ tone: 'info', text: 'No value is sent.' }],
      gasUsed: simulation.gasUsed,
      note: 'Checked with a gas estimate (full simulation unavailable). Read the details below.',
    };
  }
  return {
    status: 'unavailable',
    willFail: false,
    failReason: null,
    lines: [{ tone: 'danger', text: 'Could not simulate this right now. Check every detail before you sign.' }, ...lines],
    gasUsed: null,
    note: simulation?.kind === 'unavailable' ? 'Preview unavailable.' : 'Not simulated.',
  };
}

/** Value of a dApp tx param as a bigint, for callers building SimCalls. */
export function simCallFromTx(owner: string, raw: unknown): SimCall {
  const tx = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const to = typeof tx.to === 'string' && isAddress(tx.to) ? getAddress(tx.to) : null;
  const data = typeof tx.data === 'string' ? tx.data : typeof tx.input === 'string' ? tx.input : null;
  const from = typeof tx.from === 'string' && isAddress(tx.from) ? getAddress(tx.from) : owner;
  return { from, to, value: toBig(tx.value), data, gas: toBig(tx.gas ?? tx.gasLimit) };
}

export function formatNativeShort(wei: bigint): string {
  return formatNative(wei, 6);
}

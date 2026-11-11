import { getAddress, Interface, isAddress, MaxUint256 } from 'ethers';

import { isProtectedNft, protectedAssetFor } from './yuga-allowlist';

const APPROVAL_IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amountOrId)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);

const UNLIMITED_FLOOR = 2n ** 200n;

export const DRAIN_APPROVAL_WARNING =
  'This site is asking to take ALL NFTs in this collection. Scammers use this.';

export type ApprovalRiskKind =
  | 'setApprovalForAll'
  | 'approve'
  | 'increaseAllowance'
  | 'permit';

export type ApprovalRisk = {
  kind: ApprovalRiskKind;
  danger: boolean;
  operator: string | null;
  token: string | null;
  unlimited: boolean;
  summary: string;
  warnings: string[];
};

function asChecksum(value: unknown): string | null {
  if (typeof value !== 'string' || !isAddress(value)) {
    return null;
  }
  return getAddress(value);
}

/** "Max" sentinels dApps use for unlimited allowances that sit below 2^200 (uint96/112/128/160 max). */
const MAX_SENTINELS = new Set([2n ** 96n - 1n, 2n ** 112n - 1n, 2n ** 128n - 1n, 2n ** 160n - 1n]);
/** In signed permits the amount is never a token id, so anything this large is effectively unlimited. */
const TYPED_UNLIMITED_FLOOR = 2n ** 96n - 1n;

function isUnlimited(value: bigint): boolean {
  return value >= UNLIMITED_FLOOR || value === MaxUint256 || MAX_SENTINELS.has(value);
}

function typedAmountUnlimited(value: unknown): boolean {
  if (value === true) return true; // DAI-style permit: allowed = true is unlimited
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return false;
  try {
    return BigInt(value) >= TYPED_UNLIMITED_FLOOR;
  } catch {
    return false;
  }
}

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_TYPES = new Set(['permitsingle', 'permitbatch', 'permittransferfrom', 'permitbatchtransferfrom', 'permitwitnesstransferfrom']);

export function isPermit2(verifyingContract: string | null | undefined, primaryType: string | null | undefined): boolean {
  return (verifyingContract ? verifyingContract.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() : false) || PERMIT2_TYPES.has((primaryType ?? '').toLowerCase());
}

function protectedCollectionName(token: string | null): string | null {
  if (!token) return null;
  for (const chainId of [1, 33139, 8453, 137, 42161, 10, 56]) {
    const asset = protectedAssetFor(chainId, token);
    if (asset && isProtectedNft(asset)) return asset.name;
  }
  return null;
}

function extraOperatorWarning(operator: string | null, expected?: string | null): string | null {
  if (!operator) {
    return 'Operator address could not be decoded. Prefer Reject.';
  }
  if (expected && isAddress(expected) && getAddress(expected) === operator) {
    return null;
  }
  return 'Operator is not the connected dApp contract. Scammers use a lookalike spender.';
}

function parseTx(params: unknown[]): { to?: string; data?: string } {
  const raw = params[0];
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const tx = raw as { to?: string; data?: string };
  return { to: tx.to, data: tx.data };
}

export function decodeApprovalCalldata(to: string | undefined, data: string | undefined): ApprovalRisk | null {
  if (!data || data === '0x' || data.length < 10) {
    return null;
  }
  const token = asChecksum(to);
  try {
    const parsed = APPROVAL_IFACE.parseTransaction({ data });
    if (!parsed) {
      return null;
    }
    if (parsed.name === 'setApprovalForAll') {
      const operator = asChecksum(parsed.args[0]);
      const approved = Boolean(parsed.args[1]);
      const protectedName = protectedCollectionName(token);
      return {
        kind: 'setApprovalForAll',
        danger: approved,
        operator,
        token,
        unlimited: approved,
        summary: approved
          ? protectedName
            ? `PROTECTED COLLECTION: this site is asking to take ALL your ${protectedName} NFTs.`
            : 'This site is asking to take ALL NFTs in this collection.'
          : 'This revokes an operator for the whole collection.',
        warnings: approved
          ? [
              ...(protectedName
                ? [`${protectedName} is a protected collection. Marketplaces you trust rarely need this; scammers always ask for it. Reject unless you started a listing on the official site.`]
                : []),
              DRAIN_APPROVAL_WARNING,
              ...(extraOperatorWarning(operator) ? [extraOperatorWarning(operator)!] : []),
            ]
          : [],
      };
    }
    if (parsed.name === 'approve' || parsed.name === 'increaseAllowance' || parsed.name === 'permit') {
      const operator = asChecksum(parsed.name === 'permit' ? parsed.args[1] : parsed.args[0]);
      const amount = parsed.name === 'permit' ? BigInt(parsed.args[2]) : BigInt(parsed.args[1]);
      const unlimited = isUnlimited(amount);
      const kind: ApprovalRiskKind =
        parsed.name === 'increaseAllowance'
          ? 'increaseAllowance'
          : parsed.name === 'permit'
            ? 'permit'
            : 'approve';
      return {
        kind,
        danger: true,
        operator,
        token,
        unlimited,
        summary: unlimited
          ? 'Unlimited token/NFT approval. Scammers use this to drain the wallet.'
          : parsed.name === 'approve'
            ? 'Approve an operator for this token or NFT.'
            : 'Allowance increase or permit signature.',
        warnings: [
          unlimited
            ? DRAIN_APPROVAL_WARNING
            : 'This grants an operator. Prefer Reject unless you started this action.',
          ...(extraOperatorWarning(operator) ? [extraOperatorWarning(operator)!] : []),
        ],
      };
    }
  } catch {
    return null;
  }
  return null;
}

function readNestedSpender(value: unknown): { spender?: unknown; amount?: unknown; operator?: unknown; anyUnlimited: boolean } {
  if (!value || typeof value !== 'object') {
    return { anyUnlimited: false };
  }
  const record = value as Record<string, unknown>;
  // Permit2 PermitSingle has details {token, amount}; PermitBatch has details [{token, amount}, ...];
  // PermitTransferFrom has permitted {token, amount} or permitted [...].
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : v && typeof v === 'object' ? [v as Record<string, unknown>] : [];
  const details = list(record.details);
  const permitted = list(record.permitted);
  const nestedAmounts = [...details, ...permitted].map((d) => d.amount);
  const amount = record.value ?? record.amount ?? record.allowed ?? nestedAmounts[0];
  return {
    spender: record.spender ?? record.operator ?? details[0]?.spender,
    amount,
    operator: record.operator,
    anyUnlimited: [amount, ...nestedAmounts].some(typedAmountUnlimited),
  };
}

export function decodeTypedApproval(payload: unknown): ApprovalRisk | null {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const data = parsed as {
      primaryType?: string;
      message?: Record<string, unknown>;
      domain?: { verifyingContract?: string };
    };
    const primary = (data.primaryType ?? '').toLowerCase();
    const message = data.message ?? {};
    const nested = readNestedSpender(message);
    const operator = asChecksum(nested.spender ?? nested.operator);
    const token = asChecksum(data.domain?.verifyingContract);
    const unlimited = nested.anyUnlimited;
    const looksPermit =
      primary.includes('permit') ||
      Boolean(message.spender) ||
      Boolean(message.operator) ||
      Boolean((message.details as { spender?: unknown } | undefined)?.spender) ||
      Boolean(message.permitted);
    if (!looksPermit && !operator) {
      return null;
    }
    if (!operator && !unlimited) {
      return null;
    }
    const permit2 = isPermit2(token, data.primaryType);
    return {
      kind: 'permit',
      danger: true,
      operator,
      token,
      unlimited,
      summary: permit2
        ? 'Permit2 signature: lets a contract move your tokens with no further approval. A common drainer trick.'
        : 'Typed-data approval. This can let a contract spend NFTs or tokens.',
      warnings: [
        ...(permit2 ? ['Permit2: one signature can hand over several tokens at once. Only sign on a swap you started on the official site.'] : []),
        ...(unlimited ? ['Unlimited amount.'] : []),
        DRAIN_APPROVAL_WARNING,
        ...(extraOperatorWarning(operator) ? [extraOperatorWarning(operator)!] : []),
      ],
    };
  } catch {
    return null;
  }
}

export function inspectDappApproval(method: string, params: unknown[]): ApprovalRisk | null {
  if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
    const tx = parseTx(params);
    return decodeApprovalCalldata(tx.to, tx.data);
  }
  if (
    method === 'eth_signTypedData' ||
    method === 'eth_signTypedData_v3' ||
    method === 'eth_signTypedData_v4'
  ) {
    const payload = params.find((item) => typeof item === 'string' && item.trim().startsWith('{')) ?? params[1];
    return decodeTypedApproval(payload);
  }
  return null;
}

import { getAddress, Interface, isAddress, MaxUint256 } from 'ethers';

const APPROVAL_IFACE = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address spender, uint256 amountOrId)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);

const UNLIMITED_FLOOR = 2n ** 200n;

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

function isUnlimited(value: bigint): boolean {
  return value >= UNLIMITED_FLOOR || value === MaxUint256;
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
      return {
        kind: 'setApprovalForAll',
        danger: approved,
        operator,
        token,
        unlimited: approved,
        summary: approved
          ? 'This site is asking to take ALL NFTs in this collection.'
          : 'This revokes an operator for the whole collection.',
        warnings: approved
          ? [
              'This site is asking to take ALL NFTs/tokens in this collection. Scammers use this. Prefer Reject.',
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
            ? 'This site is asking to take ALL NFTs/tokens in this collection. Scammers use this. Prefer Reject.'
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

function readNestedSpender(value: unknown): { spender?: unknown; amount?: unknown; operator?: unknown } {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const details = record.details && typeof record.details === 'object' ? (record.details as Record<string, unknown>) : {};
  return {
    spender: record.spender ?? record.operator ?? details.spender,
    amount: record.value ?? record.amount ?? record.allowed ?? details.amount,
    operator: record.operator,
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
    const amountRaw = nested.amount;
    let unlimited = false;
    if (typeof amountRaw === 'string' || typeof amountRaw === 'number' || typeof amountRaw === 'bigint') {
      try {
        unlimited = isUnlimited(BigInt(amountRaw));
      } catch {
        unlimited = false;
      }
    }
    const looksPermit =
      primary.includes('permit') ||
      Boolean(message.spender) ||
      Boolean(message.operator) ||
      Boolean((message.details as { spender?: unknown } | undefined)?.spender);
    if (!looksPermit && !operator) {
      return null;
    }
    if (!operator && !unlimited) {
      return null;
    }
    return {
      kind: 'permit',
      danger: true,
      operator,
      token,
      unlimited: unlimited || primary.includes('permit'),
      summary: 'Typed-data approval. This can let a contract spend NFTs or tokens.',
      warnings: [
        'This site is asking to take ALL NFTs/tokens in this collection. Scammers use this. Prefer Reject.',
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

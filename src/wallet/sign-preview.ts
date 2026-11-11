import { CHAINS, parseChainId } from './chains';
import { neutralizeUrls } from './security/text-safety';
import { decodeSignableMessage } from './solana/wc-solana';
import { hexToUtf8, pickSignMessage } from './wc';

/**
 * What the user is actually signing, decoded for the confirm sheet. Shared by the in-app browser and
 * the WalletConnect overlay so both show the same text: the personal_sign message, the typed-data
 * domain + fields, the Solana message, or the transaction's call data.
 */
export type SignPreviewRow = { label: string; value: string };
export type SignPreview = {
  /** One line for the sheet's "Amount" slot. */
  summary: string;
  /** Message text / typed-data fields, in order. */
  rows: SignPreviewRow[];
  warnings: string[];
  /** Could not be decoded or looks dangerous: the sheet should use its red variant. */
  danger: boolean;
};

const MESSAGE_MAX = 600;
const FIELD_MAX = 140;
const MAX_FIELDS = 14;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Non-printable bytes (other than tab / newline) mean this isn't readable text. */
function isReadableText(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text);
}

function personalSignPreview(params: unknown[]): SignPreview {
  let raw: string;
  try {
    raw = pickSignMessage(params);
  } catch {
    return {
      summary: 'Message signature',
      rows: [{ label: 'Message', value: 'This request has no message to show.' }],
      warnings: ['The site sent a signature request with no readable message. Reject it.'],
      danger: true,
    };
  }
  const text = hexToUtf8(raw);
  if (!isReadableText(text)) {
    return {
      summary: 'Message signature (not readable text)',
      rows: [{ label: 'Message (hex)', value: clip(raw, MESSAGE_MAX) }],
      warnings: ['This "message" is raw data, not text. Only sign it if you know exactly what it is.'],
      danger: true,
    };
  }
  return {
    summary: 'Message signature',
    rows: [{ label: 'Message', value: clip(neutralizeUrls(text), MESSAGE_MAX) || '(empty message)' }],
    warnings: [],
    danger: false,
  };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'string') {
    return neutralizeUrls(value);
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return neutralizeUrls(JSON.stringify(value));
  } catch {
    return '[unreadable]';
  }
}

/** Flatten typed-data message fields into "a.b[0].c: value" rows (first MAX_FIELDS). */
export function flattenTypedFields(message: unknown, prefix = '', out: SignPreviewRow[] = [], depth = 0): SignPreviewRow[] {
  if (out.length >= MAX_FIELDS) {
    return out;
  }
  if (message && typeof message === 'object' && depth < 4) {
    const entries = Array.isArray(message)
      ? message.map((v, i) => [`${prefix}[${i}]`, v] as const)
      : Object.entries(message as Record<string, unknown>).map(([k, v]) => [prefix ? `${prefix}.${k}` : k, v] as const);
    for (const [key, value] of entries) {
      if (out.length >= MAX_FIELDS) {
        break;
      }
      if (value && typeof value === 'object') {
        flattenTypedFields(value, key, out, depth + 1);
      } else {
        out.push({ label: clip(neutralizeUrls(key), 60), value: clip(stringifyValue(value), FIELD_MAX) });
      }
    }
    return out;
  }
  out.push({ label: clip(neutralizeUrls(prefix || 'value'), 60), value: clip(stringifyValue(message), FIELD_MAX) });
  return out;
}

function countLeaves(value: unknown, depth = 0): number {
  if (value && typeof value === 'object' && depth < 6) {
    return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + countLeaves(v, depth + 1), 0);
  }
  return 1;
}

function pickTypedPayload(params: unknown[]): unknown {
  const json = params.find((item) => typeof item === 'string' && item.trim().startsWith('{'));
  if (json !== undefined) {
    return json;
  }
  return params.find((item) => item && typeof item === 'object') ?? params[1];
}

function typedChainId(domain: Record<string, unknown>): number | null {
  const raw = domain.chainId;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = raw.trim().toLowerCase().startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function typedDataPreview(params: unknown[], currentChainId?: number): SignPreview {
  let parsed: { domain?: Record<string, unknown>; primaryType?: unknown; message?: Record<string, unknown> };
  try {
    const payload = pickTypedPayload(params);
    parsed = (typeof payload === 'string' ? JSON.parse(payload) : payload) as typeof parsed;
    if (!parsed || typeof parsed !== 'object' || !parsed.domain || !parsed.message) {
      throw new Error('incomplete');
    }
  } catch {
    return {
      summary: 'Typed data (could not be read)',
      rows: [],
      warnings: ['BoreDefi could not read this typed-data request, so it cannot show what you would sign. Reject it.'],
      danger: true,
    };
  }
  const domain = parsed.domain;
  const primaryType = typeof parsed.primaryType === 'string' ? neutralizeUrls(parsed.primaryType) : 'Unknown';
  const rows: SignPreviewRow[] = [];
  const warnings: string[] = [];
  let danger = false;
  if (typeof domain.name === 'string') {
    rows.push({
      label: 'Signing for',
      value: clip(neutralizeUrls(`${domain.name}${typeof domain.version === 'string' ? ` (v${domain.version})` : ''}`), FIELD_MAX),
    });
  }
  if (typeof domain.verifyingContract === 'string') {
    rows.push({ label: 'Contract', value: domain.verifyingContract });
  }
  const chainId = typedChainId(domain);
  if (chainId !== null) {
    const known = parseChainId(chainId);
    rows.push({ label: 'Signature chain', value: known ? `${CHAINS[known].name} (${chainId})` : String(chainId) });
    if (currentChainId !== undefined && chainId !== currentChainId) {
      warnings.push('This signature is for a different network than the one you are on.');
    }
  }
  rows.push({ label: 'Type', value: primaryType });
  const fields = flattenTypedFields(parsed.message);
  rows.push(...fields);
  const leaves = countLeaves(parsed.message);
  if (leaves > fields.length) {
    rows.push({ label: 'More fields', value: `${leaves - fields.length} more not shown` });
  }
  const message = parsed.message;
  const lowerType = primaryType.toLowerCase();
  const isPermit =
    lowerType.includes('permit') ||
    ('spender' in message && ('value' in message || 'amount' in message || 'details' in message));
  if (isPermit) {
    const spender = typeof message.spender === 'string' ? message.spender : 'another address';
    warnings.push(
      `Token permit: this signature lets ${spender} move your tokens without another on-chain approval. Only sign on a site you trust.`,
    );
    danger = true;
  }
  if (lowerType.includes('order') || 'offer' in message || 'consideration' in message) {
    warnings.push('Marketplace order: signing can list or sell your assets at the price shown in these fields.');
  }
  return {
    summary: `Typed data: ${primaryType}`,
    rows,
    warnings,
    danger,
  };
}

function solanaMessagePreview(params: unknown): SignPreview {
  const input = (Array.isArray(params) ? params[0] : params) as { message?: unknown } | undefined;
  if (!input || typeof input.message !== 'string') {
    return {
      summary: 'Solana message (missing)',
      rows: [],
      warnings: ['This Solana sign request has no message. Reject it.'],
      danger: true,
    };
  }
  try {
    const { text } = decodeSignableMessage(input.message);
    return {
      summary: 'Solana message signature',
      rows: [{ label: 'Message', value: clip(neutralizeUrls(text), MESSAGE_MAX) }],
      warnings: [],
      danger: false,
    };
  } catch (error) {
    return {
      summary: 'Cannot be signed',
      rows: [],
      warnings: [error instanceof Error ? error.message : 'That Solana message could not be read.'],
      danger: true,
    };
  }
}

function txDataPreview(params: unknown[]): SignPreview | null {
  const tx = params[0] as { data?: unknown; input?: unknown } | undefined;
  const data = typeof tx?.data === 'string' ? tx.data : typeof tx?.input === 'string' ? tx.input : '';
  if (!data || data === '0x') {
    return null;
  }
  const bytes = Math.max(0, (data.length - 2) / 2);
  return {
    summary: '',
    rows: [{ label: 'Contract call', value: `${data.slice(0, 10)} (${bytes} bytes of data)` }],
    warnings: [],
    danger: false,
  };
}

/**
 * Decoded preview for a signing request, or null when there's nothing extra to show.
 * `currentChainId` (EVM) flags typed data meant for another network.
 */
export function describeSignRequest(method: string, params: unknown[], currentChainId?: number): SignPreview | null {
  switch (method) {
    case 'personal_sign':
      return personalSignPreview(params);
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return typedDataPreview(params, currentChainId);
    case 'eth_sign':
      return {
        summary: 'Blocked: eth_sign',
        rows: [],
        warnings: ['eth_sign can sign anything blind, so BoreDefi never signs it.'],
        danger: true,
      };
    case 'solana_signMessage':
      return solanaMessagePreview(params);
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return txDataPreview(params);
    default:
      return null;
  }
}

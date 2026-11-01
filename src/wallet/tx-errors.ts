import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';

/**
 * Error the app wrote for people. Its message is shown as-is.
 * Anything else coming out of ethers, an RPC or a wallet is mapped by `friendlyTxError`.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export type TxErrorKind =
  | 'insufficient-funds'
  | 'rejected'
  | 'reverted'
  | 'network'
  | 'timeout'
  | 'nonce'
  | 'unknown';

type EthersLike = {
  code?: unknown;
  shortMessage?: unknown;
  message?: unknown;
  reason?: unknown;
  error?: unknown;
  info?: { error?: unknown };
};

function collect(error: unknown, depth = 0): { codes: string[]; text: string } {
  if (depth > 4 || error === null || error === undefined) {
    return { codes: [], text: '' };
  }
  if (typeof error === 'string') {
    return { codes: [], text: error };
  }
  if (typeof error !== 'object') {
    return { codes: [], text: String(error) };
  }
  const e = error as EthersLike;
  const codes = typeof e.code === 'string' ? [e.code] : typeof e.code === 'number' ? [String(e.code)] : [];
  const parts = [e.shortMessage, e.reason, e.message].filter((v): v is string => typeof v === 'string');
  const nested = [e.error, e.info?.error].map((inner) => collect(inner, depth + 1));
  return {
    codes: [...codes, ...nested.flatMap((n) => n.codes)],
    text: [...parts, ...nested.map((n) => n.text)].join(' | '),
  };
}

export function classifyTxError(error: unknown): TxErrorKind {
  const { codes, text } = collect(error);
  const lower = text.toLowerCase();
  if (codes.includes('INSUFFICIENT_FUNDS') || lower.includes('insufficient funds')) {
    return 'insufficient-funds';
  }
  if (
    codes.includes('ACTION_REJECTED') ||
    codes.includes('4001') ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected by user')
  ) {
    return 'rejected';
  }
  if (codes.includes('TIMEOUT') || lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  if (codes.includes('NONCE_EXPIRED') || codes.includes('REPLACEMENT_UNDERPRICED') || lower.includes('nonce too low')) {
    return 'nonce';
  }
  if (
    codes.includes('CALL_EXCEPTION') ||
    lower.includes('execution reverted') ||
    lower.includes('transaction reverted')
  ) {
    return 'reverted';
  }
  if (
    codes.includes('NETWORK_ERROR') ||
    codes.includes('SERVER_ERROR') ||
    codes.includes('BAD_DATA') ||
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('could not detect network')
  ) {
    return 'network';
  }
  return 'unknown';
}

/** Gas line used by every pre-flight check, e.g. "You need a little POL on Polygon to pay network fees." */
export function needGasMessage(chainId: ChainId): string {
  const chain = CHAINS[chainId];
  return `You need a little ${chain.symbol} on ${chain.name} to pay network fees.`;
}

const RAW_MARKERS = [/0x[0-9a-f]{20,}/i, /code=/i, /version=/i, /transaction=/i, /[{}[\]]/, /\(.*=.*\)/];

/** True when a message reads like plain prose rather than an ethers/RPC dump. */
export function isPlainMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 160) {
    return false;
  }
  return !RAW_MARKERS.some((pattern) => pattern.test(trimmed));
}

export function friendlyTxError(
  error: unknown,
  context: { chainId?: ChainId; fallback?: string } = {},
): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }
  switch (classifyTxError(error)) {
    case 'insufficient-funds':
      return context.chainId !== undefined
        ? `Not enough ${CHAINS[context.chainId].symbol} on ${CHAINS[context.chainId].name} for this amount plus network fees. Nothing was sent.`
        : 'Not enough funds for this amount plus network fees. Nothing was sent.';
    case 'rejected':
      return 'Request cancelled. Nothing was sent.';
    case 'reverted':
      return 'The network rejected this transaction. Nothing was sent.';
    case 'timeout':
      return 'The network took too long to answer. Check Activity before you try again.';
    case 'nonce':
      return 'Another transaction from this wallet is still pending. Wait a moment and try again.';
    case 'network':
      return 'Network problem. Check your connection and try again.';
    default: {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      if (message && isPlainMessage(message)) {
        return message;
      }
      return context.fallback ?? 'Transaction failed. Nothing was sent.';
    }
  }
}

/** Log full details for debugging (console only). Never shown in the UI. */
export function logTxError(label: string, error: unknown, extra: Record<string, unknown> = {}): void {
  const { codes, text } = collect(error);
  logger.error(label, { ...extra, kind: classifyTxError(error), codes, message: text.slice(0, 2000) });
}

/** Map + log in one step for screens and wallet helpers. */
export function toUserError(
  label: string,
  error: unknown,
  context: { chainId?: ChainId; fallback?: string } = {},
): UserFacingError {
  if (error instanceof UserFacingError) {
    return error;
  }
  logTxError(label, error, { chainId: context.chainId });
  return new UserFacingError(friendlyTxError(error, context));
}

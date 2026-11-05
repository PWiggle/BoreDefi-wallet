import { isValidSolanaAddress } from './address';

export type SolanaPaymentRequest = { address: string; amount?: string; splToken?: string };

/** Solana Pay transfer request, the format Phantom and Solflare scan. */
export function buildSolanaReceiveUri(address: string): string {
  if (!isValidSolanaAddress(address)) {
    throw new Error('Not a Solana address');
  }
  return `solana:${address}`;
}

/** Parses a raw address or a `solana:<address>?amount=&spl-token=` transfer request. */
export function parseSolanaPaymentUri(raw: string): SolanaPaymentRequest {
  const trimmed = raw.trim();
  if (isValidSolanaAddress(trimmed)) {
    return { address: trimmed };
  }
  const match = /^solana:([^?]+)(?:\?(.*))?$/i.exec(trimmed);
  if (!match) {
    throw new Error('QR code is not a Solana address');
  }
  const target = decodeURIComponent(match[1]!);
  if (/^https?:/i.test(target)) {
    throw new Error('Solana Pay transaction requests are not supported yet');
  }
  if (!isValidSolanaAddress(target)) {
    throw new Error('QR code is not a Solana address');
  }
  const params = new URLSearchParams(match[2] ?? '');
  const result: SolanaPaymentRequest = { address: target };
  const amount = params.get('amount');
  if (amount !== null) {
    if (!/^\d+(\.\d+)?$/.test(amount)) {
      throw new Error('QR code has an invalid amount');
    }
    result.amount = amount;
  }
  const splToken = params.get('spl-token');
  if (splToken !== null) {
    if (!isValidSolanaAddress(splToken)) {
      throw new Error('QR code has an invalid token');
    }
    result.splToken = splToken;
  }
  return result;
}

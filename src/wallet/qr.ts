import { getAddress, isAddress } from 'ethers';

export type PaymentRequest = {
  address: string;
  amount?: string;
  chainId?: number;
};

function queryValue(query: string, key: string): string | undefined {
  const params = new URLSearchParams(query);
  return params.get(key) ?? undefined;
}

export function coerceAddress(value: string): string {
  const candidate = value.trim();
  const looksLikeAddress = (input: string): boolean => isAddress(input);
  if (looksLikeAddress(candidate)) {
    return getAddress(candidate);
  }
  const lower = candidate.toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(lower) && looksLikeAddress(lower)) {
    return getAddress(lower);
  }
  throw new Error('QR code is not a valid Ethereum address');
}

export function parsePaymentUri(raw: string): PaymentRequest {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty QR code');
  }

  try {
    return { address: coerceAddress(trimmed) };
  } catch {
    // EIP-681 or similar
  }

  const withoutScheme = trimmed.replace(/^ethereum:/i, '');
  const [pathPart, query = ''] = withoutScheme.split('?');
  const [addressPart, chainPart] = (pathPart ?? '').split('@');
  if (!addressPart) {
    throw new Error('QR code is not a valid Ethereum address');
  }

  const value = query ? queryValue(query, 'value') ?? queryValue(query, 'amount') : undefined;
  let amount: string | undefined;
  if (value) {
    if (/^\d+$/.test(value)) {
      amount = (Number(value) / 1e18).toString();
    } else {
      amount = value;
    }
  }

  return {
    address: coerceAddress(addressPart),
    amount,
    chainId: chainPart ? Number(chainPart) : undefined,
  };
}

export function buildReceiveUri(address: string, chainId: number): string {
  return `ethereum:${address}@${chainId}`;
}

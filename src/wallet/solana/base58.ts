import { base58 } from '@scure/base';

export function encodeBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

export function decodeBase58(value: string): Uint8Array {
  return base58.decode(value);
}

import { decodeBase58, encodeBase58 } from './base58';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM = /^0x0{40}$/i;

/** 20-byte hex address. The zero address is rejected. Checksum is Stripe's job. */
export function isEvmAddress(value: string): boolean {
  if (!EVM_ADDRESS.test(value) || ZERO_EVM.test(value)) {
    return false;
  }
  return true;
}

/**
 * Canonical 32-byte base58 Solana address. All-zero bytes (the System Program id
 * written as 32 ones) are rejected: that is not a receiving wallet.
 */
export function isSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) {
    return false;
  }
  const bytes = decodeBase58(value);
  if (!bytes || bytes.length !== 32) {
    return false;
  }
  if (encodeBase58(bytes) !== value) {
    return false;
  }
  return bytes.some((byte) => byte !== 0);
}

export function addressMatchesFamily(address: string, family: 'evm' | 'solana'): boolean {
  return family === 'evm' ? isEvmAddress(address) : isSolanaAddress(address);
}

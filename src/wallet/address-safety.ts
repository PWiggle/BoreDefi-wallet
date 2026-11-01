import { getAddress, isAddress } from 'ethers';

const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;
const NON_ASCII = /[^\u0000-\u007F]/;

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, '');
}

export function checksumAddress(value: string): string | null {
  const trimmed = stripInvisible(value).trim();
  if (!isAddress(trimmed)) {
    return null;
  }
  return getAddress(trimmed);
}

export function isChecksummedAddress(value: string): boolean {
  const trimmed = value.trim();
  const checksum = checksumAddress(trimmed);
  return checksum !== null && checksum === trimmed;
}

export function addressWarnings(typed: string, clipboard?: string | null): string[] {
  const warnings: string[] = [];
  const trimmed = typed.trim();
  if (!trimmed) {
    return warnings;
  }

  if (INVISIBLE.test(typed) || trimmed !== stripInvisible(trimmed)) {
    warnings.push('This address contains hidden characters. Do not send until you retype it.');
  }
  INVISIBLE.lastIndex = 0;

  if (NON_ASCII.test(trimmed)) {
    warnings.push('This address contains lookalike (non-ASCII) characters.');
  }

  const checksum = checksumAddress(trimmed);
  if (checksum) {
    const cleaned = stripInvisible(trimmed);
    if (cleaned !== checksum) {
      warnings.push('Address is not checksummed. Confirm every character before sending.');
    }
  }

  const clip = clipboard?.trim() ?? '';
  const clipChecksum = clip ? checksumAddress(clip) : null;
  if (checksum && clipChecksum && checksum !== clipChecksum) {
    warnings.push('Clipboard address does not match the address you entered.');
  }

  return warnings;
}

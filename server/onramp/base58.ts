const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Decodes a base58 string. Returns null when a character is outside the alphabet. */
export function decodeBase58(value: string): Uint8Array | null {
  if (!value) {
    return null;
  }
  const bytes = [0];
  for (const char of value) {
    const digit = INDEX.get(char);
    if (digit === undefined) {
      return null;
    }
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') {
      break;
    }
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) {
    zeroes += 1;
  }
  const digits = [0];
  for (let i = zeroes; i < bytes.length; i += 1) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let encoded = '1'.repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += ALPHABET[digits[i] ?? 0] ?? '';
  }
  return encoded;
}

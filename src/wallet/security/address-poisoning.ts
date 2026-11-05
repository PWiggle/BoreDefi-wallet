/**
 * Address-poisoning guard. Scammers send dust from an address whose first and last characters match one you use,
 * hoping you copy it from history. Warn when a recipient matches a known address at both ends but is not identical.
 */
function normalize(address: string, evm: boolean): string {
  const trimmed = address.trim();
  return evm ? trimmed.toLowerCase().replace(/^0x/, '') : trimmed;
}

export type PoisoningMatch = { lookalikeOf: string; warning: string };

export function addressPoisoningCheck(
  recipient: string,
  known: (string | null | undefined)[],
  kind: 'evm' | 'solana',
  edge = 4,
): PoisoningMatch | null {
  const evm = kind === 'evm';
  const target = normalize(recipient, evm);
  if (target.length < edge * 2 + 2) return null;
  for (const raw of known) {
    if (!raw) continue;
    const other = normalize(raw, evm);
    if (other === target || other.length !== target.length) continue;
    if (other.slice(0, edge) === target.slice(0, edge) && other.slice(-edge) === target.slice(-edge)) {
      return {
        lookalikeOf: raw,
        warning:
          'Possible address poisoning: this address starts and ends like one you have used, but the middle is different. ' +
          'Copy the address from the real source, not from your history.',
      };
    }
  }
  return null;
}

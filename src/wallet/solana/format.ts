import { formatLamports } from './send';

/**
 * One display rule for Solana amounts everywhere (Home, Send, Activity): exact base units, trailing zeros
 * trimmed, at most 9 decimals. SOL has 9 decimals, so a balance like 0.020821639 shows in full instead of
 * being cut to 0.020821.
 */
export function formatSolanaAmount(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('Invalid decimals');
  }
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals === 0 ? '' : (value % scale).toString().padStart(decimals, '0').slice(0, 9).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function formatSol(lamports: bigint): string {
  return formatSolanaAmount(lamports, 9);
}

export { formatLamports };

import { formatEther, formatUnits, parseEther, parseUnits } from 'ethers';

export function shortenAddress(address: string): string {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatNative(wei: bigint, maxDecimals = 6): string {
  const raw = formatEther(wei);
  const [whole, fraction = ''] = raw.split('.');
  if (!fraction || maxDecimals === 0) {
    return whole ?? '0';
  }
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : (whole ?? '0');
}

export function parseAmountToWei(amount: string): bigint {
  return parseTokenAmount(amount, 18);
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const normalized = amount.trim();
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a valid amount');
  }
  if (decimals === 18) {
    return parseEther(normalized);
  }
  return parseUnits(normalized, decimals);
}

export function formatTokenAmount(raw: bigint, decimals: number, maxDecimals = 6): string {
  const value = decimals === 18 ? formatEther(raw) : formatUnits(raw, decimals);
  const [whole, fraction = ''] = value.split('.');
  if (!fraction || maxDecimals === 0) {
    return whole ?? '0';
  }
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : (whole ?? '0');
}

export function formatTimestamp(seconds: number): string {
  if (!seconds) {
    return 'Pending';
  }
  return new Date(seconds * 1000).toLocaleString();
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const format = (amount: number, suffix: string) =>
    `${sign}$${amount.toLocaleString('en-US', { maximumFractionDigits: amount >= 100 ? 0 : 2 })}${suffix}`;
  if (abs >= 1e12) {
    return format(abs / 1e12, 'T');
  }
  if (abs >= 1e9) {
    return format(abs / 1e9, 'B');
  }
  if (abs >= 1e6) {
    return format(abs / 1e6, 'M');
  }
  if (abs >= 1e3) {
    return format(abs / 1e3, 'K');
  }
  if (abs >= 1) {
    return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return `${sign}$${abs.toPrecision(3)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

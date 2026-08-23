import { formatEther, parseEther } from 'ethers';

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
  const normalized = amount.trim();
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a valid amount');
  }
  return parseEther(normalized);
}

export function formatTimestamp(seconds: number): string {
  if (!seconds) {
    return 'Pending';
  }
  return new Date(seconds * 1000).toLocaleString();
}

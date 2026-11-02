import { getAddress, isAddress } from 'ethers';

/** User settings for protected (Yuga Labs / BAYC) collections. Pure helpers; storage lives in storage.ts. */

export const APPROVAL_WINDOW_MS = 10 * 60 * 1000;

export type AddressBookEntry = { address: string; label: string };

export type ProtectedPolicy = {
  /** assetKey → epoch ms when "allow approvals" turns itself off again. */
  approvalWindows: Record<string, number>;
  addressBook: AddressBookEntry[];
  /** When on, protected NFTs can only be sent to address-book entries. */
  addressBookOnly: boolean;
  /** Checksummed addresses this wallet already sent a protected NFT to. */
  usedRecipients: string[];
};

export const DEFAULT_PROTECTED_POLICY: ProtectedPolicy = {
  approvalWindows: {},
  addressBook: [],
  addressBookOnly: false,
  usedRecipients: [],
};

export function normalizePolicy(raw: unknown): ProtectedPolicy {
  const value = raw && typeof raw === 'object' ? (raw as Partial<ProtectedPolicy>) : {};
  const windows: Record<string, number> = {};
  for (const [key, until] of Object.entries(value.approvalWindows ?? {})) {
    if (typeof until === 'number' && Number.isFinite(until)) {
      windows[key] = until;
    }
  }
  const addressBook = Array.isArray(value.addressBook)
    ? value.addressBook
        .filter((item) => item && typeof item.address === 'string' && isAddress(item.address))
        .map((item) => ({ address: getAddress(item.address), label: String(item.label ?? '').slice(0, 40) }))
    : [];
  const usedRecipients = Array.isArray(value.usedRecipients)
    ? value.usedRecipients.filter((item) => typeof item === 'string' && isAddress(item)).map((item) => getAddress(item))
    : [];
  return { approvalWindows: windows, addressBook, addressBookOnly: Boolean(value.addressBookOnly), usedRecipients };
}

export function approvalsAllowed(policy: ProtectedPolicy, assetKey: string, now = Date.now()): boolean {
  const until = policy.approvalWindows[assetKey];
  return typeof until === 'number' && until > now;
}

export function approvalWindowRemainingMs(policy: ProtectedPolicy, assetKey: string, now = Date.now()): number {
  const until = policy.approvalWindows[assetKey] ?? 0;
  return Math.max(0, until - now);
}

export function openApprovalWindow(policy: ProtectedPolicy, assetKey: string, now = Date.now()): ProtectedPolicy {
  return { ...policy, approvalWindows: { ...policy.approvalWindows, [assetKey]: now + APPROVAL_WINDOW_MS } };
}

export function closeApprovalWindow(policy: ProtectedPolicy, assetKey: string): ProtectedPolicy {
  const next = { ...policy.approvalWindows };
  delete next[assetKey];
  return { ...policy, approvalWindows: next };
}

/** Drop expired windows so nothing stays "allowed" after 10 minutes, even across restarts. */
export function pruneExpiredWindows(policy: ProtectedPolicy, now = Date.now()): ProtectedPolicy {
  const next: Record<string, number> = {};
  for (const [key, until] of Object.entries(policy.approvalWindows)) {
    if (until > now) {
      next[key] = until;
    }
  }
  return { ...policy, approvalWindows: next };
}

export type RecipientCheck = {
  allowed: boolean;
  isNew: boolean;
  inAddressBook: boolean;
  label: string | null;
  reason: string | null;
};

export function checkProtectedRecipient(policy: ProtectedPolicy, to: string): RecipientCheck {
  if (!isAddress(to)) {
    return { allowed: false, isNew: true, inAddressBook: false, label: null, reason: 'Enter a valid recipient.' };
  }
  const address = getAddress(to);
  const entry = policy.addressBook.find((item) => item.address === address) ?? null;
  const used = policy.usedRecipients.includes(address);
  if (policy.addressBookOnly && !entry) {
    return {
      allowed: false,
      isNew: !used,
      inAddressBook: false,
      label: null,
      reason: 'Address-book-only lock is on. Add this address in Settings → Protected collections first.',
    };
  }
  return { allowed: true, isNew: !entry && !used, inAddressBook: Boolean(entry), label: entry?.label ?? null, reason: null };
}

export function rememberRecipient(policy: ProtectedPolicy, to: string): ProtectedPolicy {
  const address = getAddress(to);
  if (policy.usedRecipients.includes(address)) {
    return policy;
  }
  return { ...policy, usedRecipients: [...policy.usedRecipients, address].slice(-200) };
}

export function addAddressBookEntry(policy: ProtectedPolicy, address: string, label: string): ProtectedPolicy {
  const checksum = getAddress(address);
  const rest = policy.addressBook.filter((item) => item.address !== checksum);
  return { ...policy, addressBook: [...rest, { address: checksum, label: label.trim().slice(0, 40) }] };
}

export function removeAddressBookEntry(policy: ProtectedPolicy, address: string): ProtectedPolicy {
  const checksum = getAddress(address);
  return { ...policy, addressBook: policy.addressBook.filter((item) => item.address !== checksum) };
}

/** "Check twice": the user types the last 4 characters of the full recipient address. */
export function recipientTailMatches(to: string, typed: string): boolean {
  if (!isAddress(to)) {
    return false;
  }
  const tail = getAddress(to).slice(-4).toLowerCase();
  return typed.trim().toLowerCase() === tail;
}

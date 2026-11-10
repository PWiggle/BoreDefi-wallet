import { CHAINS, parseChainId, type ChainId } from './chains';
import { checkPhishing } from './security/phishing';
import { neutralizeUrls } from './security/text-safety';
import { SOLANA_WC_CHAINS, SOLANA_WC_METHODS } from './solana/wc-solana';

/**
 * Pure helpers for the WalletConnect (Reown WalletKit) wallet side: what a session proposal asks for, how
 * trustworthy the dApp looks (Reown Verify + BoreDefi's phishing list), and how each request is routed.
 * Kept free of React Native imports so the node test runner covers them.
 */

export type VerifyStatus = 'verified' | 'unknown' | 'mismatch' | 'scam';

export type ProposalNamespace = {
  chains?: string[];
  methods?: string[];
  events?: string[];
};

export type ProposalParams = {
  proposer?: { metadata?: { name?: string; url?: string; description?: string; icons?: string[] } };
  requiredNamespaces?: Record<string, ProposalNamespace>;
  optionalNamespaces?: Record<string, ProposalNamespace>;
};

export type VerifyContext = {
  verified?: { origin?: string; validation?: string; isScam?: boolean | null; verifyUrl?: string };
};

export type ProposalSummary = {
  name: string;
  url: string;
  host: string;
  icon: string | null;
  description: string;
  verify: VerifyStatus;
  verifyLabel: string;
  /** Set when BoreDefi's phishing list or Reown Verify says never connect. */
  blockedReason: string | null;
  /** Chains the dApp asked for that BoreDefi can serve, as names. */
  chains: string[];
  /** Chains the dApp asked for that BoreDefi does not support. */
  unsupportedChains: string[];
  /** A *required* chain BoreDefi can't serve: the session can't be approved. */
  missingRequiredChains: string[];
  methods: string[];
  /** Requested methods BoreDefi will never run (eth_sign). */
  blockedMethods: string[];
  warnings: string[];
};

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Reown Verify API status for a proposal or request (verifyContext.verified). */
export function verifyStatus(context: VerifyContext | null | undefined): VerifyStatus {
  const verified = context?.verified;
  if (!verified) {
    return 'unknown';
  }
  if (verified.isScam) {
    return 'scam';
  }
  switch ((verified.validation ?? '').toUpperCase()) {
    case 'VALID':
      return 'verified';
    case 'INVALID':
      return 'mismatch';
    default:
      return 'unknown';
  }
}

export function verifyLabel(status: VerifyStatus): string {
  switch (status) {
    case 'verified':
      return 'Verified domain (Reown Verify)';
    case 'mismatch':
      return 'Domain mismatch: the request did not come from the site it claims to be';
    case 'scam':
      return 'Flagged as a scam by Reown Verify';
    default:
      return 'Unverified: Reown could not confirm this domain';
  }
}

/** Human name for a CAIP-2 chain id, or null when BoreDefi can't serve it. */
export function chainNameForCaip(caip: string, solanaEnabled: boolean): string | null {
  if (caip.startsWith('eip155:')) {
    const id = parseChainId(caip.slice('eip155:'.length));
    return id ? CHAINS[id].name : null;
  }
  if (solanaEnabled && caip.startsWith('solana:')) {
    return SOLANA_WC_CHAINS[caip] ?? null;
  }
  return null;
}

function collect(namespaces: Record<string, ProposalNamespace> | undefined): { chains: string[]; methods: string[] } {
  const chains: string[] = [];
  const methods: string[] = [];
  for (const [key, ns] of Object.entries(namespaces ?? {})) {
    // A namespace key can itself be a chain ("eip155:1") with no chains list.
    const list = ns?.chains?.length ? ns.chains : key.includes(':') ? [key] : [];
    chains.push(...list);
    methods.push(...(ns?.methods ?? []));
  }
  return { chains, methods };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function summarizeProposal(
  params: ProposalParams,
  context: VerifyContext | null | undefined,
  options: { solanaEnabled: boolean },
): ProposalSummary {
  const meta = params.proposer?.metadata ?? {};
  const url = meta.url ?? '';
  const name = neutralizeUrls(meta.name?.trim() || 'dApp');
  const icon = (meta.icons ?? []).find((item) => /^https:\/\//i.test(item)) ?? null;
  const verify = verifyStatus(context);

  // Check both the URL the dApp claims and the origin Reown saw. Either one being on the list blocks it.
  const claimed = checkPhishing(url);
  const seen = context?.verified?.origin ? checkPhishing(context.verified.origin) : { blocked: false, reason: null };
  let blockedReason: string | null = null;
  if (claimed.blocked) {
    blockedReason = claimed.reason;
  } else if (seen.blocked) {
    blockedReason = seen.reason;
  } else if (verify === 'scam') {
    blockedReason = 'Reown Verify flagged this site as a scam.';
  }

  const required = collect(params.requiredNamespaces);
  const optional = collect(params.optionalNamespaces);
  const allChains = unique([...required.chains, ...optional.chains]);
  const chains: string[] = [];
  const unsupportedChains: string[] = [];
  for (const caip of allChains) {
    const label = chainNameForCaip(caip, options.solanaEnabled);
    if (label) {
      chains.push(label);
    } else {
      unsupportedChains.push(caip);
    }
  }
  const missingRequiredChains = unique(required.chains).filter((caip) => !chainNameForCaip(caip, options.solanaEnabled));
  const methods = unique([...required.methods, ...optional.methods]);
  const blockedMethods = methods.filter((method) => routeWalletConnectRequest(method) === 'blocked');

  const warnings: string[] = [];
  if (verify === 'mismatch') {
    warnings.push('Reown Verify: this connection request did not come from the site it names. Reject unless you are sure.');
  } else if (verify === 'unknown') {
    warnings.push('Reown could not verify this domain. Only connect if you opened this site yourself.');
  }
  if (meta.url && hostOf(url) && context?.verified?.origin && hostOf(context.verified.origin) && hostOf(url) !== hostOf(context.verified.origin)) {
    warnings.push(`The dApp says it is ${hostOf(url)} but the request came from ${hostOf(context.verified.origin)}.`);
  }
  if (missingRequiredChains.length) {
    warnings.push(`This dApp requires a network BoreDefi doesn't support (${missingRequiredChains.join(', ')}).`);
  }
  if (blockedMethods.length) {
    warnings.push('It asks for eth_sign. BoreDefi never signs eth_sign requests, even after you connect.');
  }

  return {
    name,
    url,
    host: hostOf(url),
    icon,
    description: meta.description ?? '',
    verify,
    verifyLabel: verifyLabel(verify),
    blockedReason,
    chains: unique(chains),
    unsupportedChains,
    missingRequiredChains,
    methods,
    blockedMethods,
    warnings,
  };
}

export type RequestRoute =
  /** personal_sign (message signature). */
  | 'sign'
  /** EIP-712 typed data. */
  | 'typed'
  /** eth_sendTransaction / eth_signTransaction. */
  | 'send'
  /** wallet_switchEthereumChain / wallet_addEthereumChain. */
  | 'switch'
  /** Read-only answers (accounts, capabilities, revoke). No key use, no prompt. */
  | 'info'
  /** Solana signMessage / signTransaction. */
  | 'solana'
  /** Never run (raw eth_sign). */
  | 'blocked'
  | 'unsupported';

export function routeWalletConnectRequest(method: string): RequestRoute {
  switch (method) {
    case 'personal_sign':
      return 'sign';
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return 'typed';
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return 'send';
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain':
      return 'switch';
    case 'eth_accounts':
    case 'eth_requestAccounts':
    case 'wallet_getCapabilities':
    case 'wallet_revokePermissions':
      return 'info';
    case 'eth_sign':
      return 'blocked';
    default:
      return (SOLANA_WC_METHODS as readonly string[]).includes(method) ? 'solana' : 'unsupported';
  }
}

/** Any request that uses the private key needs a fresh PIN / biometric check, even while unlocked. */
export function requiresReauth(method: string): boolean {
  const route = routeWalletConnectRequest(method);
  return route === 'sign' || route === 'typed' || route === 'send' || route === 'solana';
}

/** Requests answered without asking the user (no key use, nothing leaves beyond the already-shared address). */
export function isSilentRequest(method: string): boolean {
  return routeWalletConnectRequest(method) === 'info';
}

/** The chain of a request must be one the session approved. Stops a dApp from steering signing to another chain. */
export function chainAllowedInSession(
  chainId: string | undefined,
  namespaces: Record<string, { chains?: string[]; accounts?: string[] }> | undefined,
): boolean {
  if (!chainId) {
    return false;
  }
  for (const ns of Object.values(namespaces ?? {})) {
    if (ns.chains?.includes(chainId)) {
      return true;
    }
    if (ns.accounts?.some((account) => account.startsWith(`${chainId}:`))) {
      return true;
    }
  }
  return false;
}

export function evmChainFromCaip(chainId: string | undefined): ChainId | null {
  if (!chainId?.startsWith('eip155:')) {
    return null;
  }
  return parseChainId(chainId.slice('eip155:'.length));
}

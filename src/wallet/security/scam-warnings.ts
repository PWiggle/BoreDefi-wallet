import { inspectDappApproval, type ApprovalRisk } from '../approval-risk';
import type { GoPlusClient, RiskReport } from './goplus';
import type { PhishingVerdict } from './phishing';

/**
 * What the ScamWarningSheet shows. Pure (no React Native) so the node tests cover every rule.
 * "Go back" is always the primary action; "Continue anyway" exists unless canContinue is false.
 */
export type ScamWarning = {
  kind: 'site' | 'approval' | 'eth_sign' | 'address';
  severity: 'warn' | 'danger';
  title: string;
  summary: string;
  reasons: string[];
  canContinue: boolean;
  spender?: string | null;
  token?: string | null;
};

const HASH_32 = /^0x[0-9a-fA-F]{64}$/;

/** Site warning for the in-app Browser or a WalletConnect proposal. */
export function siteWarning(
  verdict: Pick<PhishingVerdict, 'reason' | 'source' | 'canContinue'> & { host?: string | null },
  context: 'browser' | 'walletconnect',
): ScamWarning {
  const host = verdict.host ?? 'This site';
  const codeLink = verdict.source === 'code-link';
  return {
    kind: 'site',
    severity: 'danger',
    title: codeLink ? 'This link was blocked' : 'This site may be a scam',
    summary: codeLink
      ? 'It runs code or opens a local file, so BoreDefi never opens it.'
      : context === 'walletconnect'
        ? `${host} has been reported as a phishing or scam site. Connecting lets it ask you to sign things.`
        : `${host} has been reported as a phishing or scam site. Sites like this try to get you to sign away your funds.`,
    reasons: verdict.reason ? [capitalize(verdict.reason)] : [],
    canContinue: verdict.canContinue !== false && !codeLink,
  };
}

/** GoPlus phishing_site / Reown flag for a site the local lists didn't catch. */
export function remoteSiteWarning(host: string, reasons: string[], context: 'browser' | 'walletconnect'): ScamWarning {
  return siteWarning({ host, reason: reasons[0] ?? null, source: 'goplus', canContinue: true }, context);
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function approvalWarning(risk: ApprovalRisk): ScamWarning | null {
  if (!risk.danger) return null;
  if (risk.kind === 'setApprovalForAll') {
    return {
      kind: 'approval',
      severity: 'danger',
      title: 'Access to a whole NFT collection',
      summary: 'This lets another address move every NFT you own in this collection, now and later.',
      reasons: risk.warnings,
      canContinue: true,
      spender: risk.operator,
      token: risk.token,
    };
  }
  if (risk.unlimited) {
    return {
      kind: 'approval',
      severity: 'danger',
      title: 'Unlimited token approval',
      summary: risk.kind === 'permit'
        ? 'This signature lets another address spend an unlimited amount of your tokens, with no transaction for you to check later.'
        : 'This lets another address spend an unlimited amount of this token from your wallet at any time.',
      reasons: risk.warnings,
      canContinue: true,
      spender: risk.operator,
      token: risk.token,
    };
  }
  return null;
}

/**
 * Local checks only (no network): blind eth_sign of a raw hash, unlimited ERC-20 approve / increaseAllowance,
 * setApprovalForAll, and unlimited Permit / Permit2 typed data.
 */
export function localSigningWarning(method: string, params: unknown[]): ScamWarning | null {
  if (method === 'eth_sign') {
    const hash = params.find((p) => typeof p === 'string' && HASH_32.test(p));
    return {
      kind: 'eth_sign',
      severity: 'danger',
      title: 'Blind signature request',
      summary: hash
        ? 'This site wants you to sign a raw hash (eth_sign). It could be a transaction or approval you cannot see.'
        : 'This site wants a blind eth_sign signature. It could authorize something you cannot see.',
      reasons: ['BoreDefi never signs eth_sign requests. Ask the site to use a normal message or typed-data signature.'],
      canContinue: false,
    };
  }
  const risk = inspectDappApproval(method, params);
  return risk ? approvalWarning(risk) : null;
}

function mergeRemote(base: ScamWarning | null, remote: RiskReport | null, label: string, spender: string | null): ScamWarning | null {
  if (!remote || (remote.level !== 'danger' && remote.level !== 'warn')) return base;
  const reasons = remote.reasons.map((r) => `${label}: ${r}`);
  if (base) {
    return { ...base, severity: remote.level === 'danger' ? 'danger' : base.severity, reasons: [...reasons, ...base.reasons] };
  }
  if (remote.level !== 'danger') return null; // a soft GoPlus hint alone doesn't interrupt a normal request
  return {
    kind: 'address',
    severity: 'danger',
    title: 'Flagged address',
    summary: `This request involves an address that security researchers have flagged.`,
    reasons,
    canContinue: true,
    spender,
  };
}

/**
 * Local checks plus GoPlus (spender / recipient address and approval-contract checks). GoPlus failures are
 * ignored (fail open to the local result); it never throws.
 */
export async function signingWarning(input: {
  method: string;
  params: unknown[];
  chainId: number;
  client?: GoPlusClient | null;
}): Promise<ScamWarning | null> {
  const local = localSigningWarning(input.method, input.params);
  if (!input.client || input.method === 'eth_sign') return local;
  try {
    const risk = inspectDappApproval(input.method, input.params);
    const spender = risk?.operator ?? null;
    if (spender) {
      const [addr, contract] = await Promise.all([
        input.client.addressRisk(spender, input.chainId),
        risk?.danger || risk?.kind === 'approve' ? input.client.approvalSpenderRisk(spender, input.chainId) : Promise.resolve(null),
      ]);
      let out = mergeRemote(local, addr, 'Spender', spender);
      out = mergeRemote(out, contract, 'Spender', spender);
      // A limited approval to a flagged spender still gets the sheet.
      if (!out && risk && (addr?.level === 'danger' || contract?.level === 'danger')) {
        out = mergeRemote(null, addr?.level === 'danger' ? addr : contract, 'Spender', spender);
      }
      return out;
    }
    if (input.method === 'eth_sendTransaction' || input.method === 'eth_signTransaction') {
      const to = (input.params[0] as { to?: unknown } | undefined)?.to;
      if (typeof to === 'string') {
        return mergeRemote(local, await input.client.addressRisk(to, input.chainId), 'Recipient', to);
      }
    }
  } catch {
    return local;
  }
  return local;
}

/** Badge text for a token row, or null when nothing should be shown. */
export function tokenRiskLabel(report: RiskReport | null | undefined): { text: string; danger: boolean } | null {
  if (!report) return null;
  if (report.level === 'danger') return { text: `Possible scam token. ${report.reasons[0] ?? ''}`.trim(), danger: true };
  if (report.level === 'warn') return { text: `Use caution. ${report.reasons[0] ?? ''}`.trim(), danger: false };
  return null;
}

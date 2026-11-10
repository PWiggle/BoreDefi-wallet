import { useCallback, useState } from 'react';

import type { ProtectedVerdict } from '../wallet/protected-guard';
import { evaluateProtectedRequest } from '../wallet/protected-runtime';
import type { GuardRequest } from '../wallet/protected-spend';
import { ProtectedGuardSheet } from './ProtectedGuardSheet';

/**
 * In-app gate for protected Yuga Labs assets (ApeCoin). Runs the same guard as dApp requests:
 * blocked approvals only offer Reject; everything else needs the typed name and a fresh PIN / biometric.
 * Resolves true only after that, false on reject or block. Non-protected requests resolve true immediately.
 */
export function useProtectedGate(network: string) {
  const [pending, setPending] = useState<{ verdict: ProtectedVerdict; resolve: (ok: boolean) => void } | null>(null);

  const gate = useCallback(async (request: GuardRequest): Promise<boolean> => {
    const verdict = await evaluateProtectedRequest(request);
    if (!verdict?.protected) {
      return true;
    }
    return new Promise<boolean>((resolve) => setPending({ verdict, resolve }));
  }, []);

  const sheet = pending ? (
    <ProtectedGuardSheet
      verdict={pending.verdict}
      network={network}
      dapp="BoreDefi Wallet (in-app)"
      onApprove={(clearance) => {
        pending.resolve(clearance === pending.verdict.fingerprint);
        setPending(null);
      }}
      onReject={() => {
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;

  return { gate, sheet };
}

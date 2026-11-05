import { useEffect, useState } from 'react';

import type { ChainId } from '../wallet/chains';
import { estimateNetworkFee, type NetworkFee } from '../wallet/network-fee';

/** Label for a fee row: the live fee, "Estimating…" while it loads, or the fallback text. */
export function networkFeeLabel(fee: NetworkFee | null | 'loading', fallback: string, format: (fee: NetworkFee) => string): string {
  if (fee === 'loading') {
    return 'Estimating…';
  }
  return fee ? format(fee) : fallback;
}

/** Live network fee (native + $) for `gasUnits` on `chainId`. 'loading' while it loads, null when unknown. */
export function useNetworkFee(chainId: ChainId, gasUnits: bigint | null, enabled = true): NetworkFee | null | 'loading' {
  const [fee, setFee] = useState<NetworkFee | null | 'loading'>(null);
  const key = gasUnits?.toString() ?? '';
  useEffect(() => {
    let cancelled = false;
    if (!enabled || gasUnits === null || gasUnits <= 0n) {
      setFee(null);
      return;
    }
    setFee('loading');
    estimateNetworkFee(chainId, gasUnits).then((next) => {
      if (!cancelled) {
        setFee(next);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, key, enabled]);
  return fee;
}

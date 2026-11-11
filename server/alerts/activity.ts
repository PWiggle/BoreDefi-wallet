/**
 * Turns raw transfers (from Alchemy webhooks, Helius webhooks, or public-RPC polling) into user-facing
 * "Received" and "Swap finished" notifications.
 *
 * Spam rule: a plain incoming transfer only notifies for the chain's native coin or a token on the wallet's
 * own known-token list (address-poisoning and airdrop-spam tokens stay silent). A swap (the wallet sent
 * something AND received something different in the same transaction) always notifies, because the user
 * signed it.
 */

export type Transfer = {
  /** Display name, e.g. "Base" or "Solana". */
  chainName: string;
  chainKey: string;
  /** Transaction hash / signature. */
  tx: string;
  from: string;
  to: string;
  symbol: string;
  /** Human units (already divided by decimals). */
  amount: number;
  /** Native coin or a token on the wallet's known list. */
  known: boolean;
};

export type ActivityEvent = {
  /** Watched address the event is for (EVM lowercased). */
  address: string;
  kind: 'received' | 'swap';
  chainKey: string;
  tx: string;
  title: string;
  body: string;
};

export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '?';
  const abs = Math.abs(amount);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return amount.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function sameAddress(a: string, b: string, evm: boolean): boolean {
  return evm ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function classifyTransfers(transfers: Transfer[], watched: Set<string>, evm: boolean): ActivityEvent[] {
  const norm = (value: string) => (evm ? value.toLowerCase() : value);
  const byTx = new Map<string, Transfer[]>();
  for (const transfer of transfers) {
    if (!(transfer.amount > 0)) continue;
    const key = `${transfer.chainKey}:${transfer.tx}`;
    byTx.set(key, [...(byTx.get(key) ?? []), transfer]);
  }
  const events: ActivityEvent[] = [];
  for (const group of byTx.values()) {
    const first = group[0];
    if (!first) continue;
    const addresses = new Set<string>();
    for (const transfer of group) {
      if (watched.has(norm(transfer.to))) addresses.add(norm(transfer.to));
      if (watched.has(norm(transfer.from))) addresses.add(norm(transfer.from));
    }
    for (const address of addresses) {
      const ins = group.filter((t) => sameAddress(t.to, address, evm) && !sameAddress(t.from, address, evm));
      const outs = group.filter((t) => sameAddress(t.from, address, evm) && !sameAddress(t.to, address, evm));
      const inSymbols = new Set(ins.map((t) => t.symbol));
      const swapOut = outs.find((t) => !inSymbols.has(t.symbol));
      const swapIn = ins.find((t) => !outs.some((o) => o.symbol === t.symbol));
      if (swapOut && swapIn) {
        const outTotal = outs.filter((t) => t.symbol === swapOut.symbol).reduce((sum, t) => sum + t.amount, 0);
        const inTotal = ins.filter((t) => t.symbol === swapIn.symbol).reduce((sum, t) => sum + t.amount, 0);
        events.push({
          address,
          kind: 'swap',
          chainKey: first.chainKey,
          tx: first.tx,
          title: `Swap finished on ${first.chainName}`,
          body: `${formatAmount(outTotal)} ${swapOut.symbol} → ${formatAmount(inTotal)} ${swapIn.symbol}`,
        });
        continue;
      }
      if (outs.length > 0) {
        // Something the user sent themselves: no "received" ping.
        continue;
      }
      const knownIns = ins.filter((t) => t.known);
      const top = knownIns[0];
      if (!top) continue;
      const total = knownIns.filter((t) => t.symbol === top.symbol).reduce((sum, t) => sum + t.amount, 0);
      const others = new Set(knownIns.map((t) => t.symbol)).size - 1;
      events.push({
        address,
        kind: 'received',
        chainKey: first.chainKey,
        tx: first.tx,
        title: `Received ${formatAmount(total)} ${top.symbol}`,
        body: `On ${first.chainName}${others > 0 ? ` (+${others} more)` : ''}. Open BoreDefi to see it.`,
      });
    }
  }
  return events;
}

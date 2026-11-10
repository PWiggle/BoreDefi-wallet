import type { SpendBalanceLoad } from './swap';

/**
 * Error banner + spend-balance state shared by Swap and Bridge. Pure, so the rules are locked in by tests
 * (swap-regression.test.ts). Do not move this back into ad-hoc useState calls:
 * - Build 11 kept a "Network problem" banner on screen after every chain/token switch (Patrick saw it on all
 *   chains). An error belongs to the context it happened in, so a context change clears it.
 * - A balance is only accepted for the chain + token it was read for, so a slow read for the previous token
 *   can never show up (or pass the pre-flight) under the new one.
 * - A later successful read clears the balance error.
 */
export type SpendView = {
  /** Chain(s) + both tokens. Any change clears `error`. */
  errorKey: string;
  /** Chain + spent token. Any change drops the balance until it is read again. */
  balanceKey: string;
  balance: bigint | null;
  balanceError: string | null;
  error: string | null;
};

export type SpendViewAction =
  | { type: 'context'; errorKey: string; balanceKey: string }
  | { type: 'balance-loading'; balanceKey: string }
  | { type: 'balance'; balanceKey: string; result: SpendBalanceLoad }
  | { type: 'error'; message: string | null };

export function initialSpendView(errorKey: string, balanceKey: string): SpendView {
  return { errorKey, balanceKey, balance: null, balanceError: null, error: null };
}

export function spendViewReducer(state: SpendView, action: SpendViewAction): SpendView {
  switch (action.type) {
    case 'context': {
      let next = state;
      if (action.errorKey !== state.errorKey) {
        next = { ...next, errorKey: action.errorKey, error: null };
      }
      if (action.balanceKey !== state.balanceKey) {
        next = { ...next, balanceKey: action.balanceKey, balance: null, balanceError: null };
      }
      return next;
    }
    case 'balance-loading':
      return action.balanceKey === state.balanceKey ? { ...state, balance: null, balanceError: null } : state;
    case 'balance':
      if (action.balanceKey !== state.balanceKey) {
        return state; // stale read for a previous chain/token: ignored
      }
      return { ...state, balance: action.result.balance, balanceError: action.result.error };
    case 'error':
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/** The one message the red banner shows: a quote/swap error first, else a balance-load error. */
export function spendBanner(state: SpendView): string | null {
  return state.error ?? state.balanceError;
}

export function balanceKeyFor(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

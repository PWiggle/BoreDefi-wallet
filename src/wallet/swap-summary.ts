/**
 * Plain-words rows for the native swap screen and its confirm sheet: what you get, the minimum, price impact,
 * the network fee and BoreDefi's own fee. Pure, so the wording is tested.
 */
import { formatTokenAmount } from './format';
import { bpsLabel } from './swap-config';
import type { SwapQuote } from './swap';

export type SummaryRow = { label: string; value: string };

/** Above this price impact the screen shows a warning; above PRICE_IMPACT_BLOCK_PCT it refuses the swap. */
export const PRICE_IMPACT_WARN_PCT = 3;
export const PRICE_IMPACT_BLOCK_PCT = 15;

export function formatPriceImpact(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return 'Not reported';
  }
  if (pct < 0.01) {
    return '<0.01%';
  }
  return `${pct.toFixed(2)}%`;
}

export type PriceImpactCheck = { level: 'ok' | 'warn' | 'block'; message: string | null };

export function checkPriceImpact(pct: number | null | undefined): PriceImpactCheck {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct < PRICE_IMPACT_WARN_PCT) {
    return { level: 'ok', message: null };
  }
  if (pct >= PRICE_IMPACT_BLOCK_PCT) {
    return {
      level: 'block',
      message: `Price impact is ${pct.toFixed(1)}%. You would lose a lot to the trade itself, so this swap is blocked. Try a smaller amount.`,
    };
  }
  return { level: 'warn', message: `Price impact is ${pct.toFixed(1)}%. You get noticeably less than the market price. Consider a smaller amount.` };
}

export function boredefiFeeLine(feeBps: number, feeAmount: bigint, feeToken: { decimals: number; symbol: string }): string {
  if (feeBps <= 0) {
    return 'None';
  }
  const amount = feeAmount > 0n ? ` · ${formatTokenAmount(feeAmount, feeToken.decimals)} ${feeToken.symbol}` : '';
  return `${bpsLabel(feeBps)}${amount}`;
}

/** Rows shown under the quote and in the confirm sheet for a 0x quote. LI.FI quotes get only receive + minimum. */
export function swapSummaryRows(
  quote: SwapQuote,
  native: { symbol: string; decimals: number },
): SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: 'You receive (est.)', value: `${formatTokenAmount(quote.toAmount, quote.toToken.decimals)} ${quote.toToken.symbol}` },
    { label: 'Minimum received', value: `${formatTokenAmount(quote.toAmountMin, quote.toToken.decimals)} ${quote.toToken.symbol}` },
  ];
  const fees = quote.fees;
  if (!fees) {
    return rows;
  }
  rows.push({ label: 'Price impact', value: formatPriceImpact(fees.priceImpactPct) });
  rows.push({
    label: 'Network fee (est.)',
    value: fees.networkFeeWei !== null ? `${formatTokenAmount(fees.networkFeeWei, native.decimals, 6)} ${native.symbol}` : 'Shown at confirm',
  });
  rows.push({ label: 'BoreDefi fee', value: boredefiFeeLine(fees.feeBps, fees.feeAmount, fees.feeToken) });
  rows.push({ label: 'Max slippage', value: bpsLabel(fees.slippageBps) });
  return rows;
}

/**
 * After an approval the wallet fetches a fresh quote. If its minimum dropped more than this vs. the one the user
 * reviewed, the swap stops and asks for a new review instead of sending a worse trade.
 */
export const REQUOTE_TOLERANCE_BPS = 100n;

export function requoteStillFair(reviewedMin: bigint, freshMin: bigint): boolean {
  return freshMin * 10_000n >= reviewedMin * (10_000n - REQUOTE_TOLERANCE_BPS);
}

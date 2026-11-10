import { formatTokenAmount } from '../wallet/format';
import type { SwapQuote } from '../wallet/swap';
import { gasLimitDetail } from '../wallet/swap-preview';
import type { TxPreview } from '../wallet/tx-simulate';
import { ConfirmSheet, type ConfirmRow } from './ConfirmSheet';

/**
 * Confirm swap: amounts, the estimated network fee in the native token and dollars (gas x eth_feeHistory fee x price),
 * the gas limit as a small detail, and the transaction preview.
 */
export function SwapConfirmSheet({
  visible,
  network,
  fromAddress,
  quote,
  fee,
  preview,
  previewLoading,
  loading,
  confirmLabel,
  extraRows,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  network: string;
  fromAddress: string;
  quote: SwapQuote | null;
  fee: string;
  preview: TxPreview | null;
  previewLoading: boolean;
  loading: boolean;
  confirmLabel?: string;
  /** Extra rows (price impact, BoreDefi fee, minimum) for the native 0x swap. */
  extraRows?: ConfirmRow[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmSheet
      visible={visible}
      title="Confirm swap"
      network={network}
      from={fromAddress}
      to={quote?.transactionRequest.to}
      amount={
        quote
          ? `${formatTokenAmount(quote.fromAmount, quote.fromToken.decimals)} ${quote.fromToken.symbol} → ${formatTokenAmount(quote.toAmount, quote.toToken.decimals)} ${quote.toToken.symbol}`
          : undefined
      }
      fee={fee}
      feeDetail={gasLimitDetail(quote?.transactionRequest.gasLimit)}
      extra={quote ? [{ label: 'Route', value: quote.toolName }, ...(extraRows ?? [])] : []}
      preview={preview}
      previewLoading={previewLoading}
      warnings={preview?.willFail ? ['The simulation says this swap would fail. Get a new quote before you confirm.'] : []}
      loading={loading}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

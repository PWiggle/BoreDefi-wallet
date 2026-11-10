/**
 * Native EVM swap through the 0x Swap API (v2, AllowanceHolder), using the same server BoredSwap uses.
 *
 * The request goes to the BoredSwap proxy's POST /api/quote. That server holds the 0x API key and adds
 * swapFeeRecipient + swapFeeBps (0.30%) itself, so neither the key nor the fee wallet ships in the app.
 * Everything the proxy returns is checked here before the wallet will sign it:
 *  - same chain, same sell amount, a positive buy amount and minimum
 *  - the fee is not above BoreDefi's 0.30%
 *  - the transaction and the approval spender are 0x's AllowanceHolder (not some other contract)
 *  - the transaction's ETH value matches what is being sold (0 for a token)
 */
import { UserFacingError, toUserError } from './tx-errors';
import { type ChainId } from './chains';
import { BOREDEFI_SWAP_FEE_BPS, DEFAULT_SLIPPAGE_BPS, EVM_SWAP_PROXY } from './swap-config';
import { fetchQuoteResponse, NO_ROUTE_MESSAGE, type QuoteToken, type SwapQuote } from './swap';
import { isNativeTokenAddress, type TokenConfig } from './tokens';

/** 0x uses the 0xEeee… placeholder for the chain's native token; the wallet uses 0x000…0. */
export const ZEROX_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * 0x Settler AllowanceHolder (docs: 0x.org/docs/introduction/0x-cheat-sheet). 0x1fF3… on Cancun chains (all chains
 * BoredSwap supports), 0x5E88… on the few pre-Cancun chains. The swap tx and the approval spender must be one of these.
 */
export const ZEROX_ALLOWANCE_HOLDERS: readonly string[] = [
  '0x0000000000001ff3684f28c67538d4d072c22734',
  '0x0000000000005e88410ccdfade4a5efae4b49562',
];

export function isZeroExAllowanceHolder(address: string | null | undefined): boolean {
  return Boolean(address) && ZEROX_ALLOWANCE_HOLDERS.includes(String(address).toLowerCase());
}

export function zeroExTokenAddress(token: Pick<TokenConfig, 'address' | 'native'>): string {
  return token.native || isNativeTokenAddress(token.address) ? ZEROX_NATIVE : token.address;
}

/** Shape of BoredSwap's /api/quote answer (SwapView). */
export type ProxyQuote = {
  chainId?: number;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  priceImpactPct?: number | null;
  slippageBps?: number;
  networkFeeWei?: string | null;
  feeBps?: number;
  feeAmount?: string | null;
  feeSide?: 'buy' | 'sell' | string | null;
  allowance?: { spender?: string; actual?: string } | null;
  balanceIssue?: boolean;
  liquidityAvailable?: boolean;
  transaction?: { to?: string; data?: string; value?: string; gas?: string | null } | null;
};

export type ProxyQuoteResponse = {
  configured?: boolean;
  missing?: string[];
  error?: string;
  quote?: ProxyQuote;
};

function big(value: string | null | undefined, field: string): bigint {
  if (value === undefined || value === null || !/^\d+$/.test(String(value))) {
    throw new UserFacingError(`The swap quote is missing ${field}. Get a new quote.`);
  }
  return BigInt(value);
}

function toQuoteToken(token: TokenConfig): QuoteToken {
  return { address: token.address, decimals: token.decimals, symbol: token.symbol };
}

/** Pure: checks a proxy quote against what the user asked for and turns it into the screen's SwapQuote. */
export function parseZeroExQuote(
  payload: ProxyQuoteResponse,
  expected: { chainId: ChainId; fromToken: TokenConfig; toToken: TokenConfig; fromAmount: bigint },
): SwapQuote {
  if (payload.configured === false) {
    throw new UserFacingError('Swaps are not set up on the swap server yet. Try again later.');
  }
  const quote = payload.quote;
  if (!quote) {
    throw new UserFacingError(payload.error || NO_ROUTE_MESSAGE);
  }
  if (quote.chainId !== expected.chainId) {
    throw new UserFacingError('The quote was for a different network. Get a new quote.');
  }
  if (big(quote.sellAmount, 'the amount') !== expected.fromAmount) {
    throw new UserFacingError('The quote was for a different amount. Get a new quote.');
  }
  if (quote.liquidityAvailable === false) {
    throw new UserFacingError(NO_ROUTE_MESSAGE);
  }
  if (quote.balanceIssue) {
    throw new UserFacingError(`Not enough ${expected.fromToken.symbol} for this swap.`);
  }
  const toAmount = big(quote.buyAmount, 'the amount you receive');
  const toAmountMin = big(quote.minBuyAmount, 'the minimum you receive');
  if (toAmount <= 0n || toAmountMin <= 0n || toAmountMin > toAmount) {
    throw new UserFacingError(NO_ROUTE_MESSAGE);
  }
  const feeBps = Number(quote.feeBps ?? 0);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > BOREDEFI_SWAP_FEE_BPS) {
    throw new UserFacingError('The swap fee in this quote is higher than BoreDefi charges. Nothing was sent.');
  }
  const tx = quote.transaction;
  if (!tx?.to || !tx.data || tx.data === '0x') {
    throw new UserFacingError('The quote did not include a transaction to sign. Get a new quote.');
  }
  if (!isZeroExAllowanceHolder(tx.to)) {
    throw new UserFacingError('Blocked: the swap goes to a contract that is not 0x. Nothing was sent.');
  }
  const value = big(tx.value ?? '0', 'the transaction value');
  const sellsNative = expected.fromToken.native || isNativeTokenAddress(expected.fromToken.address);
  if (sellsNative ? value !== expected.fromAmount : value !== 0n) {
    throw new UserFacingError('Blocked: the swap would send a different amount of the native coin. Nothing was sent.');
  }
  let approvalAddress: string | null = null;
  if (!sellsNative) {
    const spender = quote.allowance?.spender ?? tx.to;
    if (!isZeroExAllowanceHolder(spender) || spender.toLowerCase() !== tx.to.toLowerCase()) {
      throw new UserFacingError('Blocked: the approval is for a contract that is not 0x. Nothing was sent.');
    }
    // Always set for a token sell: the wallet re-reads the allowance on-chain before it approves.
    approvalAddress = tx.to;
  }
  const feeSide = quote.feeSide === 'sell' ? 'sell' : 'buy';
  const feeAmount = quote.feeAmount && /^\d+$/.test(quote.feeAmount) ? BigInt(quote.feeAmount) : 0n;
  const impact = typeof quote.priceImpactPct === 'number' && Number.isFinite(quote.priceImpactPct) ? quote.priceImpactPct : null;
  const networkFeeWei = quote.networkFeeWei && /^\d+$/.test(quote.networkFeeWei) ? BigInt(quote.networkFeeWei) : null;
  const gas = tx.gas && /^\d+$/.test(tx.gas) ? BigInt(tx.gas) : undefined;
  return {
    tool: '0x',
    toolName: '0x (BoredSwap)',
    fromToken: toQuoteToken(expected.fromToken),
    toToken: toQuoteToken(expected.toToken),
    fromAmountUsd: null,
    toAmountUsd: null,
    fromAmount: expected.fromAmount,
    toAmount,
    toAmountMin,
    approvalAddress,
    transactionRequest: {
      to: tx.to,
      data: tx.data,
      value,
      // 0x's estimate plus 20%, like BoredSwap. sendWithBufferedGas never goes below its own estimate.
      gasLimit: gas ? (gas * 12n) / 10n : undefined,
    },
    fees: {
      provider: '0x',
      feeBps,
      feeAmount,
      feeToken: toQuoteToken(feeSide === 'sell' ? expected.fromToken : expected.toToken),
      priceImpactPct: impact,
      networkFeeWei,
      slippageBps: Number(quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    },
  };
}

export type ZeroExQuoteInput = {
  chainId: ChainId;
  fromToken: TokenConfig;
  toToken: TokenConfig;
  fromAmount: bigint;
  fromAddress: string;
  slippageBps?: number;
  proxy?: string;
  fetcher?: typeof fetch;
};

export function zeroExRequestBody(input: ZeroExQuoteInput): Record<string, unknown> {
  return {
    chainId: input.chainId,
    sellToken: zeroExTokenAddress(input.fromToken),
    buyToken: zeroExTokenAddress(input.toToken),
    sellAmount: input.fromAmount.toString(),
    slippageBps: input.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    taker: input.fromAddress,
  };
}

/** Firm 0x quote (with the transaction to sign) from the BoredSwap proxy. */
export async function fetchZeroExQuote(input: ZeroExQuoteInput): Promise<SwapQuote> {
  if (input.fromToken.address.toLowerCase() === input.toToken.address.toLowerCase()) {
    throw new UserFacingError('Choose two different tokens.');
  }
  if (input.fromAmount <= 0n) {
    throw new UserFacingError('Enter an amount greater than zero.');
  }
  const run = input.fetcher ?? fetch;
  const url = `${input.proxy ?? EVM_SWAP_PROXY}/api/quote`;
  try {
    const response = await fetchQuoteResponse(() =>
      run(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'BoreDefiWallet/1.0' },
        body: JSON.stringify(zeroExRequestBody(input)),
      }),
    );
    const payload = (await response.json().catch(() => ({}))) as ProxyQuoteResponse;
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new UserFacingError('The swap service is busy. Try again in a moment.');
      }
      throw new UserFacingError(payload.error || NO_ROUTE_MESSAGE);
    }
    return parseZeroExQuote(payload, input);
  } catch (error) {
    throw toUserError('0x swap quote failed', error, {
      chainId: input.chainId,
      fallback: NO_ROUTE_MESSAGE,
      step: 'getting a swap quote from 0x',
    });
  }
}

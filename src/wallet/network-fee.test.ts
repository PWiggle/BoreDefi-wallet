import assert from 'node:assert/strict';
import test from 'node:test';

import { computeNetworkFee, formatFeeNative, formatNetworkFee, gweiToWei } from './network-fee';

test('swap fee: gas estimate x eth_feeHistory fee x ETH price, shown in ETH and dollars', () => {
  // 180k gas at 0.44 gwei with ETH at $2,290.57 is about $0.18.
  const fee = computeNetworkFee({ chainId: 1, gasUnits: 180_000n, feePerGasWei: gweiToWei(0.44), nativeUsd: 2290.57 });
  assert.equal(fee.feeWei, 79_200_000_000_000n);
  assert.equal(formatNetworkFee(fee), 'about $0.18 · 0.000079 ETH');
});

test('fee without a price still shows the native amount; ApeChain shows APE', () => {
  const noPrice = computeNetworkFee({ chainId: 1, gasUnits: 21_000n, feePerGasWei: gweiToWei(2), nativeUsd: null });
  assert.equal(formatNetworkFee(noPrice), 'about 0.000042 ETH');
  const ape = computeNetworkFee({ chainId: 33139, gasUnits: 200_000n, feePerGasWei: gweiToWei(101.68), nativeUsd: 0.1116 });
  assert.equal(formatNetworkFee(ape), 'about <$0.01 · 0.02 APE');
});

test('formatFeeNative keeps two significant digits', () => {
  assert.equal(formatFeeNative(0n), '0');
  assert.equal(formatFeeNative(1_234_000_000_000_000n), '0.0012');
  assert.equal(formatFeeNative(350_000_000_000_000_000n), '0.35');
  assert.equal(formatFeeNative(1_500_000_000_000_000_000n), '1.5');
  assert.equal(gweiToWei(0.384069297), 384_069_297n);
  assert.equal(gweiToWei(-1), 0n);
});

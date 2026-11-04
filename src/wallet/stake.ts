import { type AbstractProvider, Contract, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { CHAINS, type ChainId } from './chains';
import { checkPreflight, estimateFeeWei, GAS_UNITS, type PreflightResult } from './preflight';
import { sendContractMethod } from './gas-limit';
import { connectedWallet, fetchMaxFeePerGas, getProvider, readWithFallback } from './rpc';
import { formatTokenAmount } from './format';
import { findToken, type TokenConfig } from './tokens';
import { toUserError, UserFacingError } from './tx-errors';

const ZERO = '0x0000000000000000000000000000000000000000';

export const LIDO_STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
export const LIDO_WITHDRAWAL_QUEUE = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';

export const AAVE_V3_POOL: Partial<Record<ChainId, string>> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  // From Base PoolAddressesProvider 0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D getPool(), checked 2026-11-01.
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
};

const STETH_ABI = [
  'function submit(address referral) payable returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const QUEUE_ABI = [
  'function requestWithdrawals(uint256[] amounts, address owner) returns (uint256[])',
  'function getWithdrawalRequests(address owner) view returns (uint256[])',
  'function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function getLastCheckpointIndex() view returns (uint256)',
  'function findCheckpointHints(uint256[] requestIds, uint256 firstIndex, uint256 lastIndex) view returns (uint256[])',
  'function claimWithdrawals(uint256[] requestIds, uint256[] hints)',
];

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export type StakeProtocol = 'lido' | 'aave-v3';

export type StakeMarket = {
  id: string;
  protocol: StakeProtocol;
  chainId: ChainId;
  title: string;
  subtitle: string;
  asset: TokenConfig;
};

export type WithdrawalRequest = {
  id: bigint;
  amount: bigint;
  finalized: boolean;
  claimed: boolean;
};

function requireToken(chainId: ChainId, address: string): TokenConfig {
  const token = findToken(chainId, address);
  if (!token) {
    throw new Error('Unsupported stake asset');
  }
  return token;
}

export function listStakeMarkets(): StakeMarket[] {
  const markets: StakeMarket[] = [
    {
      id: 'lido-eth',
      protocol: 'lido',
      chainId: 1,
      title: 'Lido stETH',
      subtitle: 'Stake ETH on Ethereum. Unstake uses Lido’s withdrawal queue.',
      asset: requireToken(1, '0x0000000000000000000000000000000000000000'),
    },
  ];
  for (const [rawId, pool] of Object.entries(AAVE_V3_POOL)) {
    const chainId = Number(rawId) as ChainId;
    const usdc = findToken(chainId, usdcAddress(chainId) ?? '');
    if (!usdc || !pool) {
      continue;
    }
    markets.push({
      id: `aave-usdc-${chainId}`,
      protocol: 'aave-v3',
      chainId,
      title: `Aave V3 ${usdc.symbol}`,
      subtitle: 'Supply USDC to Aave V3. Withdraw is usually the same transaction.',
      asset: usdc,
    });
  }
  return markets;
}

function usdcAddress(chainId: ChainId): string | null {
  return (
    {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    } as Partial<Record<ChainId, string>>
  )[chainId] ?? null;
}

export function findStakeMarket(id: string): StakeMarket | undefined {
  return listStakeMarkets().find((market) => market.id === id);
}

export async function fetchStakedBalance(market: StakeMarket, owner: string): Promise<bigint> {
  if (market.protocol === 'lido') {
    return readWithFallback(1, (provider) => stethBalance(provider, owner));
  }
  return readWithFallback(market.chainId, async (provider) => {
    const aToken = await aaveAToken(provider, market.chainId, market.asset.address);
    const token = new Contract(aToken, ERC20_ABI, provider);
    return (await token.balanceOf(owner)) as bigint;
  });
}

async function stethBalance(provider: AbstractProvider, owner: string): Promise<bigint> {
  const steth = new Contract(LIDO_STETH, STETH_ABI, provider);
  return (await steth.balanceOf(owner)) as bigint;
}

const aTokenCache = new Map<string, string>();

async function aaveAToken(provider: AbstractProvider, chainId: ChainId, asset: string): Promise<string> {
  const poolAddress = AAVE_V3_POOL[chainId];
  if (!poolAddress) {
    throw new Error('Aave V3 is not configured on this chain.');
  }
  const cacheKey = `${chainId}:${asset.toLowerCase()}`;
  const cached = aTokenCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pool = new Contract(poolAddress, AAVE_POOL_ABI, provider);
  const data = await pool.getReserveData(asset);
  const address = (data.aTokenAddress ?? data[8]) as string;
  if (!address || address === ZERO) {
    throw new Error('Aave does not list that reserve.');
  }
  aTokenCache.set(cacheKey, address);
  return address;
}

export type StakeAction = 'stake' | 'unstake' | 'claim';

/** Gas units for one Stake action, including the approve step it may need. */
export function stakeGasUnits(market: StakeMarket, action: StakeAction, needsApproval = true): bigint {
  const approve = needsApproval ? GAS_UNITS.erc20Approve : 0n;
  if (market.protocol === 'lido') {
    if (action === 'stake') {
      return GAS_UNITS.lidoStake;
    }
    if (action === 'unstake') {
      return GAS_UNITS.lidoUnstake + approve;
    }
    return GAS_UNITS.lidoClaim;
  }
  if (action === 'stake') {
    return GAS_UNITS.aaveSupply + approve;
  }
  if (action === 'unstake') {
    return GAS_UNITS.aaveWithdraw;
  }
  return 0n;
}

/** Which balance an action spends: Lido stake spends ETH, Aave supply spends USDC, withdrawals spend the position. */
export function stakeSpend(
  market: StakeMarket,
  action: StakeAction,
): { source: 'wallet' | 'position' | 'none'; symbol: string; native: boolean } {
  if (action === 'claim') {
    return { source: 'none', symbol: '', native: false };
  }
  if (action === 'stake') {
    return { source: 'wallet', symbol: market.asset.symbol, native: Boolean(market.asset.native) || market.protocol === 'lido' };
  }
  return {
    source: 'position',
    symbol: market.protocol === 'lido' ? 'stETH' : `a${market.asset.symbol}`,
    native: false,
  };
}

/** Pure pre-flight for every Stake option (Lido stake/unstake/claim, Aave supply/withdraw on every chain). */
export function checkStakePreflight(input: {
  market: StakeMarket;
  action: StakeAction;
  amount: bigint | null;
  walletBalance: bigint;
  positionBalance: bigint;
  nativeBalance: bigint | null;
  maxFeePerGas: bigint | null;
  needsApproval?: boolean;
}): PreflightResult {
  const spend = stakeSpend(input.market, input.action);
  const feeWei =
    input.maxFeePerGas === null
      ? null
      : estimateFeeWei(
          input.market.chainId,
          stakeGasUnits(input.market, input.action, input.needsApproval ?? true),
          input.maxFeePerGas,
        );
  return checkPreflight({
    chainId: input.market.chainId,
    amount: spend.source === 'none' ? null : input.amount ?? 0n,
    spendBalance: spend.source === 'position' ? input.positionBalance : input.walletBalance,
    spendSymbol: spend.symbol,
    nativeBalance: input.nativeBalance,
    feeWei,
    spendIsNative: spend.native,
  });
}

async function walletBalanceOf(market: StakeMarket, owner: string): Promise<bigint> {
  if (market.protocol === 'lido' || market.asset.native) {
    return getProvider(market.chainId).getBalance(owner);
  }
  const token = new Contract(market.asset.address, ERC20_ABI, getProvider(market.chainId));
  return token.balanceOf(owner) as Promise<bigint>;
}

export type BalanceStatus = 'loading' | 'ok' | 'unknown';

/** Position line for the Stake screen. Never shows a made-up 0 while the read is pending or failed. */
export function positionText(market: StakeMarket, status: BalanceStatus, balance: bigint | null): string {
  const label = market.protocol === 'lido' ? 'stETH' : `a${market.asset.symbol}`;
  if (status === 'ok' && balance !== null) {
    return `Position: ${formatTokenAmount(balance, market.asset.decimals)} ${label}`;
  }
  if (status === 'loading') {
    return `Position: checking ${label}…`;
  }
  return `Position: couldn't check ${label} right now`;
}

/** Stake screen pre-flight that treats a balance that is still loading or failed as unknown, not as 0. */
export function checkStakeScreenPreflight(input: {
  market: StakeMarket;
  action: StakeAction;
  amount: bigint | null;
  walletBalance: bigint | null;
  positionBalance: bigint | null;
  nativeBalance: bigint | null;
  maxFeePerGas: bigint | null;
}): PreflightResult {
  const spend = stakeSpend(input.market, input.action);
  const needed = spend.source === 'wallet' ? input.walletBalance : spend.source === 'position' ? input.positionBalance : 0n;
  if (needed === null) {
    return {
      ok: false,
      reason: 'loading',
      message: spend.source === 'position' ? 'Checking your position…' : 'Checking your balance…',
    };
  }
  return checkStakePreflight({
    ...input,
    walletBalance: input.walletBalance ?? 0n,
    positionBalance: input.positionBalance ?? 0n,
  });
}

/** Re-checks balances right before broadcast so a stale screen can never send a doomed transaction. */
export async function assertStakeReady(input: {
  market: StakeMarket;
  action: StakeAction;
  owner: string;
  amount: bigint | null;
  needsApproval?: boolean;
}): Promise<void> {
  let result: PreflightResult;
  try {
    const [nativeBalance, maxFeePerGas, walletBalance, positionBalance] = await Promise.all([
      getProvider(input.market.chainId).getBalance(input.owner),
      fetchMaxFeePerGas(input.market.chainId).catch(() => null),
      input.action === 'stake' ? walletBalanceOf(input.market, input.owner) : Promise.resolve(0n),
      input.action === 'unstake' ? fetchStakedBalance(input.market, input.owner) : Promise.resolve(0n),
    ]);
    result = checkStakePreflight({ ...input, walletBalance, positionBalance, nativeBalance, maxFeePerGas });
  } catch (error) {
    throw toUserError('Stake pre-flight failed', error, {
      chainId: input.market.chainId,
      fallback: `Could not check your balance on ${CHAINS[input.market.chainId].name}. Try again.`,
    });
  }
  if (!result.ok) {
    throw new UserFacingError(result.message);
  }
}

type ContractLike = Pick<Contract, 'getFunction'>;

/**
 * Sends approve with a buffered gas limit and waits until it is mined (status 1). The next step's gas estimate
 * depends on the new allowance, so it must not be estimated against the pre-approval state.
 */
export async function approveAndConfirm(token: ContractLike, spender: string, amount: bigint): Promise<void> {
  const approval = await sendContractMethod(token, 'approve', [spender, amount], { fallback: GAS_UNITS.erc20Approve });
  const receipt = await approval.wait();
  if (receipt && receipt.status === 0) {
    throw new UserFacingError('The approval failed on-chain. Nothing was supplied.');
  }
}

/** Aave V3 supply: optional approve (mined first), then supply with a buffered gas limit. */
export async function sendAaveSupply(input: {
  token: ContractLike;
  pool: ContractLike;
  poolAddress: string;
  asset: string;
  owner: string;
  amount: bigint;
  needsApproval: boolean;
  chainId: ChainId;
}): Promise<TransactionResponse> {
  if (input.needsApproval) {
    logger.info('Aave approve', { chainId: input.chainId });
    await approveAndConfirm(input.token, input.poolAddress, input.amount);
  }
  logger.info('Aave supply', { chainId: input.chainId });
  return await sendContractMethod(input.pool, 'supply', [input.asset, input.amount, input.owner, 0], {
    fallback: GAS_UNITS.aaveSupply,
  });
}

export async function stake(input: {
  mnemonic: string;
  market: StakeMarket;
  owner: string;
  amount: bigint;
}): Promise<TransactionResponse> {
  if (input.amount <= 0n) {
    throw new UserFacingError('Enter an amount greater than zero.');
  }
  const chainId = input.market.chainId;
  if (input.market.protocol !== 'lido' && !AAVE_V3_POOL[chainId]) {
    throw new UserFacingError('Aave V3 is not configured on this chain.');
  }
  try {
    const wallet = await connectedWallet(input.mnemonic, chainId);
    if (input.market.protocol === 'lido') {
      await assertStakeReady({ market: input.market, action: 'stake', owner: input.owner, amount: input.amount });
      logger.info('Lido stake', { chainId: 1 });
      const lido = new Contract(LIDO_STETH, STETH_ABI, wallet);
      return await sendContractMethod(lido, 'submit', [ZERO], { fallback: GAS_UNITS.lidoStake, value: input.amount });
    }
    const poolAddress = AAVE_V3_POOL[chainId]!;
    const token = new Contract(input.market.asset.address, ERC20_ABI, wallet);
    const allowance = (await token.allowance(input.owner, poolAddress)) as bigint;
    const needsApproval = allowance < input.amount;
    await assertStakeReady({ market: input.market, action: 'stake', owner: input.owner, amount: input.amount, needsApproval });
    const pool = new Contract(poolAddress, AAVE_POOL_ABI, wallet);
    return await sendAaveSupply({
      token,
      pool,
      poolAddress,
      asset: input.market.asset.address,
      owner: input.owner,
      amount: input.amount,
      needsApproval,
      chainId,
    });
  } catch (error) {
    throw toUserError('Stake failed', error, { chainId });
  }
}

export async function unstake(input: {
  mnemonic: string;
  market: StakeMarket;
  owner: string;
  amount: bigint;
}): Promise<TransactionResponse> {
  if (input.amount <= 0n) {
    throw new UserFacingError('Enter an amount greater than zero.');
  }
  const chainId = input.market.chainId;
  if (input.market.protocol !== 'lido' && !AAVE_V3_POOL[chainId]) {
    throw new UserFacingError('Aave V3 is not configured on this chain.');
  }
  try {
    const wallet = await connectedWallet(input.mnemonic, chainId);
    if (input.market.protocol === 'lido') {
      const steth = new Contract(LIDO_STETH, STETH_ABI, wallet);
      const allowance = (await steth.allowance(input.owner, LIDO_WITHDRAWAL_QUEUE)) as bigint;
      const needsApproval = allowance < input.amount;
      await assertStakeReady({ market: input.market, action: 'unstake', owner: input.owner, amount: input.amount, needsApproval });
      if (needsApproval) {
        logger.info('Lido approve', { chainId: 1 });
        await approveAndConfirm(steth, LIDO_WITHDRAWAL_QUEUE, input.amount);
      }
      logger.info('Lido unstake request', { chainId: 1 });
      const queue = new Contract(LIDO_WITHDRAWAL_QUEUE, QUEUE_ABI, wallet);
      return await sendContractMethod(queue, 'requestWithdrawals', [[input.amount], input.owner], {
        fallback: GAS_UNITS.lidoUnstake,
      });
    }
    await assertStakeReady({ market: input.market, action: 'unstake', owner: input.owner, amount: input.amount });
    logger.info('Aave withdraw', { chainId });
    const pool = new Contract(AAVE_V3_POOL[chainId]!, AAVE_POOL_ABI, wallet);
    return await sendContractMethod(pool, 'withdraw', [input.market.asset.address, input.amount, input.owner], {
      fallback: GAS_UNITS.aaveWithdraw,
    });
  } catch (error) {
    throw toUserError('Unstake failed', error, { chainId });
  }
}

export async function listLidoRequests(owner: string): Promise<WithdrawalRequest[]> {
  const queue = new Contract(LIDO_WITHDRAWAL_QUEUE, QUEUE_ABI, getProvider(1));
  const ids = (await queue.getWithdrawalRequests(owner)) as bigint[];
  if (ids.length === 0) {
    return [];
  }
  const status = (await queue.getWithdrawalStatus(ids)) as Array<{
    amountOfStETH: bigint;
    isFinalized: boolean;
    isClaimed: boolean;
  }>;
  return ids.map((id, index) => ({
    id,
    amount: status[index]?.amountOfStETH ?? 0n,
    finalized: Boolean(status[index]?.isFinalized),
    claimed: Boolean(status[index]?.isClaimed),
  }));
}

export async function claimLidoRequests(mnemonic: string, owner: string): Promise<TransactionResponse> {
  try {
    const requests = (await listLidoRequests(owner)).filter((item) => item.finalized && !item.claimed);
    if (requests.length === 0) {
      throw new UserFacingError('No finalized Lido withdrawals to claim.');
    }
    const market = findStakeMarket('lido-eth')!;
    await assertStakeReady({ market, action: 'claim', owner, amount: null });
    const wallet = await connectedWallet(mnemonic, 1);
    const queue = new Contract(LIDO_WITHDRAWAL_QUEUE, QUEUE_ABI, wallet);
    const ids = requests.map((item) => item.id);
    const last = (await queue.getLastCheckpointIndex()) as bigint;
    const hints = (await queue.findCheckpointHints(ids, 1n, last)) as bigint[];
    logger.info('Lido claim', { count: ids.length });
    return await sendContractMethod(queue, 'claimWithdrawals', [ids, hints], { fallback: GAS_UNITS.lidoClaim });
  } catch (error) {
    throw toUserError('Lido claim failed', error, { chainId: 1 });
  }
}

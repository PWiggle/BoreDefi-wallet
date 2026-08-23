import { Contract, type TransactionResponse } from 'ethers';

import { logger } from '../logger';
import { type ChainId } from './chains';
import { connectedWallet, getProvider } from './rpc';
import { findToken, type TokenConfig } from './tokens';

const ZERO = '0x0000000000000000000000000000000000000000';

export const LIDO_STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
export const LIDO_WITHDRAWAL_QUEUE = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';

const AAVE_V3_POOL: Partial<Record<ChainId, string>> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  8453: '0xA238Dd80C259a72c79Bd56434e4eC5138f2Bc59B',
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
    const steth = new Contract(LIDO_STETH, STETH_ABI, getProvider(1));
    return steth.balanceOf(owner) as Promise<bigint>;
  }
  const aToken = await aaveAToken(market.chainId, market.asset.address);
  const token = new Contract(aToken, ERC20_ABI, getProvider(market.chainId));
  return token.balanceOf(owner) as Promise<bigint>;
}

async function aaveAToken(chainId: ChainId, asset: string): Promise<string> {
  const poolAddress = AAVE_V3_POOL[chainId];
  if (!poolAddress) {
    throw new Error('Aave V3 is not configured on this chain.');
  }
  const pool = new Contract(poolAddress, AAVE_POOL_ABI, getProvider(chainId));
  const data = await pool.getReserveData(asset);
  const address = (data.aTokenAddress ?? data[8]) as string;
  if (!address || address === ZERO) {
    throw new Error('Aave does not list that reserve.');
  }
  return address;
}

export async function stake(input: {
  mnemonic: string;
  market: StakeMarket;
  owner: string;
  amount: bigint;
}): Promise<TransactionResponse> {
  if (input.amount <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  const wallet = connectedWallet(input.mnemonic, input.market.chainId);
  if (input.market.protocol === 'lido') {
    logger.info('Lido stake', { chainId: 1 });
    const lido = new Contract(LIDO_STETH, STETH_ABI, wallet);
    return lido.submit(ZERO, { value: input.amount }) as Promise<TransactionResponse>;
  }
  const poolAddress = AAVE_V3_POOL[input.market.chainId];
  if (!poolAddress) {
    throw new Error('Aave V3 is not configured on this chain.');
  }
  const token = new Contract(input.market.asset.address, ERC20_ABI, wallet);
  const allowance = (await token.allowance(input.owner, poolAddress)) as bigint;
  if (allowance < input.amount) {
    const approval = (await token.approve(poolAddress, input.amount)) as TransactionResponse;
    await approval.wait();
  }
  logger.info('Aave supply', { chainId: input.market.chainId });
  const pool = new Contract(poolAddress, AAVE_POOL_ABI, wallet);
  return pool.supply(input.market.asset.address, input.amount, input.owner, 0) as Promise<TransactionResponse>;
}

export async function unstake(input: {
  mnemonic: string;
  market: StakeMarket;
  owner: string;
  amount: bigint;
}): Promise<TransactionResponse> {
  if (input.amount <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  const wallet = connectedWallet(input.mnemonic, input.market.chainId);
  if (input.market.protocol === 'lido') {
    const steth = new Contract(LIDO_STETH, STETH_ABI, wallet);
    const allowance = (await steth.allowance(input.owner, LIDO_WITHDRAWAL_QUEUE)) as bigint;
    if (allowance < input.amount) {
      const approval = (await steth.approve(LIDO_WITHDRAWAL_QUEUE, input.amount)) as TransactionResponse;
      await approval.wait();
    }
    logger.info('Lido unstake request', { chainId: 1 });
    const queue = new Contract(LIDO_WITHDRAWAL_QUEUE, QUEUE_ABI, wallet);
    return queue.requestWithdrawals([input.amount], input.owner) as Promise<TransactionResponse>;
  }
  const poolAddress = AAVE_V3_POOL[input.market.chainId];
  if (!poolAddress) {
    throw new Error('Aave V3 is not configured on this chain.');
  }
  logger.info('Aave withdraw', { chainId: input.market.chainId });
  const pool = new Contract(poolAddress, AAVE_POOL_ABI, wallet);
  return pool.withdraw(input.market.asset.address, input.amount, input.owner) as Promise<TransactionResponse>;
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
  const requests = (await listLidoRequests(owner)).filter((item) => item.finalized && !item.claimed);
  if (requests.length === 0) {
    throw new Error('No finalized Lido withdrawals to claim.');
  }
  const wallet = connectedWallet(mnemonic, 1);
  const queue = new Contract(LIDO_WITHDRAWAL_QUEUE, QUEUE_ABI, wallet);
  const ids = requests.map((item) => item.id);
  const last = (await queue.getLastCheckpointIndex()) as bigint;
  const hints = (await queue.findCheckpointHints(ids, 1n, last)) as bigint[];
  logger.info('Lido claim', { count: ids.length });
  return queue.claimWithdrawals(ids, hints) as Promise<TransactionResponse>;
}

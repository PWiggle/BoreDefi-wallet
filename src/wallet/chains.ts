export type ChainId = 1 | 10 | 56 | 137 | 8453 | 42161 | 43114;

export type ChainConfig = {
  id: ChainId;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  explorerTx: string;
  explorerAddress: string;
  activityUrl: string;
};

const publicRpc = {
  ethereum: process.env.EXPO_PUBLIC_ETH_RPC ?? 'https://ethereum-rpc.publicnode.com',
  optimism: process.env.EXPO_PUBLIC_OP_RPC ?? 'https://optimism-rpc.publicnode.com',
  bnb: process.env.EXPO_PUBLIC_BNB_RPC ?? 'https://bsc-rpc.publicnode.com',
  polygon: process.env.EXPO_PUBLIC_POLYGON_RPC ?? 'https://polygon-bor-rpc.publicnode.com',
  base: process.env.EXPO_PUBLIC_BASE_RPC ?? 'https://mainnet.base.org',
  arbitrum: process.env.EXPO_PUBLIC_ARB_RPC ?? 'https://arbitrum-one-rpc.publicnode.com',
  avalanche: process.env.EXPO_PUBLIC_AVAX_RPC ?? 'https://avalanche-c-chain-rpc.publicnode.com',
};

export const CHAINS: Record<ChainId, ChainConfig> = {
  1: {
    id: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: publicRpc.ethereum,
    explorerTx: 'https://etherscan.io/tx/',
    explorerAddress: 'https://etherscan.io/address/',
    activityUrl: 'https://eth.blockscout.com/api',
  },
  10: {
    id: 10,
    name: 'Optimism',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: publicRpc.optimism,
    explorerTx: 'https://optimistic.etherscan.io/tx/',
    explorerAddress: 'https://optimistic.etherscan.io/address/',
    activityUrl: 'https://optimism.blockscout.com/api',
  },
  56: {
    id: 56,
    name: 'BNB Chain',
    symbol: 'BNB',
    decimals: 18,
    rpcUrl: publicRpc.bnb,
    explorerTx: 'https://bscscan.com/tx/',
    explorerAddress: 'https://bscscan.com/address/',
    activityUrl: 'https://bsc.blockscout.com/api',
  },
  137: {
    id: 137,
    name: 'Polygon',
    symbol: 'POL',
    decimals: 18,
    rpcUrl: publicRpc.polygon,
    explorerTx: 'https://polygonscan.com/tx/',
    explorerAddress: 'https://polygonscan.com/address/',
    activityUrl: 'https://polygon.blockscout.com/api',
  },
  8453: {
    id: 8453,
    name: 'Base',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: publicRpc.base,
    explorerTx: 'https://basescan.org/tx/',
    explorerAddress: 'https://basescan.org/address/',
    activityUrl: 'https://base.blockscout.com/api',
  },
  42161: {
    id: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: publicRpc.arbitrum,
    explorerTx: 'https://arbiscan.io/tx/',
    explorerAddress: 'https://arbiscan.io/address/',
    activityUrl: 'https://arbitrum.blockscout.com/api',
  },
  43114: {
    id: 43114,
    name: 'Avalanche',
    symbol: 'AVAX',
    decimals: 18,
    rpcUrl: publicRpc.avalanche,
    explorerTx: 'https://snowscan.xyz/tx/',
    explorerAddress: 'https://snowscan.xyz/address/',
    activityUrl:
      'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
  },
};

export const CHAIN_LIST: ChainConfig[] = [
  CHAINS[1],
  CHAINS[8453],
  CHAINS[42161],
  CHAINS[10],
  CHAINS[137],
  CHAINS[56],
  CHAINS[43114],
];

export const DEFAULT_CHAIN_ID: ChainId = 1;

const CHAIN_IDS = new Set<number>(CHAIN_LIST.map((chain) => chain.id));

export function isChainId(value: number): value is ChainId {
  return CHAIN_IDS.has(value);
}

export function parseChainId(value: string | number): ChainId | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return isChainId(numeric) ? numeric : null;
}

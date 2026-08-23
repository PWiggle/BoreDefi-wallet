export type ChainId = 1 | 8453 | 137;

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
  base: process.env.EXPO_PUBLIC_BASE_RPC ?? 'https://mainnet.base.org',
  polygon: process.env.EXPO_PUBLIC_POLYGON_RPC ?? 'https://polygon-bor-rpc.publicnode.com',
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
};

export const CHAIN_LIST: ChainConfig[] = [CHAINS[1], CHAINS[8453], CHAINS[137]];

export const DEFAULT_CHAIN_ID: ChainId = 1;

export function isChainId(value: number): value is ChainId {
  return value === 1 || value === 8453 || value === 137;
}

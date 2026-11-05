export type ChainId = 1 | 10 | 56 | 137 | 8453 | 42161 | 43114 | 33139;

export type ChainConfig = {
  id: ChainId;
  name: string;
  symbol: string;
  decimals: number;
  /** First public endpoint. Kept so existing callers can read a single URL. */
  rpcUrl: string;
  /** Ordered public endpoints. The first success wins; later URLs are fallbacks. */
  rpcUrls: string[];
  explorerTx: string;
  explorerAddress: string;
  activityUrl: string;
  nftApi?: string;
};

/** Public JSON-RPC list. An env override is tried first, then these defaults. */
function rpcEndpoints(envValue: string | undefined, defaults: readonly string[]): string[] {
  const override = envValue?.trim();
  const urls = override ? [override, ...defaults] : [...defaults];
  return [...new Set(urls.filter(Boolean))];
}

function chainRpc(envValue: string | undefined, defaults: readonly string[]): { rpcUrl: string; rpcUrls: string[] } {
  const rpcUrls = rpcEndpoints(envValue, defaults);
  const rpcUrl = rpcUrls[0];
  if (!rpcUrl) {
    throw new Error('Each chain needs at least one RPC URL');
  }
  return { rpcUrl, rpcUrls };
}

// Verified with curl eth_blockNumber on 2026-10-31. Dead hosts are omitted:
// eth.llamarpc.com, polygon-rpc.com, polygon.llamarpc.com, base.llamarpc.com.
const publicRpc = {
  ethereum: chainRpc(process.env.EXPO_PUBLIC_ETH_RPC, [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://rpc.mevblocker.io',
    'https://gateway.tenderly.co/public/mainnet',
  ]),
  optimism: chainRpc(process.env.EXPO_PUBLIC_OP_RPC, [
    'https://optimism-rpc.publicnode.com',
    'https://mainnet.optimism.io',
    'https://gateway.tenderly.co/public/optimism',
  ]),
  bnb: chainRpc(process.env.EXPO_PUBLIC_BNB_RPC, [
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.binance.org',
  ]),
  polygon: chainRpc(process.env.EXPO_PUBLIC_POLYGON_RPC, [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.drpc.org',
    'https://gateway.tenderly.co/public/polygon',
  ]),
  base: chainRpc(process.env.EXPO_PUBLIC_BASE_RPC, [
    'https://mainnet.base.org',
    'https://base.drpc.org',
    'https://base-rpc.publicnode.com',
  ]),
  arbitrum: chainRpc(process.env.EXPO_PUBLIC_ARB_RPC, [
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.drpc.org',
  ]),
  avalanche: chainRpc(process.env.EXPO_PUBLIC_AVAX_RPC, [
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche.drpc.org',
  ]),
  // ApeChain (chain id 33139 / 0x8173, gas token APE). rpc.apechain.com is the official RPC in
  // docs.apechain.com; the Caldera, dRPC and thirdweb hosts are fallbacks. All four answered
  // eth_chainId 0x8173 on 2026-11-03. publicnode has no ApeChain endpoint (404).
  apechain: chainRpc(process.env.EXPO_PUBLIC_APECHAIN_RPC, [
    'https://rpc.apechain.com',
    'https://apechain.calderachain.xyz/http',
    'https://apechain.drpc.org',
    'https://33139.rpc.thirdweb.com',
  ]),
};

export const CHAINS: Record<ChainId, ChainConfig> = {
  1: {
    id: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    ...publicRpc.ethereum,
    explorerTx: 'https://etherscan.io/tx/',
    explorerAddress: 'https://etherscan.io/address/',
    activityUrl: 'https://eth.blockscout.com/api',
    nftApi: 'https://eth.blockscout.com/api/v2',
  },
  10: {
    id: 10,
    name: 'Optimism',
    symbol: 'ETH',
    decimals: 18,
    ...publicRpc.optimism,
    explorerTx: 'https://optimistic.etherscan.io/tx/',
    explorerAddress: 'https://optimistic.etherscan.io/address/',
    activityUrl: 'https://explorer.optimism.io/api',
    nftApi: 'https://explorer.optimism.io/api/v2',
  },
  56: {
    id: 56,
    name: 'BNB Chain',
    symbol: 'BNB',
    decimals: 18,
    ...publicRpc.bnb,
    explorerTx: 'https://bscscan.com/tx/',
    explorerAddress: 'https://bscscan.com/address/',
    activityUrl: 'https://bsc.blockscout.com/api',
  },
  137: {
    id: 137,
    name: 'Polygon',
    symbol: 'POL',
    decimals: 18,
    ...publicRpc.polygon,
    explorerTx: 'https://polygonscan.com/tx/',
    explorerAddress: 'https://polygonscan.com/address/',
    activityUrl: 'https://polygon.blockscout.com/api',
    nftApi: 'https://polygon.blockscout.com/api/v2',
  },
  8453: {
    id: 8453,
    name: 'Base',
    symbol: 'ETH',
    decimals: 18,
    ...publicRpc.base,
    explorerTx: 'https://basescan.org/tx/',
    explorerAddress: 'https://basescan.org/address/',
    activityUrl: 'https://base.blockscout.com/api',
    nftApi: 'https://base.blockscout.com/api/v2',
  },
  42161: {
    id: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    decimals: 18,
    ...publicRpc.arbitrum,
    explorerTx: 'https://arbiscan.io/tx/',
    explorerAddress: 'https://arbiscan.io/address/',
    activityUrl: 'https://arbitrum.blockscout.com/api',
    nftApi: 'https://arbitrum.blockscout.com/api/v2',
  },
  43114: {
    id: 43114,
    name: 'Avalanche',
    symbol: 'AVAX',
    decimals: 18,
    ...publicRpc.avalanche,
    explorerTx: 'https://snowscan.xyz/tx/',
    explorerAddress: 'https://snowscan.xyz/address/',
    activityUrl:
      'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
  },
  33139: {
    id: 33139,
    name: 'ApeChain',
    symbol: 'APE',
    decimals: 18,
    ...publicRpc.apechain,
    explorerTx: 'https://apescan.io/tx/',
    explorerAddress: 'https://apescan.io/address/',
    // ApeScan's own /api needs a key for txlist; the Caldera Blockscout explorer is keyless.
    activityUrl: 'https://apechain.calderaexplorer.xyz/api',
    nftApi: 'https://apechain.calderaexplorer.xyz/api/v2',
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
  CHAINS[33139],
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

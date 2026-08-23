import { CHAINS, type ChainId } from './chains';

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export type TokenConfig = {
  chainId: ChainId;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  native: boolean;
};

function native(chainId: ChainId): TokenConfig {
  const chain = CHAINS[chainId];
  return {
    chainId,
    address: NATIVE_TOKEN_ADDRESS,
    symbol: chain.symbol,
    name: chain.name,
    decimals: 18,
    native: true,
  };
}

function token(
  chainId: ChainId,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
): TokenConfig {
  return { chainId, address, symbol, name, decimals, native: false };
}

export const TOKENS: Record<ChainId, TokenConfig[]> = {
  1: [
    native(1),
    token(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18),
    token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6),
    token(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6),
  ],
  8453: [
    native(8453),
    token(8453, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),
    token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6),
    token(8453, '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 'USDT', 'Tether USD', 6),
  ],
  42161: [
    native(42161),
    token(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 'Wrapped Ether', 18),
    token(42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USD Coin', 6),
    token(42161, '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT', 'Tether USD', 6),
  ],
  10: [
    native(10),
    token(10, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),
    token(10, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USD Coin', 6),
    token(10, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6),
  ],
  137: [
    native(137),
    token(137, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 'WETH', 'Wrapped Ether', 18),
    token(137, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USD Coin', 6),
    token(137, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'USDT', 'Tether USD', 6),
  ],
  56: [
    native(56),
    token(56, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB', 'Wrapped BNB', 18),
    token(56, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 'USD Coin', 18),
    token(56, '0x55d398326f99059fF775485246999027B3197955', 'USDT', 'Tether USD', 18),
  ],
  43114: [
    native(43114),
    token(43114, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'WAVAX', 'Wrapped AVAX', 18),
    token(43114, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USDC', 'USD Coin', 6),
    token(43114, '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 'USDT', 'Tether USD', 6),
  ],
};

export function isNativeTokenAddress(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS;
}

export function tokensForChain(chainId: ChainId): TokenConfig[] {
  return TOKENS[chainId];
}

export function findToken(chainId: ChainId, address: string): TokenConfig | undefined {
  const lower = address.toLowerCase();
  return TOKENS[chainId].find((item) => item.address.toLowerCase() === lower);
}

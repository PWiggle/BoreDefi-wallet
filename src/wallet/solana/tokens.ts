import type { SolanaCluster } from './config';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './programs';

export type SolanaTokenInfo = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  programId: string;
  /** CoinGecko id, priced through BoreDash like the EVM tokens. */
  geckoId?: string;
};

export const SOL_GECKO_ID = 'solana';
export const SOL_DECIMALS = 9;

/**
 * Allowlist of well-known mints (owner program and decimals checked on-chain, 4 Nov 2026).
 * Anything else a wallet holds is treated as unknown and hidden, like the NFT spam folder, because
 * airdropped look-alike tokens are the most common Solana scam.
 */
const MAINNET_TOKENS: SolanaTokenInfo[] = [
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, programId: TOKEN_PROGRAM_ID, geckoId: 'usd-coin' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether USD', decimals: 6, programId: TOKEN_PROGRAM_ID, geckoId: 'tether' },
  { mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6, programId: TOKEN_2022_PROGRAM_ID, geckoId: 'paypal-usd' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, programId: TOKEN_PROGRAM_ID, geckoId: 'jupiter-exchange-solana' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, programId: TOKEN_PROGRAM_ID, geckoId: 'bonk' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade staked SOL', decimals: 9, programId: TOKEN_PROGRAM_ID, geckoId: 'msol' },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'JitoSOL', name: 'Jito staked SOL', decimals: 9, programId: TOKEN_PROGRAM_ID, geckoId: 'jito-staked-sol' },
];

const DEVNET_TOKENS: SolanaTokenInfo[] = [
  // Circle's devnet USDC (faucet.circle.com).
  { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', symbol: 'USDC', name: 'USD Coin (devnet)', decimals: 6, programId: TOKEN_PROGRAM_ID, geckoId: 'usd-coin' },
];

export function knownSolanaTokens(cluster: SolanaCluster): SolanaTokenInfo[] {
  return cluster === 'devnet' ? DEVNET_TOKENS : MAINNET_TOKENS;
}

export function findKnownToken(mint: string, cluster: SolanaCluster): SolanaTokenInfo | undefined {
  return knownSolanaTokens(cluster).find((token) => token.mint === mint);
}

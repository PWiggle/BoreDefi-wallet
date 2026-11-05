/** Well-known Solana program and mint addresses (base58). */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

export const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Fixed fee per signature (lamports). */
export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** Rent-exempt minimum for a 0-data system account (lamports). */
export const RENT_EXEMPT_SYSTEM_ACCOUNT = 890_880n;
/** Rent-exempt minimum for a 165-byte SPL token account (lamports); refreshed from RPC when possible. */
export const RENT_EXEMPT_TOKEN_ACCOUNT = 2_039_280n;

export function isTokenProgram(programId: string): boolean {
  return programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID;
}

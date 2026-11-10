/**
 * Screenshot-proof builds only (EXPO_PUBLIC_PROOF_MODE=1 at bundle time). Store builds never set it, so the
 * Proof screen and its Settings row are compiled out. The Proof screen never signs or sends anything.
 */
export const PROOF_MODE = process.env.EXPO_PUBLIC_PROOF_MODE === '1';

/**
 * Proof builds only: show the NFTs tab for this read-only address (EXPO_PUBLIC_PROOF_NFT_OWNER) instead of the
 * emulator wallet, so screenshots go through the real Alchemy -> NftsScreen path with a real protected NFT.
 * Always null in store builds.
 */
export const PROOF_NFT_OWNER: string | null = PROOF_MODE ? (process.env.EXPO_PUBLIC_PROOF_NFT_OWNER ?? null) : null;

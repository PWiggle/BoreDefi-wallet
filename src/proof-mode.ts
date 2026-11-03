/**
 * Screenshot-proof builds only (EXPO_PUBLIC_PROOF_MODE=1 at bundle time). Store builds never set it, so the
 * Proof screen and its Settings row are compiled out. The Proof screen never signs or sends anything.
 */
export const PROOF_MODE = process.env.EXPO_PUBLIC_PROOF_MODE === '1';

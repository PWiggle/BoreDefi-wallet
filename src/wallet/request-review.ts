import type { ProtectedVerdict } from './protected-guard';
import { evaluateProtectedRequest } from './protected-runtime';
import { previewRequest } from './tx-preview-runtime';
import type { TxPreview } from './tx-simulate';

/**
 * One call for every dApp request (WalletConnect + in-app Browser): simulate it, build the plain-words preview,
 * and run the protected-asset guard with the simulation's findings. wc-sign recomputes the same verdict (cached
 * simulation) right before the key signs.
 */
export async function reviewDappRequest(input: {
  method: string;
  params: unknown[];
  chainId: number;
  owner: string;
}): Promise<{ verdict: ProtectedVerdict | null; preview: TxPreview }> {
  const staticVerdict = await evaluateProtectedRequest(input);
  const { preview, simulation } = await previewRequest({ ...input, blind: staticVerdict?.blind });
  const verdict = simulation ? await evaluateProtectedRequest({ ...input, simulation }) : staticVerdict;
  return { verdict, preview };
}

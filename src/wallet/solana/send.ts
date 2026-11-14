import { checkSolanaRecipient } from './address';
import { signSolanaMessage, solanaKeypairFromMnemonic } from './derive';
import {
  LAMPORTS_PER_SIGNATURE,
  RENT_EXEMPT_SYSTEM_ACCOUNT,
  RENT_EXEMPT_TOKEN_ACCOUNT,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  isTokenProgram,
} from './programs';
import {
  getAccountSummary,
  getBlockHeight,
  getLatestBlockhash,
  getPriorityFeeEstimate,
  getRentExemptMinimum,
  getSignatureStatus,
  sendRawTransaction,
  simulateTransaction,
  solanaRpc,
  type SimulationResult,
} from './rpc';
import {
  associatedTokenAddress,
  compileMessage,
  createAssociatedTokenAccountIdempotent,
  serializeMessage,
  serializeTransaction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  signatureToId,
  systemTransfer,
  tokenTransferChecked,
  type Instruction,
} from './tx';

/** Generous fixed compute limits; the fee charged is limit × price, so these stay tiny in SOL. */
export const CU_LIMIT_SOL = 1_000;
export const CU_LIMIT_SPL = 40_000;
export const CU_LIMIT_SPL_CREATE = 80_000;
/** Ceiling on the priority price we will ever attach (micro-lamports per CU). */
export const MAX_PRIORITY_MICRO_LAMPORTS = 2_000_000n;

export type SolanaSendAsset =
  | { kind: 'sol' }
  | { kind: 'spl'; mint: string; symbol: string; decimals: number; programId: string; sourceAccount: string; balance: bigint };

export type SolanaSendInput = {
  from: string;
  to: string;
  /** Base units (lamports for SOL). */
  amount: bigint;
  asset: SolanaSendAsset;
  solBalance: bigint;
  /** Recipient wallet account as read from RPC. */
  recipient: { exists: boolean; owner: string | null; lamports: bigint };
  /** SPL only: does the recipient's associated token account already exist? */
  recipientAtaExists?: boolean;
  priorityMicroLamports: bigint;
  tokenAccountRent?: bigint;
  /** Live rent-exempt minimum for a plain wallet account; falls back to the conservative constant. */
  systemAccountRent?: bigint;
};

export type SolanaSendPlan = {
  instructions: Instruction[];
  feeLamports: bigint;
  /** One-time rent for creating the recipient's token account (SPL only). */
  rentLamports: bigint;
  computeUnitLimit: number;
  priorityMicroLamports: bigint;
  destinationAccount: string;
  createsTokenAccount: boolean;
  warnings: string[];
};

export type PlanResult = { ok: true; plan: SolanaSendPlan } | { ok: false; message: string };

export function priorityFeeLamports(microLamportsPerCu: bigint, units: number): bigint {
  return (microLamportsPerCu * BigInt(units) + 999_999n) / 1_000_000n;
}

export function formatLamports(lamports: bigint, maxDecimals = 9): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  let fraction = (abs % 1_000_000_000n).toString().padStart(9, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Pure send planner: validates the recipient and amounts, prices the fee, and returns the exact instructions.
 * Everything the confirmation screen shows comes from this plan, and the signed transaction is built from it.
 */
export function planSolanaSend(input: SolanaSendInput): PlanResult {
  const check = checkSolanaRecipient(input.to, input.from);
  if (!check.ok) {
    return check;
  }
  if (input.amount <= 0n) {
    return { ok: false, message: 'Amount must be greater than zero.' };
  }
  if (input.recipient.exists && input.recipient.owner && isTokenProgram(input.recipient.owner)) {
    return {
      ok: false,
      message: 'That address is a token account, not a wallet. Ask for their main Solana wallet address.',
    };
  }
  const warnings: string[] = [];
  const minWalletBalance = input.systemAccountRent ?? RENT_EXEMPT_SYSTEM_ACCOUNT;
  const priority = input.priorityMicroLamports > MAX_PRIORITY_MICRO_LAMPORTS ? MAX_PRIORITY_MICRO_LAMPORTS : input.priorityMicroLamports < 0n ? 0n : input.priorityMicroLamports;
  const instructions: Instruction[] = [];
  let computeUnitLimit: number;
  let rentLamports = 0n;
  let destinationAccount = check.address;
  let createsTokenAccount = false;
  let solSpent: bigint;

  if (input.asset.kind === 'sol') {
    if (check.offCurve) {
      warnings.push('This address is a program account, not a normal wallet. Only continue if you know the app that owns it.');
    }
    if (input.recipient.exists && input.recipient.owner && input.recipient.owner !== SYSTEM_PROGRAM_ID) {
      warnings.push('This address is owned by a program, not a normal wallet.');
    }
    if (!input.recipient.exists && input.amount < minWalletBalance) {
      return {
        ok: false,
        message: `This address has never been used. Send at least ${formatLamports(minWalletBalance)} SOL so the network can open it.`,
      };
    }
    if (!input.recipient.exists) {
      warnings.push('This address has never been used on Solana. Double-check it is the right wallet.');
    }
    computeUnitLimit = CU_LIMIT_SOL;
    instructions.push(setComputeUnitLimit(computeUnitLimit), setComputeUnitPrice(priority), systemTransfer(input.from, check.address, input.amount));
    solSpent = input.amount;
  } else {
    const asset = input.asset;
    if (check.offCurve) {
      return { ok: false, message: 'That is a program account, not a wallet. Tokens sent there are usually lost.' };
    }
    if (!isTokenProgram(asset.programId)) {
      return { ok: false, message: 'Unsupported token program.' };
    }
    if (input.amount > asset.balance) {
      return { ok: false, message: `Not enough ${asset.symbol}.` };
    }
    if (input.recipientAtaExists === undefined) {
      return { ok: false, message: 'Could not check the recipient token account. Try again.' };
    }
    destinationAccount = associatedTokenAddress(check.address, asset.mint, asset.programId);
    createsTokenAccount = !input.recipientAtaExists;
    computeUnitLimit = createsTokenAccount ? CU_LIMIT_SPL_CREATE : CU_LIMIT_SPL;
    instructions.push(setComputeUnitLimit(computeUnitLimit), setComputeUnitPrice(priority));
    if (createsTokenAccount) {
      rentLamports = input.tokenAccountRent ?? RENT_EXEMPT_TOKEN_ACCOUNT;
      instructions.push(createAssociatedTokenAccountIdempotent(input.from, destinationAccount, check.address, asset.mint, asset.programId));
      warnings.push(`The recipient has no ${asset.symbol} account yet. Opening one costs about ${formatLamports(rentLamports, 5)} SOL, paid once by you.`);
    }
    instructions.push(
      tokenTransferChecked(asset.sourceAccount, asset.mint, destinationAccount, input.from, input.amount, asset.decimals, asset.programId),
    );
    solSpent = 0n;
  }

  const feeLamports = LAMPORTS_PER_SIGNATURE + priorityFeeLamports(priority, computeUnitLimit);
  const remaining = input.solBalance - solSpent - feeLamports - rentLamports;
  if (remaining < 0n) {
    const need = solSpent + feeLamports + rentLamports;
    return { ok: false, message: `Not enough SOL. This needs ${formatLamports(need)} SOL including the network fee.` };
  }
  if (remaining > 0n && remaining < minWalletBalance) {
    return {
      ok: false,
      message: `Leave at least ${formatLamports(minWalletBalance)} SOL in the wallet, or send the full balance with Max.`,
    };
  }
  return {
    ok: true,
    plan: { instructions, feeLamports, rentLamports, computeUnitLimit, priorityMicroLamports: priority, destinationAccount, createsTokenAccount, warnings },
  };
}

/** Largest SOL amount that leaves exactly zero after the fee. */
export function maxSolSendable(solBalance: bigint, priorityMicroLamports: bigint): bigint {
  const priority = priorityMicroLamports > MAX_PRIORITY_MICRO_LAMPORTS ? MAX_PRIORITY_MICRO_LAMPORTS : priorityMicroLamports;
  const fee = LAMPORTS_PER_SIGNATURE + priorityFeeLamports(priority, CU_LIMIT_SOL);
  return solBalance > fee ? solBalance - fee : 0n;
}

/** Reads everything the planner needs from RPC. */
export async function loadSendContext(
  from: string,
  to: string,
  asset: SolanaSendAsset,
  rpc = solanaRpc(),
): Promise<Pick<SolanaSendInput, 'recipient' | 'recipientAtaExists' | 'priorityMicroLamports' | 'tokenAccountRent' | 'systemAccountRent'>> {
  const recipient = await getAccountSummary(to.trim(), rpc);
  const systemAccountRent = await getRentExemptMinimum(0, rpc).catch(() => undefined);
  const writable = [from, to.trim()];
  let recipientAtaExists: boolean | undefined;
  let tokenAccountRent: bigint | undefined;
  if (asset.kind === 'spl') {
    const check = checkSolanaRecipient(to, from);
    if (check.ok && !check.offCurve) {
      const ata = associatedTokenAddress(check.address, asset.mint, asset.programId);
      writable.push(ata, asset.sourceAccount);
      const ataInfo = await getAccountSummary(ata, rpc);
      recipientAtaExists = ataInfo.exists;
      if (!ataInfo.exists) {
        // Token-2022 accounts can be larger than 165 bytes; 170 covers the ImmutableOwner extension ATAs get.
        tokenAccountRent = await getRentExemptMinimum(asset.programId === TOKEN_PROGRAM_ID ? 165 : 170, rpc).catch(
          () => undefined,
        );
      }
    }
  }
  const priorityMicroLamports = await getPriorityFeeEstimate(writable, rpc).catch(() => 0n);
  return { recipient, recipientAtaExists, priorityMicroLamports, tokenAccountRent, systemAccountRent };
}

export type SignedSolanaTx = { wire: Uint8Array; signature: string; lastValidBlockHeight: number };

export async function signPlan(mnemonic: string, from: string, plan: SolanaSendPlan, rpc = solanaRpc()): Promise<SignedSolanaTx> {
  const keypair = await solanaKeypairFromMnemonic(mnemonic);
  if (keypair.address !== from) {
    throw new Error('Solana key does not match this wallet.');
  }
  const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(rpc);
  const message = serializeMessage(compileMessage(from, plan.instructions, blockhash));
  const sig = signSolanaMessage(keypair, message);
  return { wire: serializeTransaction([sig], message), signature: signatureToId(sig), lastValidBlockHeight };
}

/**
 * Same as signPlan, but the signature comes from a hardware signer (the Ledger). The signer sees the exact message
 * bytes and must return a wire whose signature verifies for `from` (ledgerSignSolanaTx checks that).
 */
export async function signPlanExternal(
  from: string,
  plan: SolanaSendPlan,
  signWire: (wire: Uint8Array) => Promise<{ wire: Uint8Array; signature: string }>,
  rpc = solanaRpc(),
): Promise<SignedSolanaTx> {
  const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(rpc);
  const message = serializeMessage(compileMessage(from, plan.instructions, blockhash));
  const signed = await signWire(serializeTransaction([new Uint8Array(64)], message));
  return { wire: signed.wire, signature: signed.signature, lastValidBlockHeight };
}

/** Friendly text for the common simulation/preflight failures. */
export function friendlySolanaError(err: unknown, logs: string[] = []): string {
  const text = `${typeof err === 'string' ? err : JSON.stringify(err ?? '')} ${logs.join(' ')}`;
  if (/InvalidAccountForFee/.test(text)) {
    return 'This Solana account cannot pay network fees (a program has taken ownership of it). Nothing was sent.';
  }
  if (/InsufficientFundsForRent/i.test(text)) {
    return 'Not enough SOL left to keep the account open. Leave a little more SOL or send the full balance.';
  }
  if (/insufficient lamports|InsufficientFunds|AccountNotFound|Attempt to debit an account but found no record/i.test(text)) {
    return 'Not enough SOL for this send and the network fee.';
  }
  if (/insufficient funds/i.test(text) || /"Custom":1\b/.test(text)) {
    return 'Not enough tokens for this send.';
  }
  if (/BlockhashNotFound|blockhash/i.test(text)) {
    return 'The network moved on before this was sent. Review it again.';
  }
  if (/AccountFrozen|"Custom":17\b/.test(text)) {
    return 'This token account is frozen by the token issuer.';
  }
  return 'The network would reject this send. Nothing was sent.';
}

/**
 * Review-time simulation of the exact plan WITHOUT signing it. A signed transaction handed to an RPC can be
 * broadcast by that RPC, so nothing is signed until the user confirms.
 */
export async function simulatePlanUnsigned(from: string, plan: SolanaSendPlan, rpc = solanaRpc()): Promise<SimulationResult> {
  // Any valid 32-byte hash works: the RPC replaces it (replaceRecentBlockhash).
  const message = serializeMessage(compileMessage(from, plan.instructions, SYSTEM_PROGRAM_ID));
  return simulateTransaction(serializeTransaction([new Uint8Array(64)], message), rpc, false);
}

export type SolanaSendOutcome = { signature: string; status: 'confirmed' | 'pending' };

/**
 * Simulates, then broadcasts, then waits for "confirmed" until the blockhash expires (about a minute).
 * Returns 'pending' if the network is slow so the UI never claims success that has not landed.
 */
export async function broadcastAndConfirm(
  tx: SignedSolanaTx,
  rpc = solanaRpc(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPolls = 40,
): Promise<SolanaSendOutcome> {
  const simulation = await simulateTransaction(tx.wire, rpc);
  if (simulation.err) {
    throw new Error(friendlySolanaError(simulation.err, simulation.logs));
  }
  const signature = await sendRawTransaction(tx.wire, rpc);
  if (signature !== tx.signature) {
    throw new Error('RPC returned an unexpected transaction id.');
  }
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(1_500);
    const status = await getSignatureStatus(signature, rpc).catch(() => null);
    if (status?.err) {
      throw new Error(friendlySolanaError(status.err));
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { signature, status: 'confirmed' };
    }
    if (i % 5 === 4) {
      const height = await getBlockHeight(rpc).catch(() => 0);
      if (height > tx.lastValidBlockHeight) {
        throw new Error('The send expired before the network picked it up. Nothing left this wallet. Try again.');
      }
    }
  }
  return { signature, status: 'pending' };
}

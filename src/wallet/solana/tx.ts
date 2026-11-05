import { concatBytes } from '@noble/hashes/utils';

import { findProgramAddress, solanaAddressBytes } from './address';
import { encodeBase58 } from './base58';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  isTokenProgram,
} from './programs';

/**
 * Minimal legacy-transaction builder for the few instructions BoreDefi signs itself (SOL transfer, SPL
 * transferChecked, idempotent ATA creation, compute budget). Kept dependency-free on purpose: the byte
 * layout is cross-checked in tests against @solana/web3.js output.
 */

export type AccountMeta = { address: string; isSigner: boolean; isWritable: boolean };
export type Instruction = { programId: string; accounts: AccountMeta[]; data: Uint8Array };

export type CompiledMessage = {
  header: { numRequiredSignatures: number; numReadonlySigned: number; numReadonlyUnsigned: number };
  accountKeys: string[];
  recentBlockhash: string;
  instructions: Array<{ programIdIndex: number; accountIndexes: number[]; data: Uint8Array }>;
};

function toBytes(address: string): Uint8Array {
  const bytes = solanaAddressBytes(address);
  if (!bytes) {
    throw new Error(`Invalid Solana address: ${address}`);
  }
  return bytes;
}

export function encodeCompactU16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error('compact-u16 out of range');
  }
  const out: number[] = [];
  let rest = value;
  for (;;) {
    let elem = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(elem);
      return new Uint8Array(out);
    }
    elem |= 0x80;
    out.push(elem);
  }
}

export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

export function u64le(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error('u64 out of range');
  }
  // Manual little-endian write: DataView BigInt setters are not available on every Hermes version.
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

export function compileMessage(feePayer: string, instructions: Instruction[], recentBlockhash: string): CompiledMessage {
  type Entry = { isSigner: boolean; isWritable: boolean; order: number };
  const entries = new Map<string, Entry>();
  let order = 0;
  const touch = (address: string, isSigner: boolean, isWritable: boolean) => {
    toBytes(address);
    const current = entries.get(address);
    if (current) {
      current.isSigner ||= isSigner;
      current.isWritable ||= isWritable;
    } else {
      entries.set(address, { isSigner, isWritable, order: order++ });
    }
  };
  touch(feePayer, true, true);
  for (const ix of instructions) {
    for (const meta of ix.accounts) {
      touch(meta.address, meta.isSigner, meta.isWritable);
    }
    touch(ix.programId, false, false);
  }
  const rank = (entry: Entry) => (entry.isSigner ? (entry.isWritable ? 0 : 1) : entry.isWritable ? 2 : 3);
  const sorted = [...entries.entries()].sort(([a, ea], [b, eb]) => {
    if (a === feePayer) return -1;
    if (b === feePayer) return 1;
    return rank(ea) - rank(eb) || ea.order - eb.order;
  });
  const accountKeys = sorted.map(([address]) => address);
  const index = new Map(accountKeys.map((address, i) => [address, i]));
  const values = sorted.map(([, entry]) => entry);
  const header = {
    numRequiredSignatures: values.filter((e) => e.isSigner).length,
    numReadonlySigned: values.filter((e) => e.isSigner && !e.isWritable).length,
    numReadonlyUnsigned: values.filter((e) => !e.isSigner && !e.isWritable).length,
  };
  if (toBytes(recentBlockhash).length !== 32) {
    throw new Error('Invalid blockhash');
  }
  return {
    header,
    accountKeys,
    recentBlockhash,
    instructions: instructions.map((ix) => ({
      programIdIndex: index.get(ix.programId)!,
      accountIndexes: ix.accounts.map((meta) => index.get(meta.address)!),
      data: ix.data,
    })),
  };
}

export function serializeMessage(message: CompiledMessage): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([
      message.header.numRequiredSignatures,
      message.header.numReadonlySigned,
      message.header.numReadonlyUnsigned,
    ]),
    encodeCompactU16(message.accountKeys.length),
    ...message.accountKeys.map(toBytes),
    toBytes(message.recentBlockhash),
    encodeCompactU16(message.instructions.length),
  ];
  for (const ix of message.instructions) {
    parts.push(
      new Uint8Array([ix.programIdIndex]),
      encodeCompactU16(ix.accountIndexes.length),
      new Uint8Array(ix.accountIndexes),
      encodeCompactU16(ix.data.length),
      ix.data,
    );
  }
  return concatBytes(...parts);
}

/** Wire transaction: compact-u16 signature count, 64-byte signatures, then the message. */
export function serializeTransaction(signatures: Uint8Array[], messageBytes: Uint8Array): Uint8Array {
  for (const sig of signatures) {
    if (sig.length !== 64) {
      throw new Error('Signature must be 64 bytes');
    }
  }
  const out = concatBytes(encodeCompactU16(signatures.length), ...signatures, messageBytes);
  if (out.length > 1232) {
    throw new Error('Transaction too large');
  }
  return out;
}

/** The transaction id is the fee payer's signature in base58. */
export function signatureToId(signature: Uint8Array): string {
  return encodeBase58(signature);
}

// ---- Instructions ----

export function systemTransfer(from: string, to: string, lamports: bigint): Instruction {
  return {
    programId: SYSTEM_PROGRAM_ID,
    accounts: [
      { address: from, isSigner: true, isWritable: true },
      { address: to, isSigner: false, isWritable: true },
    ],
    data: concatBytes(u32le(2), u64le(lamports)),
  };
}

export function setComputeUnitLimit(units: number): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concatBytes(new Uint8Array([2]), u32le(units)) };
}

export function setComputeUnitPrice(microLamports: bigint): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concatBytes(new Uint8Array([3]), u64le(microLamports)) };
}

export function associatedTokenAddress(owner: string, mint: string, tokenProgramId = TOKEN_PROGRAM_ID): string {
  if (!isTokenProgram(tokenProgramId)) {
    throw new Error('Unknown token program');
  }
  const { address } = findProgramAddress(
    [toBytes(owner), toBytes(tokenProgramId), toBytes(mint)],
    toBytes(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return encodeBase58(address);
}

/** Associated Token Account program CreateIdempotent (instruction 1): no-op if the account exists. */
export function createAssociatedTokenAccountIdempotent(
  payer: string,
  ata: string,
  owner: string,
  mint: string,
  tokenProgramId = TOKEN_PROGRAM_ID,
): Instruction {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      { address: payer, isSigner: true, isWritable: true },
      { address: ata, isSigner: false, isWritable: true },
      { address: owner, isSigner: false, isWritable: false },
      { address: mint, isSigner: false, isWritable: false },
      { address: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { address: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([1]),
  };
}

/** SPL Token / Token-2022 TransferChecked (instruction 12): the program re-checks mint and decimals. */
export function tokenTransferChecked(
  source: string,
  mint: string,
  destination: string,
  owner: string,
  amount: bigint,
  decimals: number,
  tokenProgramId = TOKEN_PROGRAM_ID,
): Instruction {
  if (!isTokenProgram(tokenProgramId)) {
    throw new Error('Unknown token program');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Invalid decimals');
  }
  return {
    programId: tokenProgramId,
    accounts: [
      { address: source, isSigner: false, isWritable: true },
      { address: mint, isSigner: false, isWritable: false },
      { address: destination, isSigner: false, isWritable: true },
      { address: owner, isSigner: true, isWritable: false },
    ],
    data: concatBytes(new Uint8Array([12]), u64le(amount), new Uint8Array([decimals])),
  };
}

import { base64 } from '@scure/base';

import { decodeBase58, encodeBase58 } from './base58';
import { SOLANA_CLUSTER, type SolanaCluster } from './config';
import { SYSTEM_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, isTokenProgram } from './programs';

/**
 * WalletConnect for Solana: solana_signMessage and solana_signTransaction only. BoreDefi decodes every
 * transaction before it is signed and flags the instructions drainers use (account Assign, token Approve,
 * SetAuthority). Messages must be readable text so a transaction can't be slipped in as a "message".
 * The wallet never broadcasts a dApp's Solana transaction itself (no signAndSend).
 */

export const SOLANA_WC_METHODS = ['solana_signMessage', 'solana_signTransaction'] as const;

/** CAIP-2 ids (first 32 chars of the genesis hash). The 4sGj... id is the legacy mainnet ref some dApps still send. */
export const SOLANA_MAINNET_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_MAINNET_LEGACY_CAIP = 'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ';
export const SOLANA_DEVNET_CAIP = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export const SOLANA_WC_CHAINS: Record<string, string> = {
  [SOLANA_MAINNET_CAIP]: 'Solana',
  [SOLANA_MAINNET_LEGACY_CAIP]: 'Solana',
  [SOLANA_DEVNET_CAIP]: 'Solana Devnet',
};

/** Only the cluster this build talks to is offered to dApps. */
export function solanaWcChains(cluster: SolanaCluster = SOLANA_CLUSTER): string[] {
  return cluster === 'devnet' ? [SOLANA_DEVNET_CAIP] : [SOLANA_MAINNET_CAIP, SOLANA_MAINNET_LEGACY_CAIP];
}

export type ParsedSolanaTx = {
  version: 'legacy' | 0;
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
  numRequiredSignatures: number;
  staticKeys: string[];
  recentBlockhash: string;
  instructions: Array<{ programId: string; accounts: Array<string | null>; data: Uint8Array }>;
  lookupTables: number;
};

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  u8(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error('Solana transaction is truncated.');
    }
    return this.bytes[this.offset++];
  }
  compactU16(): number {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new Error('Solana transaction has a bad length field.');
  }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Solana transaction is truncated.');
    }
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

/** Parses a serialized message (legacy or v0). Throws on anything malformed. */
export function parseSolanaMessage(messageBytes: Uint8Array): Omit<ParsedSolanaTx, 'signatures' | 'messageBytes'> {
  const reader = new Reader(messageBytes);
  let version: 'legacy' | 0 = 'legacy';
  const first = messageBytes[0];
  if (first === undefined) {
    throw new Error('Solana transaction is empty.');
  }
  if (first & 0x80) {
    const v = first & 0x7f;
    if (v !== 0) {
      throw new Error(`Solana transaction version ${v} is not supported.`);
    }
    version = 0;
    reader.u8();
  }
  const numRequiredSignatures = reader.u8();
  reader.u8();
  reader.u8();
  const keyCount = reader.compactU16();
  const staticKeys: string[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    staticKeys.push(encodeBase58(reader.take(32)));
  }
  if (numRequiredSignatures < 1 || numRequiredSignatures > keyCount) {
    throw new Error('Solana transaction has a bad signer header.');
  }
  const recentBlockhash = encodeBase58(reader.take(32));
  const raw: Array<{ programIdIndex: number; accountIndexes: number[]; data: Uint8Array }> = [];
  const ixCount = reader.compactU16();
  for (let i = 0; i < ixCount; i += 1) {
    const programIdIndex = reader.u8();
    const accountCount = reader.compactU16();
    const accountIndexes: number[] = [];
    for (let j = 0; j < accountCount; j += 1) {
      accountIndexes.push(reader.u8());
    }
    const data = reader.take(reader.compactU16());
    raw.push({ programIdIndex, accountIndexes, data });
  }
  let lookupTables = 0;
  if (version === 0) {
    lookupTables = reader.compactU16();
    for (let i = 0; i < lookupTables; i += 1) {
      reader.take(32);
      reader.take(reader.compactU16());
      reader.take(reader.compactU16());
    }
  }
  if (!reader.done()) {
    throw new Error('Solana transaction has trailing bytes.');
  }
  const instructions = raw.map((ix) => {
    const programId = staticKeys[ix.programIdIndex];
    if (!programId) {
      throw new Error('Solana transaction points at a missing program.');
    }
    // Indexes past the static keys resolve through address lookup tables: unknown until loaded on-chain.
    return { programId, accounts: ix.accountIndexes.map((index) => staticKeys[index] ?? null), data: ix.data };
  });
  return { version, numRequiredSignatures, staticKeys, recentBlockhash, instructions, lookupTables };
}

export function parseSolanaTransaction(wire: Uint8Array): ParsedSolanaTx {
  const reader = new Reader(wire);
  const sigCount = reader.compactU16();
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < sigCount; i += 1) {
    signatures.push(reader.take(64));
  }
  const messageBytes = wire.slice(reader.offset);
  const message = parseSolanaMessage(messageBytes);
  if (sigCount !== message.numRequiredSignatures) {
    throw new Error('Solana transaction signature count does not match its header.');
  }
  return { ...message, signatures, messageBytes };
}

/** dApps send base64 (current spec); some older ones send base58. */
export function decodeWireTransaction(value: string): Uint8Array {
  const trimmed = value.trim();
  const attempts: Array<() => Uint8Array> = [() => base64.decode(trimmed), () => decodeBase58(trimmed)];
  for (const attempt of attempts) {
    try {
      const bytes = attempt();
      parseSolanaTransaction(bytes);
      return bytes;
    } catch {
      // try the next encoding
    }
  }
  throw new Error('That Solana transaction could not be read.');
}

function u32(data: Uint8Array): number | null {
  return data.length >= 4 ? (data[0] | (data[1] << 8) | (data[2] << 16)) + data[3] * 0x1000000 : null;
}

function u64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) {
    return null;
  }
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(data[offset + i]);
  }
  return value;
}

const KNOWN_PROGRAMS: Record<string, string> = {
  [SYSTEM_PROGRAM_ID]: 'System',
  [COMPUTE_BUDGET_PROGRAM_ID]: 'Compute budget',
  [ASSOCIATED_TOKEN_PROGRAM_ID]: 'Associated token account',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: 'Memo',
};

export type SolanaTxReview = {
  danger: boolean;
  summary: string;
  programs: string[];
  warnings: string[];
  feePayerIsWallet: boolean;
};

const LAMPORTS = 1_000_000_000n;

function sol(lamports: bigint): string {
  const whole = lamports / LAMPORTS;
  const frac = (lamports % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} SOL`;
}

/** Plain-words review with drainer red flags. Pure: no RPC. */
export function reviewSolanaTransaction(tx: Omit<ParsedSolanaTx, 'signatures' | 'messageBytes'>, wallet: string): SolanaTxReview {
  const warnings: string[] = [];
  let danger = false;
  let outgoing = 0n;
  const programs = new Set<string>();
  for (const ix of tx.instructions) {
    programs.add(KNOWN_PROGRAMS[ix.programId] ?? ix.programId);
    if (ix.programId === SYSTEM_PROGRAM_ID) {
      const kind = u32(ix.data);
      if ((kind === 1 || kind === 10) && ix.accounts[0] === wallet) {
        danger = true;
        warnings.push('Assigns your wallet account to another program. That hands over control of your SOL. Drainers use this.');
      }
      if (kind === 2 && ix.accounts[0] === wallet) {
        const lamports = u64(ix.data, 4);
        if (lamports !== null) {
          outgoing += lamports;
        }
      }
    } else if (isTokenProgram(ix.programId)) {
      const kind = ix.data[0];
      const ownerIsWallet = ix.accounts.includes(wallet);
      if ((kind === 4 || kind === 13) && ownerIsWallet) {
        danger = true;
        warnings.push('Token approval: lets another address spend your tokens without asking again.');
      }
      if (kind === 6 && ownerIsWallet) {
        danger = true;
        warnings.push('SetAuthority: gives control of your token account to another address. Drainers use this.');
      }
      if (kind === 9 && ownerIsWallet) {
        warnings.push('Closes one of your token accounts.');
      }
    }
  }
  const unknown = [...programs].filter((name) => !Object.values(KNOWN_PROGRAMS).includes(name));
  if (unknown.length) {
    warnings.push(`Runs ${unknown.length === 1 ? 'a program' : 'programs'} BoreDefi can't decode: ${unknown.join(', ')}. Only sign on a site you trust.`);
  }
  if (tx.lookupTables > 0) {
    warnings.push('Uses address lookup tables, so some accounts are only known on-chain.');
  }
  const feePayerIsWallet = tx.staticKeys[0] === wallet;
  const parts: string[] = [];
  if (outgoing > 0n) {
    parts.push(`Sends ${sol(outgoing)} from your wallet`);
  }
  parts.push(`${tx.instructions.length} instruction${tx.instructions.length === 1 ? '' : 's'}`);
  return {
    danger,
    summary: danger ? 'Danger: this transaction can hand over your funds' : parts.join(' · '),
    programs: [...programs],
    warnings,
    feePayerIsWallet,
  };
}

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/** Readable text only. Binary (which could be a transaction message in disguise) is refused. */
export function decodeSignableMessage(base58Message: string): { bytes: Uint8Array; text: string } {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(base58Message);
  } catch {
    throw new Error('That Solana message could not be read.');
  }
  if (!bytes.length) {
    throw new Error('That Solana message is empty.');
  }
  let text: string;
  try {
    text = TEXT_DECODER.decode(bytes);
  } catch {
    throw new Error('Blocked: this "message" is binary data, not text. It could be a hidden transaction.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('Blocked: this "message" contains hidden control bytes. It could be a hidden transaction.');
  }
  let looksLikeTx = false;
  try {
    parseSolanaMessage(bytes);
    looksLikeTx = true;
  } catch {
    looksLikeTx = false;
  }
  if (looksLikeTx) {
    throw new Error('Blocked: this "message" is really a Solana transaction.');
  }
  return { bytes, text };
}

export type SolanaWcKeypair = { address: string; publicKey: Uint8Array; secretKey: Uint8Array };
export type SolanaSigner = (message: Uint8Array) => Uint8Array;

export function signSolanaWcMessage(params: unknown, wallet: string, sign: SolanaSigner): { signature: string } {
  const input = (params ?? {}) as { message?: unknown; pubkey?: unknown };
  if (typeof input.message !== 'string') {
    throw new Error('Solana sign request is missing a message.');
  }
  if (typeof input.pubkey === 'string' && input.pubkey !== wallet) {
    throw new Error('That request is for a different Solana account.');
  }
  const { bytes } = decodeSignableMessage(input.message);
  return { signature: encodeBase58(sign(bytes)) };
}

export function readSolanaWcTransaction(params: unknown): { wire: Uint8Array; tx: ParsedSolanaTx } {
  const input = (params ?? {}) as { transaction?: unknown };
  if (typeof input.transaction !== 'string') {
    throw new Error('This dApp sent a Solana transaction in an old format BoreDefi does not sign.');
  }
  const wire = decodeWireTransaction(input.transaction);
  return { wire, tx: parseSolanaTransaction(wire) };
}

export function signSolanaWcTransaction(
  params: unknown,
  wallet: string,
  sign: SolanaSigner,
): { signature: string; transaction: string } {
  const { tx } = readSolanaWcTransaction(params);
  const index = tx.staticKeys.slice(0, tx.numRequiredSignatures).indexOf(wallet);
  if (index < 0) {
    throw new Error('This Solana transaction does not need your wallet to sign.');
  }
  const signature = sign(tx.messageBytes);
  const signatures = tx.signatures.map((item, i) => (i === index ? signature : item));
  const header = encodeCompactU16(signatures.length);
  const out = new Uint8Array(header.length + signatures.length * 64 + tx.messageBytes.length);
  out.set(header, 0);
  signatures.forEach((item, i) => out.set(item, header.length + i * 64));
  out.set(tx.messageBytes, header.length + signatures.length * 64);
  return { signature: encodeBase58(signature), transaction: base64.encode(out) };
}

function encodeCompactU16(value: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest) {
      byte |= 0x80;
      out.push(byte);
    } else {
      out.push(byte);
      return Uint8Array.from(out);
    }
  }
}

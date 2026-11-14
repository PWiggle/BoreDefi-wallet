import assert from 'node:assert/strict';
import test from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';
import { DeviceActionStatus, UserInteractionRequired } from '@ledgerhq/device-management-kit';
import { Subject } from 'rxjs';
import { Signature, toUtf8Bytes, TypedDataEncoder, Wallet } from 'ethers';

import { buildUnsignedLedgerTx } from './ledger';
import { ledgerBleEnabledFor, ledgerBleFlag } from './ledger-ble';
import {
  applyLedgerSolanaSignature,
  assembleLedgerEthTx,
  awaitDeviceAction,
  connectFirstLedger,
  DA_STATUS,
  hexToBytes,
  ledgerErrorMessage,
  ledgerPrompt,
  ledgerEthSignatureHex,
  ledgerSignEthMessage,
  ledgerSignEthTx,
  ledgerSignEthTypedData,
  ledgerSignSolanaMessage,
  ledgerSignSolanaTx,
  ledgerVerifyEthAddress,
  ledgerVerifySolanaAddress,
  verifyLedgerSolanaMessage,
  type LedgerTypedData,
  type DeviceActionStateLike,
  type DiscoveredLedger,
  type DmkLike,
  type EthSignerLike,
  type SolSignerLike,
} from './ledger-dmk';
import { encodeBase58 } from './solana/base58';

// Public Hardhat test key #0 (not a real wallet).
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function action<T>() {
  const subject = new Subject<DeviceActionStateLike<T>>();
  let cancelled = 0;
  return {
    subject,
    get cancelled() {
      return cancelled;
    },
    action: { observable: subject, cancel: () => (cancelled += 1) },
  };
}

test('DA_STATUS matches the DMK DeviceActionStatus enum', () => {
  assert.equal(DA_STATUS.NotStarted, DeviceActionStatus.NotStarted);
  assert.equal(DA_STATUS.Pending, DeviceActionStatus.Pending);
  assert.equal(DA_STATUS.Stopped, DeviceActionStatus.Stopped);
  assert.equal(DA_STATUS.Completed, DeviceActionStatus.Completed);
  assert.equal(DA_STATUS.Error, DeviceActionStatus.Error);
});

test('ledgerPrompt covers the DMK user interactions the wallet hits', () => {
  assert.match(ledgerPrompt(UserInteractionRequired.UnlockDevice, 'Ethereum') ?? '', /Unlock/);
  assert.match(ledgerPrompt(UserInteractionRequired.ConfirmOpenApp, 'Solana') ?? '', /Solana app/);
  assert.match(ledgerPrompt(UserInteractionRequired.SignTransaction, 'Ethereum') ?? '', /Review the transaction/);
  assert.match(ledgerPrompt(UserInteractionRequired.VerifyAddress, 'Ethereum') ?? '', /address/);
  assert.equal(ledgerPrompt(UserInteractionRequired.None, 'Ethereum'), null);
  assert.equal(ledgerPrompt(undefined, 'Ethereum'), null);
});

test('ledgerErrorMessage maps rejects, lock, missing app, blind signing and disconnects', () => {
  assert.match(ledgerErrorMessage({ errorCode: '6985' }), /rejected/);
  assert.match(ledgerErrorMessage({ _tag: 'RefusedByUserDAError' }), /rejected/);
  assert.match(ledgerErrorMessage({ errorCode: '5515' }), /locked/);
  assert.match(ledgerErrorMessage({ _tag: 'AppNotFoundDAError' }), /not installed/);
  assert.match(ledgerErrorMessage({ message: 'Blind signing disabled' }), /Blind signing/);
  assert.match(ledgerErrorMessage({ _tag: 'DeviceDisconnectedWhileSendingError' }), /disconnected/);
  assert.match(ledgerErrorMessage({ message: 'weird' }), /Ledger error: weird/);
  assert.match(ledgerErrorMessage(null), /did not sign/);
});

test('awaitDeviceAction relays prompts and resolves on completion', async () => {
  const a = action<{ address: string }>();
  const prompts: (string | null)[] = [];
  const done = awaitDeviceAction(a.action, { onPrompt: (m) => prompts.push(m), timeoutMs: 1000 });
  a.subject.next({ status: DA_STATUS.Pending, intermediateValue: { requiredUserInteraction: 'unlock-device' } });
  a.subject.next({ status: DA_STATUS.Completed, output: { address: '0xabc' } });
  assert.deepEqual(await done, { address: '0xabc' });
  assert.match(prompts[0] ?? '', /Unlock/);
  assert.equal(prompts.at(-1), null);
});

test('awaitDeviceAction rejects on device error, stop, and timeout (cancelling the action)', async () => {
  const errored = action<string>();
  const p1 = awaitDeviceAction(errored.action, { timeoutMs: 1000 });
  errored.subject.next({ status: DA_STATUS.Error, error: { errorCode: '6985' } });
  await assert.rejects(p1, /rejected/);

  const stopped = action<string>();
  const p2 = awaitDeviceAction(stopped.action, { timeoutMs: 1000 });
  stopped.subject.next({ status: DA_STATUS.Stopped });
  await assert.rejects(p2, /stopped/);

  const silent = action<string>();
  await assert.rejects(awaitDeviceAction(silent.action, { timeoutMs: 10 }), /did not answer/);
  assert.equal(silent.cancelled, 1);
});

test('connectFirstLedger prefers the remembered device and stops scanning', async () => {
  const found = new Subject<DiscoveredLedger>();
  let stopped = 0;
  let connectedTo = '';
  const dmk: DmkLike = {
    startDiscovering: () => found,
    stopDiscovering: async () => {
      stopped += 1;
    },
    connect: async ({ device }) => {
      connectedTo = device.id;
      return 'session-1';
    },
    disconnect: async () => undefined,
  };
  const pending = connectFirstLedger(dmk, { timeoutMs: 1000, preferId: 'nanox', graceMs: 500 });
  found.next({ id: 'other', name: 'Nano X 9999' });
  found.next({ id: 'nanox', name: 'Nano X 1A2B' });
  const { sessionId, device } = await pending;
  assert.equal(sessionId, 'session-1');
  assert.equal(device.id, 'nanox');
  assert.equal(connectedTo, 'nanox');
  assert.equal(stopped, 1);
});

test('connectFirstLedger times out when no Ledger shows up', async () => {
  const dmk: DmkLike = {
    startDiscovering: () => new Subject<DiscoveredLedger>(),
    stopDiscovering: async () => undefined,
    connect: async () => 'never',
    disconnect: async () => undefined,
  };
  await assert.rejects(connectFirstLedger(dmk, { timeoutMs: 10 }), /No Ledger found/);
});

function unsignedTx() {
  return buildUnsignedLedgerTx({
    chainId: 8453,
    to: '0x000000000000000000000000000000000000dEaD',
    value: 10_000_000_000_000_000n,
    data: '0x',
    nonce: 7,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    gasLimit: 21_000n,
  });
}

async function ledgerStyleSignature(unsignedHex: string) {
  const wallet = new Wallet(TEST_KEY);
  const { Transaction } = await import('ethers');
  const tx = Transaction.from(`0x${unsignedHex.replace(/^0x/, '')}`);
  const sig = wallet.signingKey.sign(tx.unsignedHash);
  // Ledger returns r/s as hex without 0x, and v as the y-parity for typed txs.
  return { wallet, sig: { r: sig.r.slice(2), s: sig.s.slice(2), v: sig.yParity } };
}

test('assembleLedgerEthTx builds a raw tx that recovers to the Ledger address', async () => {
  const unsignedHex = unsignedTx();
  const { wallet, sig } = await ledgerStyleSignature(unsignedHex);
  const raw = assembleLedgerEthTx(unsignedHex, sig, wallet.address);
  const { Transaction } = await import('ethers');
  const parsed = Transaction.from(raw);
  assert.equal(parsed.from, wallet.address);
  assert.equal(parsed.chainId, 8453n);
  assert.equal(parsed.nonce, 7);
});

test('assembleLedgerEthTx refuses a signature from a different key', async () => {
  const unsignedHex = unsignedTx();
  const { sig } = await ledgerStyleSignature(unsignedHex);
  assert.throws(
    () => assembleLedgerEthTx(unsignedHex, sig, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'),
    /does not match your Ledger address/,
  );
});

test('ledgerSignEthTx sends the unsigned tx bytes to the signer', async () => {
  const unsignedHex = unsignedTx();
  const { wallet, sig } = await ledgerStyleSignature(unsignedHex);
  const a = action<{ r: string; s: string; v: number }>();
  let sentPath = '';
  let sentBytes: Uint8Array = new Uint8Array();
  const signer: EthSignerLike = {
    getAddress: () => {
      throw new Error('unused');
    },
    signTransaction: (path, bytes) => {
      sentPath = path;
      sentBytes = bytes;
      queueMicrotask(() => a.subject.next({ status: DA_STATUS.Completed, output: sig }));
      return a.action;
    },
  };
  const raw = await ledgerSignEthTx(signer, unsignedHex, wallet.address);
  assert.equal(sentPath, "44'/60'/0'/0/0");
  assert.deepEqual(sentBytes, hexToBytes(unsignedHex));
  assert.ok(raw.startsWith('0x02'));
});

/** Legacy Solana tx: 1 signer + 1 readonly program, empty instruction list. */
function solanaWire(signer: Uint8Array): Uint8Array {
  const program = new Uint8Array(32).fill(7);
  const blockhash = new Uint8Array(32).fill(9);
  const message = new Uint8Array([1, 0, 1, 2, ...signer, ...program, ...blockhash, 0]);
  return new Uint8Array([1, ...new Uint8Array(64), ...message]);
}

test('applyLedgerSolanaSignature verifies and inserts the signature', () => {
  const secret = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(secret);
  const wire = solanaWire(pub);
  const message = wire.slice(65);
  const signature = ed25519.sign(message, secret);
  const out = applyLedgerSolanaSignature(wire, encodeBase58(pub), signature);
  assert.deepEqual(out.wire.slice(1, 65), signature);
  assert.deepEqual(out.wire.slice(65), message);
  assert.equal(out.signature, encodeBase58(signature));
  // The input is not mutated.
  assert.deepEqual(wire.slice(1, 65), new Uint8Array(64));
});

test('applyLedgerSolanaSignature rejects a bad signature or a non-signer', () => {
  const secret = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(secret);
  const wire = solanaWire(pub);
  const wrong = ed25519.sign(new Uint8Array([1, 2, 3]), secret);
  assert.throws(() => applyLedgerSolanaSignature(wire, encodeBase58(pub), wrong), /does not verify/);
  const other = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
  assert.throws(() => applyLedgerSolanaSignature(wire, encodeBase58(other), wrong), /does not need your Ledger/);
});

test('ledgerSignSolanaTx sends only the message bytes and returns the signed wire', async () => {
  const secret = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(secret);
  const wire = solanaWire(pub);
  const a = action<Uint8Array>();
  let sentPath = '';
  const signer: SolSignerLike = {
    getAddress: () => {
      throw new Error('unused');
    },
    signTransaction: (path, bytes) => {
      sentPath = path;
      queueMicrotask(() => a.subject.next({ status: DA_STATUS.Completed, output: ed25519.sign(bytes, secret) }));
      return a.action;
    },
  };
  const out = await ledgerSignSolanaTx(signer, wire, encodeBase58(pub));
  assert.equal(sentPath, "44'/501'/0'");
  assert.ok(ed25519.verify(out.wire.slice(1, 65), wire.slice(65), pub));
});

test('hexToBytes and the BLE flag parse strictly', () => {
  assert.deepEqual(hexToBytes('0x0aff'), new Uint8Array([10, 255]));
  assert.throws(() => hexToBytes('0xabc'), /Invalid hex/);
  assert.throws(() => hexToBytes('zz'), /Invalid hex/);
  assert.equal(ledgerBleFlag('1'), true);
  assert.equal(ledgerBleFlag(' true '), true);
  assert.equal(ledgerBleFlag('0'), false);
  assert.equal(ledgerBleFlag(undefined), false);
});

test('connectFirstLedger falls back to another Ledger after the grace period', async () => {
  const found = new Subject<DiscoveredLedger>();
  const dmk: DmkLike = {
    startDiscovering: () => found,
    stopDiscovering: async () => undefined,
    connect: async ({ device }) => `s-${device.id}`,
    disconnect: async () => undefined,
  };
  const pending = connectFirstLedger(dmk, { timeoutMs: 1000, preferId: 'gone', graceMs: 20 });
  found.next({ id: 'new-id', name: 'Nano X 1A2B' });
  const { sessionId } = await pending;
  assert.equal(sessionId, 's-new-id');
});

test('Ledger BLE is per platform: Android flag alone, iPhone needs both (hidden by default)', () => {
  assert.equal(ledgerBleEnabledFor('android', '1', undefined), true);
  assert.equal(ledgerBleEnabledFor('android', undefined, '1'), false);
  assert.equal(ledgerBleEnabledFor('ios', '1', undefined), false);
  assert.equal(ledgerBleEnabledFor('ios', '1', '1'), true);
  assert.equal(ledgerBleEnabledFor('ios', undefined, '1'), false);
  assert.equal(ledgerBleEnabledFor('web', '1', '1'), false);
});

function completing<T>(output: T) {
  const a = action<T>();
  queueMicrotask(() => a.subject.next({ status: DA_STATUS.Completed, output }));
  return a.action;
}

test('show-on-device verification asks the device to display and refuses a different address', async () => {
  const wallet = new Wallet(TEST_KEY);
  let checked: boolean | undefined;
  const signer: EthSignerLike = {
    getAddress: (_path, options) => {
      checked = options?.checkOnDevice;
      return completing({ address: wallet.address, publicKey: '04' });
    },
    signTransaction: () => {
      throw new Error('unused');
    },
  };
  assert.equal(await ledgerVerifyEthAddress(signer, wallet.address.toLowerCase()), wallet.address);
  assert.equal(checked, true);
  await assert.rejects(ledgerVerifyEthAddress(signer, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), /different address/);

  const sol: SolSignerLike = {
    getAddress: () => completing(new Uint8Array(32).fill(3)),
    signTransaction: () => {
      throw new Error('unused');
    },
  };
  const expected = encodeBase58(new Uint8Array(32).fill(3));
  assert.equal(await ledgerVerifySolanaAddress(sol, expected), expected);
  await assert.rejects(ledgerVerifySolanaAddress(sol, encodeBase58(new Uint8Array(32).fill(4))), /different Solana address/);
});

test('ledgerEthSignatureHex accepts y-parity or 27/28 v', () => {
  const wallet = new Wallet(TEST_KEY);
  const sig = wallet.signingKey.sign(`0x${'11'.repeat(32)}`);
  const fromParity = ledgerEthSignatureHex({ r: sig.r.slice(2), s: sig.s.slice(2), v: sig.yParity });
  const from27 = ledgerEthSignatureHex({ r: sig.r, s: sig.s, v: sig.v });
  assert.equal(fromParity, sig.serialized);
  assert.equal(from27, sig.serialized);
});

test('ledgerSignEthMessage (personal_sign) returns a signature that recovers to the Ledger address', async () => {
  const wallet = new Wallet(TEST_KEY);
  let sent: Uint8Array | string = '';
  const signer: EthSignerLike = {
    getAddress: () => {
      throw new Error('unused');
    },
    signTransaction: () => {
      throw new Error('unused');
    },
    signMessage: (_path, message) => {
      sent = message;
      const sig = Signature.from(wallet.signMessageSync(message));
      return completing({ r: sig.r.slice(2), s: sig.s.slice(2), v: sig.v });
    },
  };
  const out = await ledgerSignEthMessage(signer, 'hello ledger', wallet.address);
  assert.deepEqual(sent, toUtf8Bytes('hello ledger'));
  assert.equal(out, wallet.signMessageSync('hello ledger'));
  // WalletConnect-style 0x hex is signed as bytes.
  await ledgerSignEthMessage(signer, '0x68656c6c6f', wallet.address);
  assert.deepEqual(sent, new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
  await assert.rejects(ledgerSignEthMessage(signer, 'x', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), /does not match/);
});

test('ledgerSignEthTypedData verifies the EIP-712 signature', async () => {
  const wallet = new Wallet(TEST_KEY);
  const typedData: LedgerTypedData = {
    domain: { name: 'BoreDefi', version: '1', chainId: 1, verifyingContract: '0x000000000000000000000000000000000000dEaD' },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Mail: [{ name: 'contents', type: 'string' }],
    },
    primaryType: 'Mail',
    message: { contents: 'gm' },
  };
  const signer: EthSignerLike = {
    getAddress: () => {
      throw new Error('unused');
    },
    signTransaction: () => {
      throw new Error('unused');
    },
    signTypedData: () => {
      const digest = TypedDataEncoder.hash(typedData.domain, { Mail: typedData.types.Mail! }, typedData.message);
      const sig = wallet.signingKey.sign(digest);
      return completing({ r: sig.r, s: sig.s, v: sig.yParity });
    },
  };
  const out = await ledgerSignEthTypedData(signer, typedData, wallet.address);
  assert.equal(Signature.from(out).serialized, out);
  await assert.rejects(ledgerSignEthTypedData(signer, typedData, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), /does not match/);
});

test('Solana message signing: envelope or raw signature, verified over the signed bytes', async () => {
  const secret = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(secret);
  const address = encodeBase58(pub);
  const message = toUtf8Bytes('hello solana');
  // Off-chain message V0-style: some header + the message; the kit returns [1][sig][signed bytes].
  const signedBytes = new Uint8Array([0xff, ...toUtf8Bytes('solana offchain'), 0, ...message]);
  const sig = ed25519.sign(signedBytes, secret);
  const envelope = encodeBase58(new Uint8Array([1, ...sig, ...signedBytes]));
  assert.equal(verifyLedgerSolanaMessage(envelope, message, address).signature, encodeBase58(sig));
  // Raw 64-byte signature over the message itself.
  assert.equal(verifyLedgerSolanaMessage(encodeBase58(ed25519.sign(message, secret)), message, address).signature.length > 0, true);
  // A different message in the envelope is refused.
  assert.throws(() => verifyLedgerSolanaMessage(envelope, toUtf8Bytes('other'), address), /different message/);
  // Wrong key is refused.
  const other = encodeBase58(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
  assert.throws(() => verifyLedgerSolanaMessage(envelope, message, other), /does not verify/);

  const signer: SolSignerLike = {
    getAddress: () => {
      throw new Error('unused');
    },
    signTransaction: () => {
      throw new Error('unused');
    },
    signMessage: () => completing({ signature: envelope }),
  };
  const out = await ledgerSignSolanaMessage(signer, 'hello solana', address);
  assert.equal(out.signature, encodeBase58(sig));
});

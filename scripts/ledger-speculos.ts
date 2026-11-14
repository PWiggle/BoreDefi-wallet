/**
 * Ledger signing test against the Speculos emulator (Ledger's free device emulator), using Ledger's real
 * Ethereum and Solana apps and the exact same code the app uses (src/wallet/ledger-dmk.ts), with the DMK Speculos
 * transport in place of Bluetooth.
 *
 *   SPECULOS_ETH_URL=http://127.0.0.1:5000 SPECULOS_SOL_URL=http://127.0.0.1:5001 npx tsx scripts/ledger-speculos.ts
 *
 * scripts/ledger-speculos.sh starts both emulators (Nano X). Speculos runs with its well-known public test seed
 * ("glory promote … raise skin"), which is not a secret and never holds funds. The test:
 *  1. reads the ETH address on 44'/60'/0'/0/0 and checks it matches the same seed derived in software,
 *  2. signs an EIP-1559 ETH transfer, presses the emulator buttons to approve, and checks the signed tx recovers,
 *  3. reads the Solana address on 44'/501'/0' and checks it against software derivation,
 *  4. signs a SOL transfer and verifies the ed25519 signature,
 *  5. rejects a transaction on the device and checks the wallet reports the rejection,
 *  6. shows the ETH and SOL addresses on the device screen (Check address on Ledger) and approves,
 *  7. signs a personal_sign message (ETH) and a Solana off-chain message, verifying both signatures.
 */
import assert from 'node:assert/strict';

import { DeviceManagementKitBuilder } from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { SignerSolanaBuilder } from '@ledgerhq/device-signer-kit-solana';
import { speculosTransportFactory } from '@ledgerhq/device-transport-kit-speculos';
import { HDNodeWallet, Mnemonic, Transaction } from 'ethers';

import { buildUnsignedLedgerTx } from '../src/wallet/ledger';
import {
  connectFirstLedger,
  ledgerEthAddress,
  ledgerSignEthMessage,
  ledgerSignEthTx,
  ledgerSignSolanaMessage,
  ledgerSignSolanaTx,
  ledgerSolanaAddress,
  ledgerVerifyEthAddress,
  ledgerVerifySolanaAddress,
  LEDGER_ETH_PATH,
  LEDGER_SOL_PATH,
  type DmkLike,
  type EthSignerLike,
  type SolSignerLike,
} from '../src/wallet/ledger-dmk';
import { slip10DeriveEd25519, keypairFromSecret } from '../src/wallet/solana/derive';
import { compileMessage, serializeMessage, serializeTransaction, systemTransfer } from '../src/wallet/solana/tx';
import { encodeBase58 } from '../src/wallet/solana/base58';

const SPECULOS_TEST_SEED =
  'glory promote mansion idle axis finger extra february uncover one trip resource lawn turtle enact monster seven myth punch hobby comfort wild raise skin';

const ETH_URL = process.env.SPECULOS_ETH_URL ?? 'http://127.0.0.1:5000';
const SOL_URL = process.env.SPECULOS_SOL_URL ?? 'http://127.0.0.1:5001';

type Screen = { text: string };

async function screen(url: string): Promise<string> {
  const res = await fetch(`${url}/events?currentscreenonly=true`);
  const body = (await res.json()) as { events?: Screen[] };
  return (body.events ?? []).map((e) => e.text).join(' | ');
}

async function press(url: string, button: 'left' | 'right' | 'both'): Promise<void> {
  await fetch(`${url}/button/${button}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'press-and-release' }),
  });
}

/** Walks the review screens: right until the approve (or reject) screen, then both buttons. */
function autoPress(url: string, mode: 'approve' | 'reject', log: string[]): { stop: () => void } {
  let stopped = false;
  const target = mode === 'approve' ? /(Sign transaction|Accept|Approve|Confirm|Sign message)/i : /^(Reject|Reject transaction)/i;
  void (async () => {
    let last = '';
    for (let i = 0; i < 200 && !stopped; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      const text = await screen(url).catch(() => '');
      if (!text || /app is ready|is ready/i.test(text)) {
        continue;
      }
      if (text !== last) {
        log.push(text);
        last = text;
      }
      if (target.test(text.trim()) && !(mode === 'approve' && /^Reject/i.test(text.trim()))) {
        await press(url, 'both');
      } else {
        await press(url, 'right');
      }
    }
  })();
  return { stop: () => { stopped = true; } };
}

async function dmkFor(url: string): Promise<{ dmk: DmkLike & { close: () => void }; sessionId: string }> {
  const dmk = new DeviceManagementKitBuilder().addTransport(speculosTransportFactory(url)).build();
  const { sessionId } = await connectFirstLedger(dmk as unknown as DmkLike, { timeoutMs: 15_000 });
  return { dmk: dmk as unknown as DmkLike & { close: () => void }, sessionId };
}

async function main() {
  const results: string[] = [];
  const mnemonic = Mnemonic.fromPhrase(SPECULOS_TEST_SEED);

  // ---------- Ethereum ----------
  {
    const { dmk, sessionId } = await dmkFor(ETH_URL);
    const signer = new SignerEthBuilder({ dmk: dmk as never, sessionId }).build() as unknown as EthSignerLike;
    const address = await ledgerEthAddress(signer);
    const expected = HDNodeWallet.fromMnemonic(mnemonic, `m/${LEDGER_ETH_PATH}`).address;
    assert.equal(address.toLowerCase(), expected.toLowerCase(), 'ETH address matches software derivation');
    results.push(`ETH address ${address} (matches ${LEDGER_ETH_PATH} software derivation)`);

    const unsigned = buildUnsignedLedgerTx({
      chainId: 1,
      to: '0x1111111111111111111111111111111111111111',
      value: 10_000_000_000_000_000n,
      data: '0x',
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    const screens: string[] = [];
    const presser = autoPress(ETH_URL, 'approve', screens);
    const raw = await ledgerSignEthTx(signer, unsigned, address, { onPrompt: (m) => m && screens.push(`[prompt] ${m}`) });
    presser.stop();
    const tx = Transaction.from(raw);
    assert.equal(tx.from?.toLowerCase(), address.toLowerCase());
    assert.equal(tx.chainId, 1n);
    assert.equal(tx.value, 10_000_000_000_000_000n);
    results.push(`ETH transfer signed on device, recovers to ${tx.from}; screens: ${screens.join(' → ')}`);

    // Show-on-device address check
    const verifyScreens: string[] = [];
    const verifier = autoPress(ETH_URL, 'approve', verifyScreens);
    await ledgerVerifyEthAddress(signer, address);
    verifier.stop();
    results.push(`ETH address shown on device and approved; screens: ${verifyScreens.join(' → ')}`);

    // personal_sign
    const msgScreens: string[] = [];
    const msgPresser = autoPress(ETH_URL, 'approve', msgScreens);
    const msgSig = await ledgerSignEthMessage(signer, 'BoreDefi Wallet Ledger test. This signature does not move funds.', address);
    msgPresser.stop();
    results.push(`ETH personal_sign on device, recovers to the Ledger address (${msgSig.slice(0, 12)}…); screens: ${msgScreens.join(' → ')}`);

    // Rejection path
    const rejectScreens: string[] = [];
    const rejecter = autoPress(ETH_URL, 'reject', rejectScreens);
    await assert.rejects(ledgerSignEthTx(signer, unsigned, address), /rejected it on the Ledger/);
    rejecter.stop();
    results.push('ETH reject on device → "You rejected it on the Ledger. Nothing was signed."');
    await dmk.disconnect({ sessionId }).catch(() => undefined);
    dmk.close();
  }

  // ---------- Solana ----------
  {
    const { dmk, sessionId } = await dmkFor(SOL_URL);
    const signer = new SignerSolanaBuilder({ dmk: dmk as never, sessionId }).build() as unknown as SolSignerLike;
    const address = await ledgerSolanaAddress(signer);
    const seed = mnemonic.computeSeed();
    const expected = keypairFromSecret(slip10DeriveEd25519(Uint8Array.from(Buffer.from(seed.slice(2), 'hex')), `m/${LEDGER_SOL_PATH}`)).address;
    assert.equal(address, expected, 'Solana address matches software derivation');
    results.push(`SOL address ${address} (matches ${LEDGER_SOL_PATH} software derivation)`);

    const message = compileMessage(address, [systemTransfer(address, '11111111111111111111111111111112', 1_000_000n)], encodeBase58(new Uint8Array(32).fill(5)));
    const wire = serializeTransaction([new Uint8Array(64)], serializeMessage(message));
    const screens: string[] = [];
    const presser = autoPress(SOL_URL, 'approve', screens);
    const signed = await ledgerSignSolanaTx(signer, wire, address, { onPrompt: (m) => m && screens.push(`[prompt] ${m}`) });
    presser.stop();
    results.push(`SOL transfer signed on device, ed25519 verified (${signed.signature.slice(0, 12)}…); screens: ${screens.join(' → ')}`);

    const verifyScreens: string[] = [];
    const verifier = autoPress(SOL_URL, 'approve', verifyScreens);
    await ledgerVerifySolanaAddress(signer, address);
    verifier.stop();
    results.push(`SOL address shown on device and approved; screens: ${verifyScreens.join(' → ')}`);

    const msgScreens: string[] = [];
    const msgPresser = autoPress(SOL_URL, 'approve', msgScreens);
    const msg = await ledgerSignSolanaMessage(signer, 'BoreDefi Wallet Ledger test. This signature does not move funds.', address);
    msgPresser.stop();
    results.push(`SOL off-chain message signed on device, ed25519 verified (${msg.signature.slice(0, 12)}…); screens: ${msgScreens.join(' → ')}`);
    await dmk.disconnect({ sessionId }).catch(() => undefined);
    dmk.close();
  }

  console.log(results.map((line) => `✔ ${line}`).join('\n'));
  process.exit(0);
}

main().catch((error) => {
  console.error('✖', error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

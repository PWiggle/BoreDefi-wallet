import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  connectableAccounts,
  pairingTopic,
  resolveConnectAccount,
  sourceWalletNotice,
  walletLinkSource,
} from './wc-source';

const WC =
  'wc:d8b7145b82f16012149ee605786ad991ea0b713e7303f208715622bcdfe6937b@2?relay-protocol=irn&symKey=c500d215e3a3311d091fa21ea0dcc102eb23376d53cd330f4806d187e83aff70';
const ENC = encodeURIComponent(WC);
const ACTIVE = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const BOREDSWAP_FEE_WALLET = '0x640Ebc069e89e5691AaD192420D22a4B92443387';

test('names the wallet a page meant to open when it handed BoreDefi a WalletConnect link', () => {
  assert.equal(walletLinkSource(`metamask://wc?uri=${ENC}`), 'MetaMask');
  assert.equal(walletLinkSource(`https://metamask.app.link/wc?uri=${ENC}`), 'MetaMask');
  assert.equal(walletLinkSource(`trust://wc?uri=${ENC}`), 'Trust Wallet');
  assert.equal(walletLinkSource(`https://link.trustwallet.com/wc?uri=${ENC}`), 'Trust Wallet');
  assert.equal(walletLinkSource(`rainbow://wc?uri=${ENC}`), 'Rainbow');
  assert.equal(walletLinkSource(`cbwallet://wc?uri=${ENC}`), 'Coinbase Wallet');
  assert.equal(walletLinkSource(`intent://wc?uri=${ENC}#Intent;scheme=metamask;package=io.metamask;end`), 'MetaMask');
  assert.equal(walletLinkSource(`someotherwallet://wc?uri=${ENC}`), 'another wallet app');
});

test("BoreDefi's own links (BoredSwap's BoreDefi tile, raw wc:, boredefi.com) show no other-wallet notice", () => {
  assert.equal(walletLinkSource(WC), null);
  assert.equal(walletLinkSource(`boredefi://wc?uri=${ENC}`), null);
  assert.equal(walletLinkSource(`https://www.boredefi.com/wc?uri=${ENC}`), null);
  assert.equal(walletLinkSource(`intent://wc?uri=${ENC}#Intent;scheme=boredefi;end`), null);
  assert.equal(walletLinkSource('not a link'), null);
});

test('the notice says clearly that BoreDefi connects instead of the picked wallet', () => {
  const text = sourceWalletNotice('MetaMask');
  assert.match(text, /You picked MetaMask on this site\./);
  assert.match(text, /connects your BoreDefi wallet instead/);
});

test('pairing topic comes from the wc: URI', () => {
  assert.equal(pairingTopic(WC), 'd8b7145b82f16012149ee605786ad991ea0b713e7303f208715622bcdfe6937b');
  assert.equal(pairingTopic('https://x'), null);
});

test('connect accounts are the active BoreDefi wallet (EVM + its Solana address), never a page value', () => {
  const accounts = connectableAccounts({ address: ACTIVE, solanaAddress: 'H9xUMrv7dYd3gyGdsCEH7muhm4TyG3qYsbgTPFSndvF1' });
  assert.deepEqual(accounts, [
    { address: ACTIVE, label: 'Wallet 1', solanaAddress: 'H9xUMrv7dYd3gyGdsCEH7muhm4TyG3qYsbgTPFSndvF1', active: true },
  ]);
  assert.deepEqual(connectableAccounts({ address: null }), []);
  assert.deepEqual(connectableAccounts({ address: 'nope' }), []);
  // Default = active; a picked address that isn't one of the user's accounts is ignored.
  assert.equal(resolveConnectAccount(accounts, null)?.address, ACTIVE);
  assert.equal(resolveConnectAccount(accounts, ACTIVE.toLowerCase())?.address, ACTIVE);
  assert.equal(resolveConnectAccount(accounts, BOREDSWAP_FEE_WALLET)?.address, ACTIVE);
  assert.equal(resolveConnectAccount([], ACTIVE), null);
  const two = [...accounts, { address: BOREDSWAP_FEE_WALLET, label: 'Wallet 2', solanaAddress: null, active: false }];
  assert.equal(resolveConnectAccount(two, BOREDSWAP_FEE_WALLET)?.label, 'Wallet 2');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

test('no app code hardcodes the BoredSwap fee wallet (it only appears in test fixtures)', () => {
  for (const file of sourceFiles(join(__dirname, '..'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /640ebc069e89e5691aad192420d22a4b92443387/i, file);
  }
});

test('the WalletConnect sheet approves the picked BoreDefi account and shows the source-wallet notice', () => {
  const ctx = readFileSync(join(__dirname, '../context/WalletConnectContext.tsx'), 'utf8');
  const overlay = readFileSync(join(__dirname, '../components/WalletConnectOverlay.tsx'), 'utf8');
  const browser = readFileSync(join(__dirname, '../screens/BrowserScreen.tsx'), 'utf8');
  assert.match(ctx, /const account = resolveConnectAccount\(accounts, picked\);/);
  assert.match(ctx, /accounts: supportedCaipAccounts\(address\)/);
  assert.match(ctx, /const solana = account\.solanaAddress;/);
  assert.match(ctx, /sourceByTopicRef\.current\.get\(topic\)/);
  assert.match(overlay, /from=\{account\?\.address\}/);
  assert.match(overlay, /approveProposal\(account\?\.address \?\? null\)/);
  assert.match(overlay, /sourceWalletNotice\(pendingProposal\.sourceWallet\)/);
  assert.match(overlay, /Connect as/);
  assert.match(browser, /pairFromPage\(decision\.uri, walletLinkSource\(target\)\)/);
});

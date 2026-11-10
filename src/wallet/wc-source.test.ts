import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  claimHandoff,
  connectableAccounts,
  openableWalletLink,
  pairingTopic,
  resolveConnectAccount,
  sourceWalletNotice,
  walletLinkSource,
} from './wc-source';

const WC =
  'wc:d8b7145b82f16012149ee605786ad991ea0b713e7303f208715622bcdfe6937b@2?relay-protocol=irn&symKey=c500d215e3a3311d091fa21ea0dcc102eb23376d53cd330f4806d187e83aff70';
const ENC = encodeURIComponent(WC);
const ACTIVE = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const OTHER_WALLET = '0x2222222222222222222222222222222222222222';

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
  assert.equal(resolveConnectAccount(accounts, OTHER_WALLET)?.address, ACTIVE);
  assert.equal(resolveConnectAccount([], ACTIVE), null);
  const two = [...accounts, { address: OTHER_WALLET, label: 'Wallet 2', solanaAddress: null, active: false }];
  assert.equal(resolveConnectAccount(two, OTHER_WALLET)?.label, 'Wallet 2');
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
  // Only BoreDefi's own links pair from the page; other wallets' links never reach pair().
  assert.match(browser, /if \(decision\.kind === 'walletconnect'\) \{[^}]*pairFromPage\(decision\.uri, null\);/);
  assert.match(browser, /claimHandoff\(handoffsRef\.current, wcUri, 'boredefi'\)/);
});

test('"Open <wallet>" is offered only for known wallet links, never intent:// or unknown apps', () => {
  assert.equal(openableWalletLink(`trust://wc?uri=${ENC}`), 'Trust Wallet');
  assert.equal(openableWalletLink(`https://link.trustwallet.com/wc?uri=${ENC}`), 'Trust Wallet');
  assert.equal(openableWalletLink(`metamask://wc?uri=${ENC}`), 'MetaMask');
  assert.equal(openableWalletLink(`rainbow://wc?uri=${ENC}`), 'Rainbow');
  assert.equal(openableWalletLink(`someotherwallet://wc?uri=${ENC}`), null);
  assert.equal(openableWalletLink(`tel://wc?uri=${ENC}`), null);
  assert.equal(openableWalletLink(`intent://wc?uri=${ENC}#Intent;scheme=trust;end`), null);
  assert.equal(openableWalletLink(`boredefi://wc?uri=${ENC}`), null);
  assert.equal(openableWalletLink(WC), null);
});

test('one WalletConnect link goes to exactly one wallet', () => {
  const claims = new Map();
  assert.equal(claimHandoff(claims, WC, 'boredefi'), true);
  assert.equal(claimHandoff(claims, WC, 'boredefi'), true, 'repeat for the same wallet is fine');
  assert.equal(claimHandoff(claims, WC, 'external'), false, 'never also handed to another wallet');
  const other = new Map();
  assert.equal(claimHandoff(other, WC, 'external'), true);
  assert.equal(claimHandoff(other, WC, 'boredefi'), false, 'never also paired by BoreDefi');
  assert.equal(claimHandoff(new Map(), 'https://x', 'boredefi'), false);
});

test('boredefi://wc deep links from Safari/other browsers (cold and warm start) yield a pairable wc: URI', async () => {
  const { extractWalletConnectUri } = await import('./wc');
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const config = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')).expo;
  assert.equal(config.scheme, 'boredefi');
  // Warm start (url event) and cold start (getInitialURL) both run the same extractor.
  assert.match(app, /Linking\.addEventListener\('url', \(\{ url \}\) => open\(url\)\)/);
  assert.match(app, /Linking\.getInitialURL\(\)/);
  assert.equal(extractWalletConnectUri(`boredefi://wc?uri=${ENC}`), WC);
  // Sign-request redirects: with a uri it still pairs; without one the app just comes to the front.
  assert.match(extractWalletConnectUri(`boredefi://wc?uri=${ENC}&requestId=123`) ?? '', new RegExp(`^${WC.replace(/[?.*+^$()[\]{}|\\]/g, '\\$&')}`));
  assert.equal(extractWalletConnectUri('boredefi://wc?requestId=123&sessionTopic=abc'), null);
  assert.equal(extractWalletConnectUri('boredefi://'), null);
});

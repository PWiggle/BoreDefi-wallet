import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Interface, MaxUint256 } from 'ethers';

import { inspectDappApproval } from './approval-risk';
import {
  chainAllowedInSession,
  evmChainFromCaip,
  isSilentRequest,
  requiresReauth,
  routeWalletConnectRequest,
  summarizeProposal,
  verifyStatus,
} from './wc-session';
import { WALLETCONNECT_METHODS } from './wc';
import { SOLANA_MAINNET_CAIP } from './solana/wc-solana';

const meta = { name: 'React App', url: 'https://react-app.walletconnect.com', icons: ['https://avatars.githubusercontent.com/u/37784886'] };
const verified = { verified: { origin: 'https://react-app.walletconnect.com', validation: 'VALID', isScam: null } };

test('Reown Verify status mapping', () => {
  assert.equal(verifyStatus(verified), 'verified');
  assert.equal(verifyStatus({ verified: { validation: 'UNKNOWN' } }), 'unknown');
  assert.equal(verifyStatus({ verified: { validation: 'INVALID' } }), 'mismatch');
  assert.equal(verifyStatus({ verified: { validation: 'VALID', isScam: true } }), 'scam');
  assert.equal(verifyStatus(undefined), 'unknown');
});

test('proposal summary: dApp info, supported and unsupported chains, methods', () => {
  const summary = summarizeProposal(
    {
      proposer: { metadata: meta },
      requiredNamespaces: { eip155: { chains: ['eip155:1'], methods: ['eth_sendTransaction', 'personal_sign'], events: [] } },
      optionalNamespaces: {
        eip155: { chains: ['eip155:8453', 'eip155:999999'], methods: ['eth_signTypedData_v4'], events: [] },
        solana: { chains: [SOLANA_MAINNET_CAIP], methods: ['solana_signMessage'], events: [] },
      },
    },
    verified,
    { solanaEnabled: false },
  );
  assert.equal(summary.name, 'React App');
  assert.equal(summary.host, 'react-app.walletconnect.com');
  assert.equal(summary.icon, meta.icons[0]);
  assert.equal(summary.verify, 'verified');
  assert.equal(summary.blockedReason, null);
  assert.deepEqual(summary.chains, ['Ethereum', 'Base']);
  assert.deepEqual(summary.unsupportedChains, ['eip155:999999', SOLANA_MAINNET_CAIP]);
  assert.deepEqual(summary.missingRequiredChains, []);
  assert.deepEqual(summary.methods, ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'solana_signMessage']);
  assert.deepEqual(summary.warnings, []);

  const withSolana = summarizeProposal(
    { proposer: { metadata: meta }, optionalNamespaces: { solana: { chains: [SOLANA_MAINNET_CAIP], methods: [] } } },
    verified,
    { solanaEnabled: true },
  );
  assert.deepEqual(withSolana.chains, ['Solana']);
});

test('proposal: phishing list blocks by claimed URL or by the origin Reown saw; scam flag blocks', () => {
  const phish = summarizeProposal({ proposer: { metadata: { ...meta, url: 'https://xn--uniswp-9ta.org' } } }, undefined, { solanaEnabled: false });
  assert.ok(phish.blockedReason);
  const spoofed = summarizeProposal(
    { proposer: { metadata: meta } },
    { verified: { origin: 'https://xn--metamsk-en4c.io', validation: 'INVALID' } },
    { solanaEnabled: false },
  );
  assert.ok(spoofed.blockedReason);
  const scam = summarizeProposal({ proposer: { metadata: meta } }, { verified: { origin: meta.url, validation: 'VALID', isScam: true } }, { solanaEnabled: false });
  assert.match(scam.blockedReason ?? '', /scam/);
});

test('proposal: mismatch, unverified, required-unsupported chain and eth_sign all warn', () => {
  const mismatch = summarizeProposal(
    { proposer: { metadata: meta }, requiredNamespaces: { eip155: { chains: ['eip155:1'], methods: ['eth_sign'] } } },
    { verified: { origin: 'https://evil.example', validation: 'INVALID' } },
    { solanaEnabled: false },
  );
  assert.equal(mismatch.verify, 'mismatch');
  assert.ok(mismatch.warnings.some((w) => /did not come from/.test(w)));
  assert.ok(mismatch.warnings.some((w) => /evil\.example/.test(w)));
  assert.deepEqual(mismatch.blockedMethods, ['eth_sign']);
  assert.ok(mismatch.warnings.some((w) => /eth_sign/.test(w)));

  const unknown = summarizeProposal(
    { proposer: { metadata: meta }, requiredNamespaces: { cosmos: { chains: ['cosmos:cosmoshub-4'], methods: [] } } },
    { verified: { validation: 'UNKNOWN' } },
    { solanaEnabled: false },
  );
  assert.ok(unknown.warnings.some((w) => /could not verify/.test(w)));
  assert.deepEqual(unknown.missingRequiredChains, ['cosmos:cosmoshub-4']);
});

test('proposal: dApp name with a URL in it is neutralized', () => {
  const summary = summarizeProposal({ proposer: { metadata: { ...meta, name: 'Claim at evil.com' } } }, verified, { solanaEnabled: false });
  assert.ok(!summary.name.includes('evil.com'));
});

test('request routing for every advertised method', () => {
  assert.equal(routeWalletConnectRequest('personal_sign'), 'sign');
  assert.equal(routeWalletConnectRequest('eth_signTypedData_v4'), 'typed');
  assert.equal(routeWalletConnectRequest('eth_sendTransaction'), 'send');
  assert.equal(routeWalletConnectRequest('wallet_switchEthereumChain'), 'switch');
  assert.equal(routeWalletConnectRequest('eth_accounts'), 'info');
  assert.equal(routeWalletConnectRequest('eth_sign'), 'blocked');
  assert.equal(routeWalletConnectRequest('solana_signTransaction'), 'solana');
  assert.equal(routeWalletConnectRequest('solana_signMessage'), 'solana');
  assert.equal(routeWalletConnectRequest('eth_getEncryptionPublicKey'), 'unsupported');
  for (const method of WALLETCONNECT_METHODS) {
    assert.notEqual(routeWalletConnectRequest(method), 'unsupported', method);
  }
});

test('every key-using request needs a fresh PIN/biometric; read-only ones do not', () => {
  for (const method of ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction', 'eth_signTransaction', 'solana_signMessage', 'solana_signTransaction']) {
    assert.equal(requiresReauth(method), true, method);
  }
  for (const method of ['wallet_switchEthereumChain', 'eth_accounts', 'eth_sign']) {
    assert.equal(requiresReauth(method), false, method);
  }
  assert.equal(isSilentRequest('eth_accounts'), true);
  assert.equal(isSilentRequest('personal_sign'), false);
});

test('a request must use a chain the session approved', () => {
  const namespaces = { eip155: { chains: ['eip155:1', 'eip155:8453'], accounts: ['eip155:1:0xabc', 'eip155:8453:0xabc'] } };
  assert.equal(chainAllowedInSession('eip155:8453', namespaces), true);
  assert.equal(chainAllowedInSession('eip155:137', namespaces), false);
  assert.equal(chainAllowedInSession(undefined, namespaces), false);
  assert.equal(chainAllowedInSession('solana:x', { solana: { accounts: ['solana:x:abc'] } }), true);
  assert.equal(evmChainFromCaip('eip155:42161'), 42161);
  assert.equal(evmChainFromCaip('solana:x'), null);
});

const SPENDER = '0x1111111111111111111111111111111111111111';
const IFACE = new Interface([
  'function approve(address,uint256)',
  'function setApprovalForAll(address,bool)',
]);

test('WalletConnect requests get the same approval warnings as the Browser', () => {
  const unlimited = inspectDappApproval('eth_sendTransaction', [
    { to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', data: IFACE.encodeFunctionData('approve', [SPENDER, MaxUint256]) },
  ]);
  assert.equal(unlimited?.unlimited, true);
  const all = inspectDappApproval('eth_sendTransaction', [
    { to: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', data: IFACE.encodeFunctionData('setApprovalForAll', [SPENDER, true]) },
  ]);
  assert.ok(all?.danger);
  const permit = inspectDappApproval('eth_signTypedData_v4', [
    SPENDER,
    JSON.stringify({
      domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      primaryType: 'Permit',
      types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }] },
      message: { owner: SPENDER, spender: SPENDER, value: MaxUint256.toString() },
    }),
  ]);
  assert.equal(permit?.kind, 'permit');
  assert.equal(permit?.unlimited, true);
});

test('WalletConnect wiring: eth_sign auto-rejected, scam/unsupported/off-session refused, reauth before signing', () => {
  const ctx = readFileSync(join(__dirname, '..', 'context', 'WalletConnectContext.tsx'), 'utf8');
  assert.match(ctx, /route === 'blocked'[\s\S]{0,120}ETH_SIGN_BLOCKED/);
  assert.match(ctx, /verify === 'scam'/);
  assert.match(ctx, /chainAllowedInSession\(caip, active\.namespaces\)/);
  assert.match(ctx, /if \(summary\.blockedReason\)[\s\S]{0,200}rejectSession/);
  const overlay = readFileSync(join(__dirname, '..', 'components', 'WalletConnectOverlay.tsx'), 'utf8');
  assert.match(overlay, /requiresReauth\(pendingRequest\.method\)/);
  assert.match(overlay, /<ProtectedReauth/);
  assert.match(overlay, /phase !== 'unlocked'/);
});

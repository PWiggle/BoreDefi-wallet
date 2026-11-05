import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { explorerTxUrl, PUBLIC_RPC_URLS, SOLANA_ENABLED, solanaCluster, solanaEnabled, solanaRpcUrls } from './config';

test('Solana is off by default in release builds and on only in dev or with EXPO_PUBLIC_SOLANA=1', () => {
  assert.equal(solanaEnabled(undefined, false), false);
  assert.equal(solanaEnabled('', false), false);
  assert.equal(solanaEnabled(undefined, true), true);
  assert.equal(solanaEnabled('1', false), true);
  assert.equal(solanaEnabled('0', true), false);
  // Tests run without __DEV__ or the env var, like a store build.
  assert.equal(SOLANA_ENABLED, process.env.EXPO_PUBLIC_SOLANA === '1');
});

test('flag and RPC settings are read with literal process.env so Expo can inline them', () => {
  const src = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_SOLANA;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_SOLANA_CLUSTER;/);
  assert.match(src, /=\s*process\.env\.EXPO_PUBLIC_SOLANA_RPC_URL;/);
});

test('public free RPCs only by default; an https custom RPC goes first', () => {
  assert.deepEqual(solanaRpcUrls('mainnet-beta', undefined), PUBLIC_RPC_URLS['mainnet-beta']);
  assert.equal(solanaRpcUrls('mainnet-beta', 'https://example.org/rpc')[0], 'https://example.org/rpc');
  assert.deepEqual(solanaRpcUrls('devnet', 'http://insecure'), ['https://api.devnet.solana.com']);
  for (const url of Object.values(PUBLIC_RPC_URLS).flat()) {
    assert.doesNotMatch(url, /api[-_]?key=/i);
  }
});

test('cluster parsing and explorer links', () => {
  assert.equal(solanaCluster('devnet'), 'devnet');
  assert.equal(solanaCluster(undefined), 'mainnet-beta');
  assert.equal(solanaCluster('testnet'), 'mainnet-beta');
  assert.equal(explorerTxUrl('abc', 'devnet'), 'https://solscan.io/tx/abc?cluster=devnet');
  assert.equal(explorerTxUrl('abc', 'mainnet-beta'), 'https://solscan.io/tx/abc');
});

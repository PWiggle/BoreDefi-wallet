import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Solana screens and the Home card exist only behind SOLANA_ENABLED', () => {
  const app = read('../../../App.tsx');
  assert.match(app, /SOLANA_ENABLED \? \(\s*<MainStack\.Screen name="SolanaReceive"/);
  assert.match(app, /SOLANA_ENABLED \? \(\s*<MainStack\.Screen name="SolanaSend"/);
  assert.match(read('../../screens/HomeScreen.tsx'), /\{SOLANA_ENABLED \? <SolanaHomeSection \/> : null\}/);
  assert.match(read('../../screens/ReceiveScreen.tsx'), /\{SOLANA_ENABLED \? \(/);
  assert.match(read('../../screens/ScanQrScreen.tsx'), /if \(SOLANA_ENABLED && /);
});

test('Solana send signs only after the user confirms', () => {
  const src = read('../../screens/SolanaSendScreen.tsx');
  const prepare = src.slice(src.indexOf('const prepare = async'), src.indexOf('const confirm = async'));
  const confirm = src.slice(src.indexOf('const confirm = async'), src.indexOf('if (outcome)'));
  assert.ok(prepare.includes('simulatePlanUnsigned('));
  assert.ok(!prepare.includes('signPlan('), 'review must not sign');
  assert.ok(confirm.includes('signPlan(') && confirm.includes('broadcastAndConfirm('));
  // Never silently fall back to SOL when a QR asks for an unheld token.
  assert.doesNotMatch(src, /choices\.find\([^)]*\)\s*\?\?\s*choices\[0\]/);
});

test('no Solana secret is persisted: storage.ts is untouched by Solana and the key cache clears on lock', () => {
  assert.doesNotMatch(read('../storage.ts'), /solana/i);
  const ctx = read('../../context/WalletContext.tsx');
  assert.match(ctx, /const lock = useCallback\(\(\) => \{\s*clearSolanaKeyCache\(\);/);
});

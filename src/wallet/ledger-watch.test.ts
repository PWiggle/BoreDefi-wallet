import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { ledgerWatchFromSession, normalizeLedgerWatch } from './ledger-watch';

const SOL = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const ETH = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test('normalizeLedgerWatch keeps only public, well-formed fields', () => {
  const ok = normalizeLedgerWatch({ version: 1, ethAddress: ETH.toLowerCase(), solanaAddress: SOL, deviceId: 'AA:BB', deviceName: 'Nano X 1A2B', savedAt: '2026-11-13T00:00:00.000Z' });
  assert.equal(ok?.ethAddress, ETH);
  assert.equal(ok?.solanaAddress, SOL);
  assert.equal(ok?.deviceName, 'Nano X 1A2B');
  assert.equal(normalizeLedgerWatch({ version: 1, ethAddress: 'nope' }), null);
  assert.equal(normalizeLedgerWatch({ version: 2, ethAddress: ETH }), null);
  assert.equal(normalizeLedgerWatch(null), null);
  assert.equal(normalizeLedgerWatch({ version: 1, ethAddress: ETH, solanaAddress: 'not-base58-0OIl' })?.solanaAddress, null);
  // Unknown fields (anything someone might try to stash) are dropped.
  const extra = normalizeLedgerWatch({ version: 1, ethAddress: ETH, mnemonic: 'x', privateKey: 'y' }) as Record<string, unknown>;
  assert.equal('mnemonic' in extra, false);
  assert.equal('privateKey' in extra, false);
});

test('ledgerWatchFromSession keeps the Solana address and verification for the same account only', () => {
  const session = { ethAddress: ETH, ethPath: "44'/60'/0'/0/0", solanaAddress: null, solanaPath: "44'/501'/0'", deviceId: 'id2', deviceName: 'Nano X' };
  const previous = normalizeLedgerWatch({ version: 1, ethAddress: ETH, solanaAddress: SOL, verifiedAt: '2026-11-13T01:00:00.000Z' });
  const same = ledgerWatchFromSession(session, previous);
  assert.equal(same.solanaAddress, SOL);
  assert.equal(same.verifiedAt, '2026-11-13T01:00:00.000Z');
  assert.equal(same.deviceId, 'id2');
  const other = ledgerWatchFromSession({ ...session, ethAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }, previous);
  assert.equal(other.solanaAddress, null);
  assert.equal(other.verifiedAt, null);
});

test('build flags: store builds leave Bluetooth out; iPhone needs its own flag', () => {
  const require = createRequire(import.meta.url);
  const { ledgerBleNative } = require('../../scripts/ledger-flags.js') as { ledgerBleNative: (env: Record<string, string | undefined>) => { android: boolean; ios: boolean } };
  assert.deepEqual(ledgerBleNative({}), { android: false, ios: false });
  assert.deepEqual(ledgerBleNative({ EXPO_PUBLIC_LEDGER_BLE: '1' }), { android: true, ios: false });
  assert.deepEqual(ledgerBleNative({ EXPO_PUBLIC_LEDGER_BLE: '1', EXPO_PUBLIC_LEDGER_BLE_IOS: '1' }), { android: true, ios: true });
  const appConfig = require('../../app.config.js') as (args: { config: Record<string, unknown> }) => { plugins: unknown[]; android: { blockedPermissions: string[] } };
  const base = { plugins: ['expo-secure-store', ['react-native-ble-plx', {}]], android: { blockedPermissions: ['android.permission.ACCESS_FINE_LOCATION'] } };
  const saved = process.env.EXPO_PUBLIC_LEDGER_BLE;
  try {
    delete process.env.EXPO_PUBLIC_LEDGER_BLE;
    const store = appConfig({ config: base });
    assert.equal(JSON.stringify(store.plugins).includes('react-native-ble-plx'), false);
    assert.ok(store.android.blockedPermissions.includes('android.permission.BLUETOOTH_SCAN'));
    assert.ok(store.android.blockedPermissions.includes('android.permission.ACCESS_FINE_LOCATION'));
    process.env.EXPO_PUBLIC_LEDGER_BLE = '1';
    const ledger = appConfig({ config: base });
    assert.equal(JSON.stringify(ledger.plugins).includes('react-native-ble-plx'), true);
    assert.equal(ledger.android.blockedPermissions.includes('android.permission.ACCESS_FINE_LOCATION'), false);
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_LEDGER_BLE;
    else process.env.EXPO_PUBLIC_LEDGER_BLE = saved;
  }
});

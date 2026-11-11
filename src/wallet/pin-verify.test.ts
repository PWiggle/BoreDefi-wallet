import assert from 'node:assert/strict';
import test from 'node:test';

import { createHash } from 'node:crypto';

import { checkPin, isLegacyPinRecord, legacyPinHash, PIN_RECORD_V2 } from './pin-verify';
import { encryptVault, type VaultV1Record } from './vault-crypto';

const PHRASE = 'test test test test test test test test test test test junk';
const ADDRESS = '0x0000000000000000000000000000000000000001';
const ITER = 1_000; // fast for tests; the app uses 210k

test('legacy hash matches the old expo-crypto SHA256(salt:pin) hex', () => {
  const expected = createHash('sha256').update('salt-1:123456').digest('hex');
  assert.equal(legacyPinHash('123456', 'salt-1'), expected);
});

test('the stored PIN record has no hash or salt (nothing to brute-force offline)', () => {
  assert.deepEqual(Object.keys(PIN_RECORD_V2).sort(), ['scheme', 'version']);
  assert.equal(isLegacyPinRecord(PIN_RECORD_V2), false);
});

test('v2 vault: the PIN is proven only by the slow-KDF decrypt', async () => {
  const { vault } = await encryptVault(PHRASE, ADDRESS, '246810', ITER);
  const ok = await checkPin('246810', vault, PIN_RECORD_V2);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.kind === 'v2' && ok.opened.mnemonic, PHRASE);
  assert.equal(ok.ok && ok.kind === 'v2' && ok.upgradeRecord, false);
  assert.deepEqual(await checkPin('246811', vault, PIN_RECORD_V2), { ok: false });
  assert.deepEqual(await checkPin('abc', vault, PIN_RECORD_V2), { ok: false });
});

test('existing v2 users with an old fast hash still unlock, and the hash is flagged for removal', async () => {
  const { vault } = await encryptVault(PHRASE, ADDRESS, '135790', ITER);
  const legacy = { salt: 'abc', hash: legacyPinHash('135790', 'abc') };
  const ok = await checkPin('135790', vault, legacy);
  assert.equal(ok.ok && ok.kind === 'v2' && ok.upgradeRecord, true);
  // A wrong PIN fails even if someone forged the legacy hash to match it: the vault decides.
  const forged = { salt: 'abc', hash: legacyPinHash('000000', 'abc') };
  assert.deepEqual(await checkPin('000000', vault, forged), { ok: false });
});

test('old plaintext v1 vaults unlock once with the legacy hash so they can be re-encrypted', async () => {
  const v1: VaultV1Record = { version: 1, address: ADDRESS, mnemonic: PHRASE };
  const legacy = { salt: 's', hash: legacyPinHash('111222', 's') };
  const ok = await checkPin('111222', v1, legacy);
  assert.equal(ok.ok && ok.kind, 'v1');
  assert.deepEqual(await checkPin('111223', v1, legacy), { ok: false });
  assert.deepEqual(await checkPin('111222', v1, PIN_RECORD_V2), { ok: false });
});

test('no vault or no record means no unlock', async () => {
  const { vault } = await encryptVault(PHRASE, ADDRESS, '246810', ITER);
  assert.deepEqual(await checkPin('246810', null, PIN_RECORD_V2), { ok: false });
  assert.deepEqual(await checkPin('246810', vault, null), { ok: false });
});

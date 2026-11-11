import assert from 'node:assert/strict';
import test from 'node:test';

import { addressesForRegistration, createAlertsClient, parsePriceInput } from './client';
import { normalizeAlertsUrl } from './config';
import { alertTriggered, priceAlertMessage, validatePriceAlert, validateRegistration } from './shared';

const EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

test('price input accepts dollars and commas, rejects junk and zero', () => {
  assert.equal(parsePriceInput('$1,234.50'), 1234.5);
  assert.equal(parsePriceInput(' 0.00012 '), 0.00012);
  assert.equal(parsePriceInput('250'), 250);
  for (const bad of ['', '0', 'abc', '1.2.3', '-5']) assert.equal(parsePriceInput(bad), null, bad);
});

test('alerts trigger inclusively in the chosen direction only', () => {
  assert.equal(alertTriggered({ direction: 'above', targetUsd: 100 }, 100), true);
  assert.equal(alertTriggered({ direction: 'above', targetUsd: 100 }, 99.99), false);
  assert.equal(alertTriggered({ direction: 'below', targetUsd: 100 }, 99), true);
  assert.equal(alertTriggered({ direction: 'below', targetUsd: 100 }, Number.NaN), false);
  assert.deepEqual(priceAlertMessage({ symbol: 'SOL', direction: 'above', targetUsd: 250 }, 251.5), {
    title: 'SOL rose above $250.00',
    body: 'SOL is now $251.50. Open BoreDefi to see the market.',
  });
});

test('validation: alerts and registrations', () => {
  assert.equal(validatePriceAlert({ coinId: 'ethereum', symbol: 'eth', direction: 'below', targetUsd: '1800' }).ok, true);
  assert.equal(validatePriceAlert({ coinId: 'Bad Id', symbol: 'X', direction: 'below', targetUsd: 1 }).ok, false);
  assert.equal(validatePriceAlert({ coinId: 'ethereum', symbol: 'ETH', direction: 'below', targetUsd: 0 }).ok, false);
  const reg = validateRegistration({ pushToken: 'ExponentPushToken[abcdefghijklmnop]', platform: 'android', incomingEnabled: true, evmAddresses: [EVM], solanaAddresses: [SOL] });
  assert.ok(reg.ok);
  assert.deepEqual(reg.ok && reg.value.evmAddresses, [EVM.toLowerCase()]);
  assert.equal(validateRegistration({ pushToken: 'ExponentPushToken[abcdefghijklmnop]', platform: 'web' }).ok, false);
});

test('only public addresses, and none when incoming alerts are off', () => {
  assert.deepEqual(addressesForRegistration(true, EVM, SOL), { evmAddresses: [EVM.toLowerCase()], solanaAddresses: [SOL] });
  assert.deepEqual(addressesForRegistration(false, EVM, SOL), { evmAddresses: [], solanaAddresses: [] });
  assert.deepEqual(addressesForRegistration(true, EVM, null), { evmAddresses: [EVM.toLowerCase()], solanaAddresses: [] });
});

test('alerts URL must be https; unset keeps the feature hidden', () => {
  assert.equal(normalizeAlertsUrl(undefined), '');
  assert.equal(normalizeAlertsUrl('http://insecure.example'), '');
  assert.equal(normalizeAlertsUrl(' https://boredefi-alerts.example.workers.dev/ '), 'https://boredefi-alerts.example.workers.dev');
});

test('client sends device auth and surfaces server errors', async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const client = createAlertsClient({
    baseUrl: 'https://alerts.example',
    credentials: { deviceId: 'device-0000-0000-0001', secret: 'a'.repeat(64) },
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (init?.method === 'POST') return new Response('{"error":"You can have up to 20 price alerts."}', { status: 409 });
      return new Response('{"alerts":[]}', { status: 200 });
    },
  });
  assert.deepEqual(await client.listAlerts(), []);
  assert.equal((seen[0]?.init?.headers as Record<string, string>).Authorization, `Device device-0000-0000-0001:${'a'.repeat(64)}`);
  await assert.rejects(client.createAlert({ coinId: 'ethereum', symbol: 'ETH', direction: 'above', targetUsd: 1 }), /up to 20/);
});

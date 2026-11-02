import assert from 'node:assert/strict';
import test from 'node:test';

import type { AbstractProvider } from 'ethers';

import { isDeterministicReadError, readWithFallback, retryRead } from './rpc';

const fake = (name: string) => ({ name }) as unknown as AbstractProvider;
const networkError = () => Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' });
const checksumError = () => Object.assign(new Error('bad address checksum'), { code: 'INVALID_ARGUMENT' });

test('readWithFallback: falls through to the next endpoint when one fails', async () => {
  const seen: string[] = [];
  const result = await readWithFallback(
    1,
    async (provider) => {
      const name = (provider as unknown as { name: string }).name;
      seen.push(name);
      if (name !== 'c') {
        throw networkError();
      }
      return 42n;
    },
    [fake('a'), fake('b'), fake('c')],
  );
  assert.equal(result, 42n);
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('readWithFallback: throws the last error when every endpoint fails', async () => {
  await assert.rejects(
    readWithFallback(1, async () => {
      throw networkError();
    }, [fake('a'), fake('b')]),
    /fetch failed/,
  );
});

test('readWithFallback: a bad address checksum is not retried on other endpoints', async () => {
  let calls = 0;
  await assert.rejects(
    readWithFallback(1, async () => {
      calls += 1;
      throw checksumError();
    }, [fake('a'), fake('b'), fake('c')]),
    /checksum/,
  );
  assert.equal(calls, 1);
});

test('retryRead: retries a transient failure, then succeeds', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const value = await retryRead(
    async () => {
      calls += 1;
      if (calls === 1) {
        throw networkError();
      }
      return 'ok';
    },
    { attempts: 3, delayMs: 10, sleep: async (ms) => void sleeps.push(ms) },
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [10]);
});

test('retryRead: stops after the attempt limit and does not retry deterministic errors', async () => {
  let calls = 0;
  await assert.rejects(retryRead(async () => {
    calls += 1;
    throw networkError();
  }, { attempts: 2, sleep: async () => {} }));
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryRead(async () => {
    calls += 1;
    throw checksumError();
  }, { attempts: 3, sleep: async () => {} }));
  assert.equal(calls, 1);
  assert.equal(isDeterministicReadError(checksumError()), true);
  assert.equal(isDeterministicReadError(networkError()), false);
});

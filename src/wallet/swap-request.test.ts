import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchWithTimeout,
  isAbortError,
  isRetryableHttpStatus,
  JUPITER_ORDER_RETRY_BACKOFF_MS,
  retryBusyResponse,
  SWAP_EXECUTE_TIMEOUT_MS,
  SWAP_QUOTE_TIMEOUT_MS,
} from './swap-request';

function abortingHang(): typeof fetch {
  return (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof fetch;
}

test('quote and execute deadlines are 15s and 30s; Jupiter order retries twice with 500ms then 1500ms', () => {
  assert.equal(SWAP_QUOTE_TIMEOUT_MS, 15_000);
  assert.equal(SWAP_EXECUTE_TIMEOUT_MS, 30_000);
  assert.deepEqual([...JUPITER_ORDER_RETRY_BACKOFF_MS], [500, 1_500]);
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(503), true);
  assert.equal(isRetryableHttpStatus(400), false);
  assert.equal(isRetryableHttpStatus(200), false);
});

test('fetchWithTimeout aborts a hung request and surfaces an AbortError', async () => {
  await assert.rejects(fetchWithTimeout(abortingHang(), 'https://proxy.test/order', {}, 20), (error: unknown) => {
    assert.equal(isAbortError(error), true);
    return true;
  });
});

test('fetchWithTimeout passes the abort signal and returns a timely response', async () => {
  let sawSignal = false;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal && init.signal.aborted === false;
    return new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;
  const response = await fetchWithTimeout(fetcher, 'https://proxy.test/quote', { method: 'POST' }, 15_000);
  assert.equal(response.status, 200);
  assert.equal(sawSignal, true);
});

test('retryBusyResponse retries 429 then 5xx with the configured backoff and then returns success', async () => {
  const sleeps: number[] = [];
  const statuses: number[] = [];
  let n = 0;
  const response = await retryBusyResponse(
    async () => {
      n += 1;
      const status = n === 1 ? 429 : n === 2 ? 503 : 200;
      statuses.push(status);
      return new Response('{}', { status });
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(statuses, [429, 503, 200]);
  assert.deepEqual(sleeps, [500, 1_500]);
});

test('retryBusyResponse does not retry a 4xx or a thrown error (timeouts included)', async () => {
  let calls = 0;
  const client = await retryBusyResponse(async () => {
    calls += 1;
    return new Response('no', { status: 400 });
  }, { sleep: async () => { throw new Error('should not sleep'); } });
  assert.equal(client.status, 400);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    retryBusyResponse(async () => {
      calls += 1;
      const error = new Error('This operation was aborted');
      error.name = 'AbortError';
      throw error;
    }, { sleep: async () => { throw new Error('should not sleep'); } }),
    (error: unknown) => isAbortError(error),
  );
  assert.equal(calls, 1);
});

test('retryBusyResponse gives up after the last 429 and does not sleep again', async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const response = await retryBusyResponse(
    async () => {
      calls += 1;
      return new Response('{}', { status: 429 });
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  assert.equal(response.status, 429);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1_500]);
});

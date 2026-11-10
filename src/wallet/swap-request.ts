/**
 * Shared fetch helpers for the native swap proxies (BoredSwap /api/quote and Mevvy /api/jupiter/*).
 *
 * Quotes abort after 15s. Execute aborts after 30s. A timed-out execute must never be retried, and the
 * caller keeps the "may still have gone through, check Activity" wording.
 */
export const SWAP_QUOTE_TIMEOUT_MS = 15_000;
export const SWAP_EXECUTE_TIMEOUT_MS = 30_000;

/** Two retries on the Jupiter /order call only (initial try + these delays). Never used for execute. */
export const JUPITER_ORDER_RETRY_BACKOFF_MS = [500, 1_500] as const;

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * fetch() with an AbortController deadline. If AbortController is missing, the request is sent with no
 * deadline (same fallback as the wallet's other HTTP helpers).
 */
export async function fetchWithTimeout(
  run: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return run(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Re-runs `run` after the given delays when it returns a 429 or 5xx. Other statuses are returned at
 * once. Thrown errors (including timeouts) are not retried.
 */
export async function retryBusyResponse(
  run: () => Promise<Response>,
  options: {
    backoffMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Response> {
  const backoff = options.backoffMs ?? JUPITER_ORDER_RETRY_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let response = await run();
  for (let i = 0; i < backoff.length && isRetryableHttpStatus(response.status); i += 1) {
    await sleep(backoff[i]!);
    response = await run();
  }
  return response;
}

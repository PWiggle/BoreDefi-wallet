import type { FetchLike } from './prices';

/** Expo Push API (free). Android goes out through FCM, iOS through APNs, using credentials stored in EAS. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type Ticket = { status?: 'ok' | 'error'; details?: { error?: string } };

/**
 * Sends in batches of 100. Returns tokens Expo says are dead (DeviceNotRegistered), so the caller deletes them.
 * Never throws: a failed batch is logged by status only (no tokens or message text in logs).
 */
export async function sendPushes(
  messages: PushMessage[],
  options: { fetchImpl?: FetchLike; accessToken?: string } = {},
): Promise<{ sent: number; failedBatches: number; deadTokens: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadTokens: string[] = [];
  let sent = 0;
  let failedBatches = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH).map((message) => ({
      ...message,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        failedBatches += 1;
        console.warn('expo push batch failed', response.status);
        continue;
      }
      const payload = (await response.json()) as { data?: Ticket[] };
      (payload.data ?? []).forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          sent += 1;
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          const to = batch[index]?.to;
          if (to) deadTokens.push(to);
        }
      });
    } catch {
      failedBatches += 1;
      console.warn('expo push batch threw');
    }
  }
  return { sent, failedBatches, deadTokens: [...new Set(deadTokens)] };
}

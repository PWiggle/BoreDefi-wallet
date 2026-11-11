import {
  MAX_ALERTS_PER_DEVICE,
  validatePriceAlert,
  validateRegistration,
  type PriceAlert,
} from '../../src/wallet/alerts/shared';
import { classifyTransfers, type ActivityEvent, type Transfer } from './activity';
import { alchemyTransfers, timingSafeEqual, verifyAlchemySignature, type AlchemyPayload } from './alchemy';
import { listVar, parseAlchemyWebhooks, type AlertsEnv } from './env';
import { sendPushes, type PushMessage } from './expo-push';
import { heliusTransfers } from './helius';
import type { FetchLike } from './prices';
import type { AddressKind, AlertsStore } from './store';

export type HandlerDeps = {
  store: AlertsStore;
  env: AlertsEnv;
  now?: () => number;
  fetchImpl?: FetchLike;
  /** ctx.waitUntil in the Worker; awaited directly in tests. */
  waitUntil?: (promise: Promise<unknown>) => void;
  randomId?: () => string;
};

const DEVICE_ID = /^[A-Za-z0-9-]{16,64}$/;
const DEVICE_SECRET = /^[0-9a-f]{64}$/;
const APP_BODY_LIMIT = 16 * 1024;
const WEBHOOK_BODY_LIMIT = 2 * 1024 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Authorization: Device <deviceId>:<64-hex secret>. The phone makes both on first run and keeps them in SecureStore. */
export function parseDeviceAuth(header: string | null): { id: string; secret: string } | null {
  const match = header?.match(/^Device\s+([^:\s]+):([^\s]+)$/);
  if (!match?.[1] || !match[2]) return null;
  if (!DEVICE_ID.test(match[1]) || !DEVICE_SECRET.test(match[2])) return null;
  return { id: match[1], secret: match[2] };
}

async function readBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const text = await request.text();
  return text.length > limit ? null : text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function newId(): string {
  return crypto.randomUUID();
}

/** Push activity events to every device watching the address. Dedupes per device + tx (webhooks are at-least-once). */
export async function deliverActivity(
  kind: AddressKind,
  transfers: Transfer[],
  deps: HandlerDeps,
): Promise<{ events: ActivityEvent[]; pushed: number }> {
  const { store } = deps;
  const now = deps.now?.() ?? Date.now();
  const addresses = [...new Set(transfers.flatMap((t) => [t.from, t.to]))];
  if (addresses.length === 0) return { events: [], pushed: 0 };
  const recipients = await store.recipientsFor(kind, addresses);
  if (recipients.length === 0) return { events: [], pushed: 0 };
  const watched = new Set(recipients.map((r) => r.address));
  const events = classifyTransfers(transfers, watched, kind === 'evm');
  const messages: PushMessage[] = [];
  for (const event of events) {
    for (const recipient of recipients.filter((r) => r.address === event.address)) {
      if (await store.seenBefore(`act:${recipient.deviceId}:${event.chainKey}:${event.tx}`, now)) continue;
      messages.push({
        to: recipient.pushToken,
        title: event.title,
        body: event.body,
        data: { type: event.kind, chain: event.chainKey, tx: event.tx },
      });
    }
  }
  if (messages.length === 0) return { events, pushed: 0 };
  const result = await sendPushes(messages, { fetchImpl: deps.fetchImpl, accessToken: deps.env.EXPO_ACCESS_TOKEN });
  for (const token of result.deadTokens) await store.removePushToken(token);
  return { events, pushed: result.sent };
}

async function authed(request: Request, deps: HandlerDeps) {
  const auth = parseDeviceAuth(request.headers.get('authorization'));
  if (!auth) return null;
  const device = await deps.store.getDevice(auth.id);
  return { auth, device, secretHash: await sha256Hex(auth.secret) };
}

export async function handleRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const now = deps.now?.() ?? Date.now();
  const later = deps.waitUntil ?? ((promise: Promise<unknown>) => void promise);

  if (path === '/health' && method === 'GET') {
    return json(200, { ok: true });
  }

  // ---- Webhooks -------------------------------------------------------------------------------------------
  if (path === '/v1/webhooks/alchemy' && method === 'POST') {
    const raw = await readBody(request, WEBHOOK_BODY_LIMIT);
    if (raw === null) return json(413, { error: 'Too large' });
    const ok = await verifyAlchemySignature(raw, request.headers.get('x-alchemy-signature'), listVar(deps.env.ALCHEMY_SIGNING_KEYS));
    if (!ok) return json(401, { error: 'Bad signature' });
    const payload = parseJson(raw) as AlchemyPayload | undefined;
    const known = parseAlchemyWebhooks(deps.env.ALCHEMY_WEBHOOKS).some((w) => w.webhookId === payload?.webhookId);
    if (!payload || !known) return json(200, { ok: true, ignored: true });
    const { transfers } = alchemyTransfers(payload);
    later(deliverActivity('evm', transfers, deps).catch(() => console.warn('alchemy delivery failed')));
    return json(200, { ok: true });
  }

  if (path === '/v1/webhooks/helius' && method === 'POST') {
    const expected = deps.env.HELIUS_AUTH_HEADER ?? '';
    const got = request.headers.get('authorization') ?? '';
    if (!expected || !timingSafeEqual(got, expected)) return json(401, { error: 'Unauthorized' });
    const raw = await readBody(request, WEBHOOK_BODY_LIMIT);
    if (raw === null) return json(413, { error: 'Too large' });
    const transfers = heliusTransfers(parseJson(raw));
    later(deliverActivity('solana', transfers, deps).catch(() => console.warn('helius delivery failed')));
    return json(200, { ok: true });
  }

  // ---- App endpoints ----------------------------------------------------------------------------------------
  if (!path.startsWith('/v1/')) return json(404, { error: 'Not found' });
  const session = await authed(request, deps);
  if (!session) return json(401, { error: 'Missing device credentials' });
  const { auth, device, secretHash } = session;
  if (device && !timingSafeEqual(device.secretHash, secretHash)) return json(401, { error: 'Wrong device credentials' });

  if (path === '/v1/device' && method === 'PUT') {
    const raw = await readBody(request, APP_BODY_LIMIT);
    if (raw === null) return json(413, { error: 'Too large' });
    const parsed = validateRegistration(parseJson(raw));
    if (!parsed.ok) return json(400, { error: parsed.error });
    const reg = parsed.value;
    await deps.store.upsertDevice(
      {
        id: auth.id,
        secretHash,
        pushToken: reg.pushToken,
        platform: reg.platform,
        incomingEnabled: reg.incomingEnabled,
        createdAt: device?.createdAt ?? now,
        updatedAt: now,
      },
      [
        ...reg.evmAddresses.map((address) => ({ kind: 'evm' as const, address })),
        ...reg.solanaAddresses.map((address) => ({ kind: 'solana' as const, address })),
      ],
    );
    return json(200, { ok: true });
  }

  if (!device) return json(404, { error: 'Register this device first' });

  if (path === '/v1/device' && method === 'DELETE') {
    await deps.store.deleteDevice(auth.id);
    return json(200, { ok: true });
  }

  if (path === '/v1/alerts' && method === 'GET') {
    return json(200, { alerts: await deps.store.listAlerts(auth.id) });
  }

  if (path === '/v1/alerts' && method === 'POST') {
    const raw = await readBody(request, APP_BODY_LIMIT);
    if (raw === null) return json(413, { error: 'Too large' });
    const parsed = validatePriceAlert(parseJson(raw));
    if (!parsed.ok) return json(400, { error: parsed.error });
    const existing = await deps.store.listAlerts(auth.id);
    if (existing.filter((a) => a.active).length >= MAX_ALERTS_PER_DEVICE) {
      return json(409, { error: `You can have up to ${MAX_ALERTS_PER_DEVICE} price alerts.` });
    }
    const alert: PriceAlert = { ...parsed.value, id: (deps.randomId ?? newId)(), active: true, createdAt: now, firedAt: null };
    await deps.store.addAlert(auth.id, alert);
    return json(201, { alert });
  }

  const alertMatch = path.match(/^\/v1\/alerts\/([A-Za-z0-9-]{1,64})$/);
  if (alertMatch?.[1] && method === 'DELETE') {
    const removed = await deps.store.deleteAlert(auth.id, alertMatch[1]);
    return removed ? json(200, { ok: true }) : json(404, { error: 'No such alert' });
  }

  return json(404, { error: 'Not found' });
}

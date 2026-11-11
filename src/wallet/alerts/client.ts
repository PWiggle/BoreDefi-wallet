import type { DeviceRegistration, PriceAlert, PriceAlertInput } from './shared';

export type DeviceCredentials = { deviceId: string; secret: string };

export type AlertsFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class AlertsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Talks to the alerts Worker. Sends only: Expo push token, platform, the incoming-alerts toggle, PUBLIC
 * addresses, and price thresholds. Never a recovery phrase, private key, PIN, or balance.
 */
export function createAlertsClient(options: { baseUrl: string; credentials: DeviceCredentials; fetchImpl?: AlertsFetch }) {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as AlertsFetch);
  const auth = `Device ${options.credentials.deviceId}:${options.credentials.secret}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AlertsApiError('Could not reach the alerts server. Check your connection.', 0);
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = (payload as { error?: unknown } | null)?.error;
      throw new AlertsApiError(typeof message === 'string' ? message : `Alerts server error (${response.status}).`, response.status);
    }
    return payload as T;
  }

  return {
    register: (registration: DeviceRegistration) => call<{ ok: true }>('PUT', '/v1/device', registration),
    unregister: () => call<{ ok: true }>('DELETE', '/v1/device'),
    listAlerts: async () => (await call<{ alerts: PriceAlert[] }>('GET', '/v1/alerts')).alerts ?? [],
    createAlert: async (input: PriceAlertInput) => (await call<{ alert: PriceAlert }>('POST', '/v1/alerts', input)).alert,
    deleteAlert: (id: string) => call<{ ok: true }>('DELETE', `/v1/alerts/${encodeURIComponent(id)}`),
  };
}

export type AlertsClient = ReturnType<typeof createAlertsClient>;

/** "$1,234.50", "1234.5", " 0.00012 " -> number; anything else -> null. */
export function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Which addresses to register for incoming-funds alerts (only when the toggle is on). */
export function addressesForRegistration(
  incomingEnabled: boolean,
  evmAddress: string | null,
  solanaAddress: string | null,
): { evmAddresses: string[]; solanaAddresses: string[] } {
  if (!incomingEnabled) return { evmAddresses: [], solanaAddresses: [] };
  return {
    evmAddresses: evmAddress ? [evmAddress.toLowerCase()] : [],
    solanaAddresses: solanaAddress ? [solanaAddress] : [],
  };
}

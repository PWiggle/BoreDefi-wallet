/**
 * Alerts Worker configuration. Everything secret is a Wrangler secret (never in wrangler.toml or git).
 * Nothing here is set up yet: see README.md for the accounts and keys needed to go live.
 */

/** Minimal D1 surface the Worker uses, so tests and typecheck need no Cloudflare packages. */
export type D1Result<T> = { results?: T[] };
export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
};
export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
};

export type AlertsEnv = {
  DB?: D1Database;
  /** Public https URL of this Worker, e.g. https://boredefi-alerts.<account>.workers.dev (var). */
  PUBLIC_BASE_URL?: string;
  /** Minutes between price checks. Default 10 (at most about 4,320 BoreDash calls a month). Var.
   * Prices come ONLY from BoreDash; there is no direct CoinGecko fallback (Patrick's call, Nov 11 2026). */
  PRICE_CHECK_MINUTES?: string;
  /** Optional Expo access token (secret), only if "Enhanced security for push notifications" is turned on. */
  EXPO_ACCESS_TOKEN?: string;
  /** Alchemy Notify auth token (secret) used to add/remove watched addresses. */
  ALCHEMY_AUTH_TOKEN?: string;
  /** Comma list NETWORK=webhookId, e.g. ETH_MAINNET=wh_1,BASE_MAINNET=wh_2 (var, ids are not secret). */
  ALCHEMY_WEBHOOKS?: string;
  /** Comma list of the per-webhook signing keys (secret). */
  ALCHEMY_SIGNING_KEYS?: string;
  /** Helius API key (secret). */
  HELIUS_API_KEY?: string;
  /** Helius webhook id (var). */
  HELIUS_WEBHOOK_ID?: string;
  /** Value Helius sends in the Authorization header (secret, chosen by us when creating the webhook). */
  HELIUS_AUTH_HEADER?: string;
  /** Minutes between Helius address-list edits (each edit costs 100 credits). Default 60. */
  HELIUS_SYNC_MINUTES?: string;
  /** Comma list of chain ids polled over free public RPC (chains with no Alchemy webhook). Default 10,56,43114. */
  POLL_CHAIN_IDS?: string;
};

export function intVar(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function listVar(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** ALCHEMY_WEBHOOKS "ETH_MAINNET=wh_a, BASE_MAINNET=wh_b" -> [{ network, webhookId }]. */
export function parseAlchemyWebhooks(value: string | undefined): Array<{ network: string; webhookId: string }> {
  const out: Array<{ network: string; webhookId: string }> = [];
  for (const part of listVar(value)) {
    const [network, webhookId] = part.split('=').map((piece) => piece?.trim() ?? '');
    if (network && webhookId) {
      out.push({ network: network.toUpperCase(), webhookId });
    }
  }
  return out;
}

-- BoreDefi alerts Worker (Cloudflare D1, free plan). Apply with:
--   npx wrangler d1 execute boredefi-alerts --remote --file=server/alerts/schema.sql
-- Stores ONLY: Expo push token, PUBLIC wallet addresses, price thresholds, and bookkeeping.
-- Never a recovery phrase, private key, PIN, or balance shown to the user.

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  incoming_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_push_token ON devices (push_token);

CREATE TABLE IF NOT EXISTS device_addresses (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('evm', 'solana')),
  address TEXT NOT NULL,
  PRIMARY KEY (device_id, kind, address)
);
CREATE INDEX IF NOT EXISTS device_addresses_lookup ON device_addresses (kind, address);

CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  coin_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  target_usd REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  fired_at INTEGER
);
CREATE INDEX IF NOT EXISTS price_alerts_device ON price_alerts (device_id);
CREATE INDEX IF NOT EXISTS price_alerts_active ON price_alerts (active, coin_id);

-- Addresses already pushed to a provider webhook (provider = 'alchemy:<webhookId>' or 'helius').
CREATE TABLE IF NOT EXISTS synced_addresses (
  provider TEXT NOT NULL,
  address TEXT NOT NULL,
  PRIMARY KEY (provider, address)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Webhook / poll dedupe keys (Alchemy and Helius deliver at least once). Pruned after 3 days.
CREATE TABLE IF NOT EXISTS seen_events (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_events_at ON seen_events (at);

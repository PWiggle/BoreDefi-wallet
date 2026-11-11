import type { PriceAlert } from '../../src/wallet/alerts/shared';
import type { D1Database } from './env';
import type { AddressKind, AlertsStore, AlertWithDevice, DeviceAddress, DeviceRow, Recipient } from './store';

type DeviceDb = {
  id: string;
  secret_hash: string;
  push_token: string;
  platform: 'ios' | 'android';
  incoming_enabled: number;
  created_at: number;
  updated_at: number;
};

type AlertDb = {
  id: string;
  device_id: string;
  coin_id: string;
  symbol: string;
  direction: 'above' | 'below';
  target_usd: number;
  active: number;
  created_at: number;
  fired_at: number | null;
  push_token?: string;
};

function toAlert(row: AlertDb): PriceAlert {
  return {
    id: row.id,
    coinId: row.coin_id,
    symbol: row.symbol,
    direction: row.direction,
    targetUsd: row.target_usd,
    active: row.active === 1,
    createdAt: row.created_at,
    firedAt: row.fired_at,
  };
}

/** D1 can bind at most 100 parameters per statement; keep IN (...) lists under that. */
function chunks<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class D1Store implements AlertsStore {
  constructor(private readonly db: D1Database) {}

  async getDevice(id: string): Promise<DeviceRow | null> {
    const row = await this.db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<DeviceDb>();
    return row
      ? {
          id: row.id,
          secretHash: row.secret_hash,
          pushToken: row.push_token,
          platform: row.platform,
          incomingEnabled: row.incoming_enabled === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async upsertDevice(row: DeviceRow, addresses: DeviceAddress[]): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO devices (id, secret_hash, push_token, platform, incoming_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET push_token = excluded.push_token, platform = excluded.platform,
             incoming_enabled = excluded.incoming_enabled, updated_at = excluded.updated_at`,
        )
        .bind(row.id, row.secretHash, row.pushToken, row.platform, row.incomingEnabled ? 1 : 0, row.createdAt, row.updatedAt),
      // One push token belongs to one device id (reinstall makes a new id): drop the stale row.
      this.db.prepare('DELETE FROM devices WHERE push_token = ? AND id <> ?').bind(row.pushToken, row.id),
      this.db.prepare('DELETE FROM device_addresses WHERE device_id = ?').bind(row.id),
      ...addresses.map((entry) =>
        this.db
          .prepare('INSERT OR IGNORE INTO device_addresses (device_id, kind, address) VALUES (?, ?, ?)')
          .bind(row.id, entry.kind, entry.address),
      ),
    ]);
  }

  async deleteDevice(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM price_alerts WHERE device_id = ?').bind(id),
      this.db.prepare('DELETE FROM device_addresses WHERE device_id = ?').bind(id),
      this.db.prepare('DELETE FROM devices WHERE id = ?').bind(id),
    ]);
  }

  async removePushToken(token: string): Promise<void> {
    const rows = await this.db.prepare('SELECT id FROM devices WHERE push_token = ?').bind(token).all<{ id: string }>();
    for (const row of rows.results ?? []) await this.deleteDevice(row.id);
  }

  async listAlerts(deviceId: string): Promise<PriceAlert[]> {
    const rows = await this.db
      .prepare('SELECT * FROM price_alerts WHERE device_id = ? ORDER BY created_at')
      .bind(deviceId)
      .all<AlertDb>();
    return (rows.results ?? []).map(toAlert);
  }

  async addAlert(deviceId: string, alert: PriceAlert): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO price_alerts (id, device_id, coin_id, symbol, direction, target_usd, active, created_at, fired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(alert.id, deviceId, alert.coinId, alert.symbol, alert.direction, alert.targetUsd, alert.active ? 1 : 0, alert.createdAt, alert.firedAt)
      .run();
  }

  async deleteAlert(deviceId: string, alertId: string): Promise<boolean> {
    const before = await this.db
      .prepare('SELECT id FROM price_alerts WHERE id = ? AND device_id = ?')
      .bind(alertId, deviceId)
      .first<{ id: string }>();
    if (!before) return false;
    await this.db.prepare('DELETE FROM price_alerts WHERE id = ? AND device_id = ?').bind(alertId, deviceId).run();
    return true;
  }

  async activeAlerts(): Promise<AlertWithDevice[]> {
    const rows = await this.db
      .prepare(
        `SELECT a.*, d.push_token FROM price_alerts a JOIN devices d ON d.id = a.device_id WHERE a.active = 1`,
      )
      .all<AlertDb>();
    return (rows.results ?? []).map((row) => ({ ...toAlert(row), deviceId: row.device_id, pushToken: row.push_token ?? '' }));
  }

  async markFired(alertIds: string[], at: number): Promise<void> {
    if (alertIds.length === 0) return;
    await this.db.batch(
      chunks(alertIds).map((ids) =>
        this.db
          .prepare(`UPDATE price_alerts SET active = 0, fired_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
          .bind(at, ...ids),
      ),
    );
  }

  async recipientsFor(kind: AddressKind, addresses: string[]): Promise<Recipient[]> {
    const wanted = [...new Set(addresses.map((address) => (kind === 'evm' ? address.toLowerCase() : address)))];
    const out: Recipient[] = [];
    for (const ids of chunks(wanted)) {
      const rows = await this.db
        .prepare(
          `SELECT d.id AS device_id, d.push_token, a.address FROM device_addresses a JOIN devices d ON d.id = a.device_id
           WHERE d.incoming_enabled = 1 AND a.kind = ? AND a.address IN (${ids.map(() => '?').join(',')})`,
        )
        .bind(kind, ...ids)
        .all<{ device_id: string; push_token: string; address: string }>();
      for (const row of rows.results ?? []) out.push({ deviceId: row.device_id, pushToken: row.push_token, address: row.address });
    }
    return out;
  }

  async watchedAddresses(kind: AddressKind): Promise<string[]> {
    const rows = await this.db
      .prepare(
        `SELECT DISTINCT a.address FROM device_addresses a JOIN devices d ON d.id = a.device_id
         WHERE d.incoming_enabled = 1 AND a.kind = ? ORDER BY a.address`,
      )
      .bind(kind)
      .all<{ address: string }>();
    return (rows.results ?? []).map((row) => row.address);
  }

  async syncedAddresses(provider: string): Promise<string[]> {
    const rows = await this.db
      .prepare('SELECT address FROM synced_addresses WHERE provider = ? ORDER BY address')
      .bind(provider)
      .all<{ address: string }>();
    return (rows.results ?? []).map((row) => row.address);
  }

  async setSyncedAddresses(provider: string, add: string[], remove: string[]): Promise<void> {
    const statements = [
      ...add.map((address) =>
        this.db.prepare('INSERT OR IGNORE INTO synced_addresses (provider, address) VALUES (?, ?)').bind(provider, address),
      ),
      ...remove.map((address) =>
        this.db.prepare('DELETE FROM synced_addresses WHERE provider = ? AND address = ?').bind(provider, address),
      ),
    ];
    if (statements.length) await this.db.batch(statements);
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .bind(key, value)
      .run();
  }

  async seenBefore(key: string, now: number): Promise<boolean> {
    const existing = await this.db.prepare('SELECT key FROM seen_events WHERE key = ?').bind(key).first<{ key: string }>();
    if (existing) return true;
    await this.db.prepare('INSERT OR IGNORE INTO seen_events (key, at) VALUES (?, ?)').bind(key, now).run();
    return false;
  }

  async pruneSeen(olderThan: number): Promise<void> {
    await this.db.prepare('DELETE FROM seen_events WHERE at < ?').bind(olderThan).run();
  }
}

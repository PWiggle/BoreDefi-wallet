import type { PriceAlert } from '../../src/wallet/alerts/shared';

export type AddressKind = 'evm' | 'solana';

export type DeviceRow = {
  id: string;
  /** SHA-256 hex of the device secret. The secret itself never leaves the phone except in the Authorization header. */
  secretHash: string;
  pushToken: string;
  platform: 'ios' | 'android';
  incomingEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DeviceAddress = { kind: AddressKind; address: string };

export type AlertWithDevice = PriceAlert & { deviceId: string; pushToken: string };

export type Recipient = { deviceId: string; pushToken: string; address: string };

/**
 * Storage for the alerts Worker. Holds only: push token, public addresses, price thresholds, and
 * bookkeeping (dedupe keys, synced webhook address lists, last-seen balances for public-RPC polling).
 */
export interface AlertsStore {
  getDevice(id: string): Promise<DeviceRow | null>;
  upsertDevice(row: DeviceRow, addresses: DeviceAddress[]): Promise<void>;
  deleteDevice(id: string): Promise<void>;
  removePushToken(token: string): Promise<void>;

  listAlerts(deviceId: string): Promise<PriceAlert[]>;
  addAlert(deviceId: string, alert: PriceAlert): Promise<void>;
  deleteAlert(deviceId: string, alertId: string): Promise<boolean>;
  activeAlerts(): Promise<AlertWithDevice[]>;
  markFired(alertIds: string[], at: number): Promise<void>;

  /** Devices with incoming alerts on that watch any of these addresses (EVM lowercased). */
  recipientsFor(kind: AddressKind, addresses: string[]): Promise<Recipient[]>;
  /** Distinct addresses of devices with incoming alerts on. */
  watchedAddresses(kind: AddressKind): Promise<string[]>;

  syncedAddresses(provider: string): Promise<string[]>;
  setSyncedAddresses(provider: string, add: string[], remove: string[]): Promise<void>;

  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  /** Records the key and returns false the first time; true when it was already seen (duplicate delivery). */
  seenBefore(key: string, now: number): Promise<boolean>;
  pruneSeen(olderThan: number): Promise<void>;
}

/** In-memory store for tests and local dev. */
export class MemoryStore implements AlertsStore {
  devices = new Map<string, DeviceRow>();
  addresses = new Map<string, DeviceAddress[]>();
  alerts = new Map<string, PriceAlert[]>();
  synced = new Map<string, Set<string>>();
  meta = new Map<string, string>();
  seen = new Map<string, number>();

  async getDevice(id: string) {
    return this.devices.get(id) ?? null;
  }
  async upsertDevice(row: DeviceRow, addresses: DeviceAddress[]) {
    this.devices.set(row.id, { ...row });
    this.addresses.set(row.id, addresses.map((entry) => ({ ...entry })));
  }
  async deleteDevice(id: string) {
    this.devices.delete(id);
    this.addresses.delete(id);
    this.alerts.delete(id);
  }
  async removePushToken(token: string) {
    for (const [id, row] of this.devices) {
      if (row.pushToken === token) {
        await this.deleteDevice(id);
      }
    }
  }
  async listAlerts(deviceId: string) {
    return (this.alerts.get(deviceId) ?? []).map((alert) => ({ ...alert }));
  }
  async addAlert(deviceId: string, alert: PriceAlert) {
    this.alerts.set(deviceId, [...(this.alerts.get(deviceId) ?? []), { ...alert }]);
  }
  async deleteAlert(deviceId: string, alertId: string) {
    const list = this.alerts.get(deviceId) ?? [];
    const next = list.filter((alert) => alert.id !== alertId);
    this.alerts.set(deviceId, next);
    return next.length !== list.length;
  }
  async activeAlerts() {
    const out: AlertWithDevice[] = [];
    for (const [deviceId, list] of this.alerts) {
      const device = this.devices.get(deviceId);
      if (!device) continue;
      for (const alert of list) {
        if (alert.active) out.push({ ...alert, deviceId, pushToken: device.pushToken });
      }
    }
    return out;
  }
  async markFired(alertIds: string[], at: number) {
    const ids = new Set(alertIds);
    for (const list of this.alerts.values()) {
      for (const alert of list) {
        if (ids.has(alert.id)) {
          alert.active = false;
          alert.firedAt = at;
        }
      }
    }
  }
  async recipientsFor(kind: AddressKind, addresses: string[]) {
    const wanted = new Set(addresses.map((address) => (kind === 'evm' ? address.toLowerCase() : address)));
    const out: Recipient[] = [];
    for (const [deviceId, list] of this.addresses) {
      const device = this.devices.get(deviceId);
      if (!device?.incomingEnabled) continue;
      for (const entry of list) {
        if (entry.kind === kind && wanted.has(entry.address)) {
          out.push({ deviceId, pushToken: device.pushToken, address: entry.address });
        }
      }
    }
    return out;
  }
  async watchedAddresses(kind: AddressKind) {
    const out = new Set<string>();
    for (const [deviceId, list] of this.addresses) {
      if (!this.devices.get(deviceId)?.incomingEnabled) continue;
      for (const entry of list) if (entry.kind === kind) out.add(entry.address);
    }
    return [...out].sort();
  }
  async syncedAddresses(provider: string) {
    return [...(this.synced.get(provider) ?? [])].sort();
  }
  async setSyncedAddresses(provider: string, add: string[], remove: string[]) {
    const set = this.synced.get(provider) ?? new Set<string>();
    for (const address of add) set.add(address);
    for (const address of remove) set.delete(address);
    this.synced.set(provider, set);
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
  async seenBefore(key: string, now: number) {
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }
  async pruneSeen(olderThan: number) {
    for (const [key, at] of this.seen) if (at < olderThan) this.seen.delete(key);
  }
}

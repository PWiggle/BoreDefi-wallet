/**
 * Shared between the app and the alerts Worker (server/alerts). Pure TypeScript, no React Native imports,
 * so it runs under tsx tests, in the Expo bundle, and in a Cloudflare Worker.
 *
 * Privacy rule: the alerts server only ever stores an Expo push token, PUBLIC wallet addresses, and price
 * thresholds. Never a recovery phrase, private key, PIN, or balance.
 */

export type PriceDirection = 'above' | 'below';

export type PriceAlertInput = {
  coinId: string;
  symbol: string;
  direction: PriceDirection;
  targetUsd: number;
};

export type PriceAlert = PriceAlertInput & {
  id: string;
  active: boolean;
  createdAt: number;
  firedAt: number | null;
};

export type DeviceRegistration = {
  pushToken: string;
  platform: 'ios' | 'android';
  incomingEnabled: boolean;
  evmAddresses: string[];
  solanaAddresses: string[];
};

/** Hard caps so one device cannot fill the free database or the webhook address lists. */
export const MAX_ALERTS_PER_DEVICE = 20;
export const MAX_ADDRESSES_PER_DEVICE = 5;
/** Prices above this are treated as typos (no coin is worth $100M). */
export const MAX_TARGET_USD = 100_000_000;

const COIN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SYMBOL = /^[A-Za-z0-9.$_-]{1,20}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM = /^0x0{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** ExponentPushToken[xxxx] or ExpoPushToken[xxxx]. */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export function isCoinId(value: unknown): value is string {
  return typeof value === 'string' && COIN_ID.test(value);
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && EVM_ADDRESS.test(value) && !ZERO_EVM.test(value);
}

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && SOLANA_ADDRESS.test(value) && !/^1+$/.test(value);
}

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && EXPO_PUSH_TOKEN.test(value);
}

export function normalizeEvmAddress(value: string): string {
  return value.toLowerCase();
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validatePriceAlert(input: unknown): Validation<PriceAlertInput> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Alert must be an object.' };
  }
  const raw = input as Record<string, unknown>;
  if (!isCoinId(raw.coinId)) {
    return { ok: false, error: 'Unknown coin.' };
  }
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim() : '';
  if (!SYMBOL.test(symbol)) {
    return { ok: false, error: 'Bad coin symbol.' };
  }
  if (raw.direction !== 'above' && raw.direction !== 'below') {
    return { ok: false, error: 'Direction must be above or below.' };
  }
  const target = typeof raw.targetUsd === 'number' ? raw.targetUsd : Number(raw.targetUsd);
  if (!Number.isFinite(target) || target <= 0 || target > MAX_TARGET_USD) {
    return { ok: false, error: 'Enter a price above $0.' };
  }
  return { ok: true, value: { coinId: raw.coinId, symbol: symbol.toUpperCase(), direction: raw.direction, targetUsd: target } };
}

export function validateRegistration(input: unknown): Validation<DeviceRegistration> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Registration must be an object.' };
  }
  const raw = input as Record<string, unknown>;
  if (!isExpoPushToken(raw.pushToken)) {
    return { ok: false, error: 'Bad push token.' };
  }
  if (raw.platform !== 'ios' && raw.platform !== 'android') {
    return { ok: false, error: 'Platform must be ios or android.' };
  }
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const evm = list(raw.evmAddresses);
  const sol = list(raw.solanaAddresses);
  if (!evm.every(isEvmAddress)) {
    return { ok: false, error: 'Bad EVM address.' };
  }
  if (!sol.every(isSolanaAddress)) {
    return { ok: false, error: 'Bad Solana address.' };
  }
  const evmAddresses = [...new Set((evm as string[]).map(normalizeEvmAddress))];
  const solanaAddresses = [...new Set(sol as string[])];
  if (evmAddresses.length + solanaAddresses.length > MAX_ADDRESSES_PER_DEVICE) {
    return { ok: false, error: 'Too many addresses.' };
  }
  return {
    ok: true,
    value: {
      pushToken: raw.pushToken,
      platform: raw.platform,
      incomingEnabled: raw.incomingEnabled === true,
      evmAddresses,
      solanaAddresses,
    },
  };
}

/** True when the alert should fire at this price. Inclusive: "above $100" fires at exactly $100. */
export function alertTriggered(alert: Pick<PriceAlert, 'direction' | 'targetUsd'>, priceUsd: number): boolean {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return false;
  }
  return alert.direction === 'above' ? priceUsd >= alert.targetUsd : priceUsd <= alert.targetUsd;
}

/** "$1,234.56", "$0.0012" — enough digits for small coins. */
export function formatAlertUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return '$—';
  }
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 8;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: value >= 1 ? 2 : 0, maximumFractionDigits: digits })}`;
}

export function priceAlertMessage(alert: Pick<PriceAlert, 'symbol' | 'direction' | 'targetUsd'>, priceUsd: number): {
  title: string;
  body: string;
} {
  const verb = alert.direction === 'above' ? 'rose above' : 'fell below';
  return {
    title: `${alert.symbol} ${verb} ${formatAlertUsd(alert.targetUsd)}`,
    body: `${alert.symbol} is now ${formatAlertUsd(priceUsd)}. Open BoreDefi to see the market.`,
  };
}

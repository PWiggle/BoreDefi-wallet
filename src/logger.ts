const SENSITIVE_KEY =
  /^(mnemonic|phrase|seed|privatekey|private_key|privkey|pin|password|secret|entropy|vault)$/i;
const SENSITIVE_VALUE =
  /\b([a-z]+ ){11,23}[a-z]+\b|(?:0x)?[0-9a-fA-F]{64}\b/;

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) {
      return '[redacted]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(nested);
    }
    return out;
  }
  return value;
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && Boolean(__DEV__);
}

/**
 * Release builds: info and warn are dropped, and errors print the message only (never the extra
 * object, even redacted). Dev builds print everything, redacted.
 */
export function write(level: 'info' | 'warn' | 'error', message: string, extra?: unknown, dev = isDev()) {
  if (!dev) {
    if (level === 'error') {
      console.error(message);
    }
    return;
  }
  const payload = extra === undefined ? '' : redactValue(extra);
  if (level === 'error') {
    console.error(message, payload);
    return;
  }
  if (level === 'warn') {
    console.warn(message, payload);
    return;
  }
  console.log(message, payload);
}

export const logger = {
  info: (message: string, extra?: unknown) => write('info', message, extra),
  warn: (message: string, extra?: unknown) => write('warn', message, extra),
  error: (message: string, extra?: unknown) => write('error', message, extra),
};

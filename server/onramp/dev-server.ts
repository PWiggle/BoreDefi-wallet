/**
 * Local test-mode server. Binds to loopback only so a test key is not exposed on the LAN.
 *
 *   STRIPE_SECRET_KEY_TEST=sk_test_... npx tsx server/onramp/dev-server.ts
 *
 * Then set EXPO_PUBLIC_ONRAMP_URL=http://127.0.0.1:8787 for a dev app build.
 * The Vercel function in api/onramp-session.ts is the deployable endpoint.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { envFromProcess, handleOnrampRequest } from './handler';
import { onrampMode } from './stripe';

const port = Number(process.env.PORT ?? 8787);
const host = '127.0.0.1';

function headerBag(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(message.headers)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    }
  }
  return headers;
}

async function readBody(message: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = `http://${host}:${port}${req.url ?? '/'}`;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bytes = await readBody(req);
  const request = new Request(url, {
    method,
    headers: headerBag(req),
    body: hasBody ? new TextDecoder().decode(bytes) : undefined,
  });
  const response = await handleOnrampRequest(request, envFromProcess());
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const payload = Buffer.from(await response.arrayBuffer());
  res.end(payload);
}

createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end(JSON.stringify({ error: 'Could not start the Stripe onramp.' }));
  });
}).listen(port, host, () => {
  console.log(`BoreDefi onramp ${onrampMode(process.env.ONRAMP_MODE)} server on http://${host}:${port}/api/onramp-session`);
});

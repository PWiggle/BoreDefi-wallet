/**
 * BoreDefi push + price alerts Worker (Cloudflare Workers free plan + D1 free). NOT deployed.
 * See README.md for what is needed to go live.
 */
import { runCron } from './cron';
import { D1Store } from './d1-store';
import type { AlertsEnv } from './env';
import { handleRequest } from './handler';

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

function storeFor(env: AlertsEnv): D1Store {
  if (!env.DB) throw new Error('D1 binding DB is missing');
  return new D1Store(env.DB);
}

export default {
  async fetch(request: Request, env: AlertsEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, { store: storeFor(env), env, waitUntil: (p) => ctx.waitUntil(p) });
    } catch {
      return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
  async scheduled(_event: unknown, env: AlertsEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCron({ store: storeFor(env), env }).then((report) => console.log('cron', JSON.stringify(report))),
    );
  },
};

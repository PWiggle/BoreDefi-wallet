import { alertTriggered, priceAlertMessage } from '../../src/wallet/alerts/shared';
import { isChainId, type ChainId } from '../../src/wallet/chains';
import { diffAddresses, updateAlchemyWebhookAddresses } from './alchemy';
import { SubrequestBudget } from './budget';
import { intVar, listVar, parseAlchemyWebhooks, type AlertsEnv } from './env';
import { DEFAULT_POLL_CHAIN_IDS, pollChain } from './evm-poll';
import { sendPushes, type PushMessage } from './expo-push';
import { deliverActivity } from './handler';
import { putHeliusAddresses } from './helius';
import { fetchAlertPrices, MAX_IDS_PER_CALL, sortedCoinIds, type FetchLike } from './prices';
import type { AlertsStore } from './store';

export const NEXT_PRICE_CHECK = 'price:nextAt';
export const LAST_PRICE_RESULT = 'price:last';
export const HELIUS_LAST_SYNC = 'helius:lastSyncAt';
const MINUTE = 60_000;
/** Cron fires every 5 minutes with a few seconds of jitter; treat "due within 60s" as due. */
const SLACK_MS = MINUTE;

export type CronDeps = { store: AlertsStore; env: AlertsEnv; now?: () => number; fetchImpl?: FetchLike };

export type CronReport = {
  priceCheck: 'not-due' | 'no-alerts' | 'ok' | 'skipped';
  priceCalls: number;
  priceReason?: string;
  fired: number;
  alchemyUpdates: number;
  heliusUpdated: boolean;
  polledChains: number[];
  activityPushed: number;
};

/** Price alerts: BoreDash only. On any BoreDash failure, skip and try again next cycle. */
export async function runPriceCheck(deps: CronDeps, budget: SubrequestBudget, report: CronReport): Promise<void> {
  const { store, env } = deps;
  const now = deps.now?.() ?? Date.now();
  const intervalMs = intVar(env.PRICE_CHECK_MINUTES, 10, 5, 60) * MINUTE;
  const nextAt = Number((await store.getMeta(NEXT_PRICE_CHECK)) ?? '0');
  if (Number.isFinite(nextAt) && now + SLACK_MS < nextAt) {
    report.priceCheck = 'not-due';
    return;
  }
  await store.setMeta(NEXT_PRICE_CHECK, String(now + intervalMs));
  const alerts = await store.activeAlerts();
  const ids = sortedCoinIds(alerts.map((alert) => alert.coinId));
  if (ids.length === 0) {
    report.priceCheck = 'no-alerts';
    return;
  }
  const calls = Math.ceil(ids.length / MAX_IDS_PER_CALL);
  if (!budget.take(calls)) {
    report.priceCheck = 'skipped';
    report.priceReason = 'budget';
    return;
  }
  const result = await fetchAlertPrices(ids, deps.fetchImpl);
  report.priceCalls = result.calls;
  if (!result.ok) {
    report.priceCheck = 'skipped';
    report.priceReason = result.reason;
    await store.setMeta(LAST_PRICE_RESULT, JSON.stringify({ at: now, ok: false, reason: result.reason }));
    console.warn('price check skipped, retry next cycle:', result.reason);
    return;
  }
  report.priceCheck = 'ok';
  await store.setMeta(LAST_PRICE_RESULT, JSON.stringify({ at: now, ok: true, coins: Object.keys(result.prices).length }));
  const fired = alerts.filter((alert) => {
    const price = result.prices[alert.coinId];
    return price !== undefined && alertTriggered(alert, price);
  });
  if (fired.length === 0) return;
  await store.markFired(fired.map((alert) => alert.id), now);
  report.fired = fired.length;
  const messages: PushMessage[] = fired.map((alert) => {
    const price = result.prices[alert.coinId] ?? 0;
    return {
      to: alert.pushToken,
      ...priceAlertMessage(alert, price),
      data: { type: 'price', coinId: alert.coinId, alertId: alert.id },
    };
  });
  const batches = Math.ceil(messages.length / 100);
  if (!budget.take(batches)) {
    console.warn('price pushes over subrequest budget');
  }
  const sent = await sendPushes(messages, { fetchImpl: deps.fetchImpl, accessToken: env.EXPO_ACCESS_TOKEN });
  for (const token of sent.deadTokens) await store.removePushToken(token);
}

/** Keeps each Alchemy webhook's address list equal to the watched EVM addresses (only calls when something changed). */
export async function syncAlchemy(deps: CronDeps, budget: SubrequestBudget, report: CronReport): Promise<void> {
  const { store, env } = deps;
  const token = env.ALCHEMY_AUTH_TOKEN;
  const webhooks = parseAlchemyWebhooks(env.ALCHEMY_WEBHOOKS);
  if (!token || webhooks.length === 0) return;
  const desired = await store.watchedAddresses('evm');
  for (const webhook of webhooks) {
    const provider = `alchemy:${webhook.webhookId}`;
    const { add, remove } = diffAddresses(desired, await store.syncedAddresses(provider));
    if (add.length === 0 && remove.length === 0) continue;
    if (!budget.take()) return;
    if (await updateAlchemyWebhookAddresses(webhook.webhookId, add, remove, token, deps.fetchImpl)) {
      await store.setSyncedAddresses(provider, add, remove);
      report.alchemyUpdates += 1;
    }
  }
}

/** Helius has no add/remove and each edit costs 100 credits: push the full list at most every HELIUS_SYNC_MINUTES. */
export async function syncHelius(deps: CronDeps, budget: SubrequestBudget, report: CronReport): Promise<void> {
  const { store, env } = deps;
  const now = deps.now?.() ?? Date.now();
  if (!env.HELIUS_API_KEY || !env.HELIUS_WEBHOOK_ID || !env.HELIUS_AUTH_HEADER || !env.PUBLIC_BASE_URL) return;
  const desired = await store.watchedAddresses('solana');
  const { add, remove } = diffAddresses(desired, await store.syncedAddresses('helius'));
  if (add.length === 0 && remove.length === 0) return;
  const minutes = intVar(env.HELIUS_SYNC_MINUTES, 60, 15, 24 * 60);
  const last = Number((await store.getMeta(HELIUS_LAST_SYNC)) ?? '0');
  if (Number.isFinite(last) && now - last < minutes * MINUTE) return;
  if (!budget.take()) return;
  const ok = await putHeliusAddresses(
    {
      webhookId: env.HELIUS_WEBHOOK_ID,
      apiKey: env.HELIUS_API_KEY,
      webhookUrl: `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/helius`,
      authHeader: env.HELIUS_AUTH_HEADER,
      addresses: desired,
    },
    deps.fetchImpl,
  );
  await store.setMeta(HELIUS_LAST_SYNC, String(now));
  if (ok) {
    await store.setSyncedAddresses('helius', add, remove);
    report.heliusUpdated = true;
  }
}

export function pollChainIds(env: AlertsEnv): ChainId[] {
  if (env.POLL_CHAIN_IDS === undefined) return DEFAULT_POLL_CHAIN_IDS;
  return listVar(env.POLL_CHAIN_IDS)
    .map(Number)
    .filter((id): id is ChainId => isChainId(id));
}

export async function runEvmPolling(deps: CronDeps, budget: SubrequestBudget, report: CronReport): Promise<void> {
  const chains = pollChainIds(deps.env);
  if (chains.length === 0) return;
  const watched = await deps.store.watchedAddresses('evm');
  if (watched.length === 0) return;
  for (const chainId of chains) {
    const transfers = await pollChain(chainId, watched, deps.store, budget, deps.fetchImpl);
    if (transfers === null) continue;
    report.polledChains.push(chainId);
    if (transfers.length === 0) continue;
    if (!budget.take()) continue;
    const { pushed } = await deliverActivity('evm', transfers, { store: deps.store, env: deps.env, now: deps.now, fetchImpl: deps.fetchImpl });
    report.activityPushed += pushed;
  }
}

/** One cron tick (every 5 minutes). Each step is isolated so one failure does not stop the others. */
export async function runCron(deps: CronDeps): Promise<CronReport> {
  const budget = new SubrequestBudget();
  const report: CronReport = {
    priceCheck: 'not-due',
    priceCalls: 0,
    fired: 0,
    alchemyUpdates: 0,
    heliusUpdated: false,
    polledChains: [],
    activityPushed: 0,
  };
  const now = deps.now?.() ?? Date.now();
  for (const step of [runPriceCheck, syncAlchemy, syncHelius, runEvmPolling]) {
    try {
      await step(deps, budget, report);
    } catch (error) {
      console.warn('cron step failed', step.name, error instanceof Error ? error.message : 'unknown');
    }
  }
  try {
    await deps.store.pruneSeen(now - 3 * 24 * 60 * MINUTE);
  } catch {
    // Pruning is best effort.
  }
  return report;
}

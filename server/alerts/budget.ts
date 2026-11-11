/**
 * Cloudflare Workers free plan allows 50 outbound subrequests per invocation (cron included).
 * Every fetch in a cron run takes one from this budget so the run never trips the limit.
 */
export const FREE_PLAN_SUBREQUESTS = 50;

export class SubrequestBudget {
  constructor(public left = FREE_PLAN_SUBREQUESTS - 2) {}
  take(count = 1): boolean {
    if (this.left < count) return false;
    this.left -= count;
    return true;
  }
}

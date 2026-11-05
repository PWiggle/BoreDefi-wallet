/**
 * Untrusted text (token / NFT names, symbols, memos, metadata) never becomes a link. Bait wording and URLs mark an
 * unverified asset as spam. Verified / protected assets are never flagged by this file; callers check that first.
 */
const URL_LIKE = /\b((?:https?|ftp|ipfs|ipns|wss?):\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|app|co|me|gg|site|online|top|club|fun|link|info|live|pro|vip|cc|tk|ml|ga|cf|gq|ru|cn|claims?|gift|website|space|store|tech|network|finance|exchange|world|life|today|biz|us|eth|sol)\b\S*)/gi;
const BAIT = /\b(claim(?:able|ed|ing|s)?|airdrops?|visit|rewards?|vouchers?|redeem|free\s*mint|bonus|giveaway|gift|eligible|winner|prize|unlock|activate|t\.me|telegram|discord\.gg)\b/i;

export function containsUrl(text: string | null | undefined): boolean {
  if (!text) return false;
  URL_LIKE.lastIndex = 0;
  const hit = URL_LIKE.test(text);
  URL_LIKE.lastIndex = 0;
  return hit;
}

export function containsBait(text: string | null | undefined): boolean {
  return Boolean(text && BAIT.test(text));
}

export function spamTextReasons(...fields: (string | null | undefined)[]): string[] {
  const joined = fields.filter(Boolean).join(' ');
  const reasons: string[] = [];
  if (containsUrl(joined)) reasons.push('Its name or details contain a website link, a common scam lure.');
  if (containsBait(joined)) reasons.push('Its name or details use bait words (claim, airdrop, reward, voucher, visit).');
  return reasons;
}

/** Display-safe copy of untrusted text: links are broken so nothing renders or copies as a tappable URL. */
export function neutralizeUrls(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/(https?|ftp|ipfs|ipns|wss?):\/\//gi, '')
    .replace(URL_LIKE, (m) => m.replace(/\./g, '[.]').replace(/\//g, '⁄'))
    .replace(/[\u200B-\u200D\uFEFF\u2060\u202A-\u202E\u2066-\u2069]/g, '');
}

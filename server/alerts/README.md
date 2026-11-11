# BoreDefi alerts Worker (push notifications + price alerts)

**Not deployed. No accounts made. Nothing costs money until someone signs up and deploys, which needs Patrick's OK.**

It's a Cloudflare Worker with a free D1 database. It does three things:

| What | How | Free-tier source |
| --- | --- | --- |
| Price alerts ("tell me if SOL goes above $250") | Cron every 5 min; price check every `PRICE_CHECK_MINUTES` (default **10**) | **BoreDash only**: `https://www.boredash.com/api/wallet/prices` |
| Incoming funds: Ethereum, Base, **ApeChain**, Arbitrum, Polygon | Alchemy Notify Address Activity webhooks (5 = the free-plan max) | Alchemy free |
| Incoming funds: Optimism, BNB Chain, Avalanche | Cron polls the wallet's own free public RPCs every 5 min | none needed |
| Incoming funds + swaps: Solana | Helius enhanced webhook | Helius free |
| "Swap finished" | Same transfer events: the wallet sent one asset and got a different one back in the same tx | as above |
| Sending the push | Expo Push API → FCM (Android) / APNs (iPhone) | Expo, free |

## Privacy: what is stored

Only these, in D1:
- the Expo push token,
- the platform (ios/android),
- the incoming-alerts on/off toggle,
- **public** wallet addresses (EVM lowercased, Solana as-is), and only while incoming alerts are on,
- price-alert thresholds,
- a SHA-256 hash of a random per-install secret.

Never a recovery phrase, private key, PIN or balance. The per-install id and secret are random and not derived from the wallet. Turning notifications off calls `DELETE /v1/device`, which removes the device, its addresses and its alerts.

**Privacy policy:** a push token is stored next to the user's public addresses, so the server can link one phone to its wallet addresses. The policy should say this is used only to send alerts, kept until the user turns notifications off, and shared only with Expo/Google/Apple (delivery) and Alchemy/Helius (address watching).

## Prices: BoreDash only (Patrick's call, Nov 11 2026)

- There is one GET per check, with every needed coin id sorted and de-duplicated, e.g. `?ids=apecoin,ethereum,solana`. More than 200 coins is split into a few calls.
- 429, non-2xx, `{ "error": … }`, `{ "status": { "error_code" } }` and bad JSON all count as failure. The Worker skips that cycle and tries again next cycle.
- **There is no direct CoinGecko fallback and no separate CoinGecko key.**
- Budget: at most about 4,320 calls/month at 10 minutes, and **zero** when nobody has an active alert. BoreDash proxies one shared free CoinGecko Demo key (10k calls/month) that boredash.com and the wallet's Markets screen also use. Slowing to 15 min (`PRICE_CHECK_MINUTES=15`) halves the load.
- Alerts are one-shot: they fire once, then switch off. The user can delete or re-add them.

## Incoming funds: chains

- **Alchemy (5 free webhooks):** `ETH_MAINNET`, `BASE_MAINNET`, `APECHAIN_MAINNET`, `ARB_MAINNET`, `MATIC_MAINNET`. Address lists are kept in sync with `PATCH /api/update-webhook-addresses`, only when something changed.
- **Public-RPC polling (no account):**
  - Covers Optimism (10), BNB Chain (56) and Avalanche (43114).
  - Each tick it calls `eth_blockNumber`, `eth_getLogs` for known-token Transfer events to and from watched addresses, and a batched `eth_getBalance` (native coin, notifies when the balance goes up).
  - Cloudflare's free plan allows 50 outbound calls per cron run, so polling all 3 chains fits about **400 watched EVM addresses**. Past that, the Worker skips polling a chain rather than failing, and the fix is Workers Paid ($5/mo, needs Patrick's OK).
  - Native-coin receipts on these 3 chains say "Received", never "Swap finished".
- **Spam:** a plain incoming transfer only notifies for the native coin or a token on the wallet's own token list, so address-poisoning dust and spam airdrops stay silent. NFTs are not announced yet.
- **Helius:** each address-list edit costs 100 credits. Edits are batched to at most one per `HELIUS_SYNC_MINUTES` (default 60), which is at most about 72k of the 1M free credits a month. Each delivered event costs 1 credit.

## HTTP API

`Authorization: Device <installId>:<64-hex secret>` on every app call.

| Method | Path | Body |
| --- | --- | --- |
| PUT | `/v1/device` | `{ pushToken, platform, incomingEnabled, evmAddresses[], solanaAddresses[] }` |
| DELETE | `/v1/device` | – |
| GET | `/v1/alerts` | – |
| POST | `/v1/alerts` | `{ coinId, symbol, direction: "above"\|"below", targetUsd }` (max 20 active) |
| DELETE | `/v1/alerts/:id` | – |
| POST | `/v1/webhooks/alchemy` | Alchemy payload, `X-Alchemy-Signature` HMAC checked |
| POST | `/v1/webhooks/helius` | Helius payload, `Authorization` must equal `HELIUS_AUTH_HEADER` |
| GET | `/health` | – |

## Going live (each step needs Patrick's OK; all free tiers)

1. **Cloudflare** (free Workers + D1): create an account, then run `npx wrangler d1 create boredefi-alerts`. Put the id in `wrangler.toml`, then apply the schema with `npx wrangler d1 execute boredefi-alerts --remote --file=server/alerts/schema.sql` and deploy with `npx wrangler deploy -c server/alerts/wrangler.toml`. Set `PUBLIC_BASE_URL` to the workers.dev URL.
2. **Alchemy** (free): create the 5 Address Activity webhooks above, each pointing at `<PUBLIC_BASE_URL>/v1/webhooks/alchemy`.
   - Var `ALCHEMY_WEBHOOKS="ETH_MAINNET=wh_…,BASE_MAINNET=wh_…,APECHAIN_MAINNET=wh_…,ARB_MAINNET=wh_…,MATIC_MAINNET=wh_…"`.
   - Secrets: `wrangler secret put ALCHEMY_AUTH_TOKEN` (the Notify auth token) and `ALCHEMY_SIGNING_KEYS` (the 5 signing keys, comma separated).
3. **Helius** (free): create 1 enhanced webhook pointing at `<PUBLIC_BASE_URL>/v1/webhooks/helius`, with an auth header you choose. Set var `HELIUS_WEBHOOK_ID` and secrets `HELIUS_API_KEY` and `HELIUS_AUTH_HEADER`.
4. **Firebase** (free Spark plan, Android push):
   - Create a project with the Android app `com.boredefi.wallet` and download `google-services.json`.
   - Add `"googleServicesFile": "./google-services.json"` under `expo.android` in app.json.
   - Upload an FCM V1 service-account key to EAS (`eas credentials`, Android → Push Notifications).
5. **Apple push (APNs)**: the next iOS EAS build must have the Push Notifications capability. The `expo-notifications` plugin adds the `aps-environment` entitlement, and EAS can create the APNs key and update the provisioning profile with Patrick's Apple login. This is the existing Apple account, not a second one, and it costs an Expo build credit.
6. **App build**: set `EXPO_PUBLIC_ALERTS_API_URL=<PUBLIC_BASE_URL>` in the EAS profile. Until then the Settings → Notifications row stays hidden.
7. Optional: `EXPO_ACCESS_TOKEN` secret, only if "enhanced push security" is turned on in Expo.

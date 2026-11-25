# Buy crypto server (Stripe test and live mode)

This folder is the test-mode card-to-crypto endpoint for BoreDefi Wallet. Stripe is the merchant of record (KYC and payment). BoreDefi does not add a fee. The handler never reads a seed or a private key. It accepts a public receiving address, checks the asset/network pair, and asks Stripe for a hosted onramp session.

Stripe has approved Crypto Onramp for the PepLabs LLC account (`acct_1NTG8FABpDCXMIZ8`), including live mode. **The secret stays on this server.** Do not put it in the app, and do not attach this Vercel project to boredefi.com.

## What it does

`POST /api/onramp-session`

```json
{
  "destination_currency": "eth",
  "destination_network": "base",
  "wallet_address": "0x…"
}
```

Success:

```json
{ "redirect_url": "https://crypto.link.com?session_hash=…" }
```

The server calls `POST https://api.stripe.com/v1/crypto/onramp_sessions` with `Stripe-Version: 2026-10-28.endive` (no `crypto_onramp_beta` suffix; this account rejects that beta header). It locks the wallet address and locks the asset and network to the pair the app chose. The response to the app is only `redirect_url`. `client_secret` is not forwarded.

`destination_network` stays the Stripe network enum (`base`, `polygon`, …). The `wallet_addresses` key is separate: Ethereum `ethereum`, Base `base_network`, Polygon `polygon`, Solana `solana`. `wallet_addresses[base]` is an unknown parameter. Avalanche has no wallet address field on the session object, so it is not offered.

Allowed pairs are the ones in `src/wallet/onramp/offers.ts` (ETH and USDC on Ethereum and Base, POL/MATIC and USDC on Polygon, SOL and USDC on Solana).

## Environment

Set these on the host. Never commit them and never put the secret in the Expo app.

| Name | Required | Purpose |
| --- | --- | --- |
| `ONRAMP_MODE` | No | `live` uses the live secret and requires Stripe to return `livemode: true`. Any other value, including unset, is **test** mode. |
| `STRIPE_SECRET_KEY_TEST` | Test mode | Test secret key, `sk_test_…`. `sk_live_` and `rk_live_` are refused. Ignored when `ONRAMP_MODE=live`. |
| `STRIPE_SECRET_KEY_LIVE` | Live mode | Live secret key. Must start with `sk_live_` or `rk_live_`. Test keys are refused. Ignored unless `ONRAMP_MODE=live`. |
| `ONRAMP_ALLOWED_ORIGINS` | No | Comma-separated browser origins, for example `https://pwiggle.github.io`. Requests with no `Origin` (the iOS and Android apps) are allowed in test and live mode. `http://localhost` and `http://127.0.0.1` are allowed for Expo web. Any other browser origin is rejected. |
| `STRIPE_SECRET_KEY` | No | Test-mode fallback used only when `STRIPE_SECRET_KEY_TEST` is unset and the value is an `sk_test_…` key. A live value is ignored. Never put a live key here for a preview. |
| `STRIPE_LINK_OAUTH_CLIENT_ID` | Embedded only | Link OAuth client id Stripe provisions for the native onramp. Not a secret key. Required for `POST /api/onramp-embedded`. The hosted session does not use it. |
| `ONRAMP_APP_TOKEN` | No | If set, the app must send the same value in `x-boredefi-onramp`. The matching app value is `EXPO_PUBLIC_ONRAMP_TOKEN`, which is bundled into the binary, so it is not a secret. It only cuts down anonymous callers. |

Keys are never written to logs. A wrong-mode key is refused before Stripe is called.

### Production server

Set these on the Vercel **production** environment of this onramp project (not on boredefi.com):

- `ONRAMP_MODE=live`
- `STRIPE_SECRET_KEY_LIVE` = the live secret from Developers → API keys (`sk_live_…` or `rk_live_…`)
- `ONRAMP_ALLOWED_ORIGINS` only if a website will call the endpoint. Native apps omit `Origin` and still work.
- `ONRAMP_APP_TOKEN` only if you also set `EXPO_PUBLIC_ONRAMP_TOKEN` on the app build.

Do not set `STRIPE_SECRET_KEY_TEST` as a stand-in. Live mode will not read it.

Rate limit: 10 requests per minute per IP, in memory on each instance.

## Deploy a Vercel preview ($0)

The repo root `vercel.json` tells Vercel not to build the Expo app. The function is `api/onramp-session.ts` and uses Node's built-in `fetch` only, so the install step is a no-op.

1. In Vercel, add this GitHub repo as a **new** project on the Hobby plan. Do not assign `boredefi.com` or any production domain.
2. Framework preset: **Other**. Root directory: the repository root. Build command: empty (already set in `vercel.json`).
3. Environment variables for a **Preview** (test mode): leave `ONRAMP_MODE` unset and set `STRIPE_SECRET_KEY_TEST` (or `STRIPE_SECRET_KEY` with a test key) to the test secret from Developers → API keys while the Dashboard is in test mode. For the native embedded onramp also set `STRIPE_LINK_OAUTH_CLIENT_ID`. For production, use the variables in [Production server](#production-server) above. Do not set a live key on the preview project `boredefi-onramp-preview`.
4. Deploy from this branch so Vercel creates a **Preview** deployment, or run the Vercel CLI without `--prod`:
   ```bash
   npx vercel
   ```
   Do not run `vercel --prod`.
5. The preview URL looks like `https://boredefi-wallet-<id>.vercel.app`. `POST /api/onramp-session` without a body returns a JSON error. There is no website on this deployment, and it must not be attached to boredefi.com.

## In-app embedded onramp

`POST /api/onramp-embedded` is the test-mode server for Stripe's native embedded onramp (React Native SDK). It is separate from the hosted session above. BoreDefi still adds no fee and does not sponsor Stripe's fee.

Actions:

- `link_auth` with `email`. Creates a Link auth intent. The response is `auth_intent_id` only.
- `session` with the Link intent, the crypto customer id, the crypto payment token, the asset, the network, the public wallet address, and `source_amount` in USD. The server exchanges the intent for an OAuth access token, keeps that token, and creates a headless onramp session locked to the address. The response is `session_id` only.
- `checkout` with the Link intent and `session_id`. The response is `client_secret`, which the app hands to the Stripe SDK inside `performCheckout`. It is not a hosted redirect.

Allowed embedded pairs are ETH and USDC on Ethereum and Base, and SOL and USDC on Solana. Polygon stays on the hosted browser flow. Live mode is refused. The OAuth access token and refresh token are never returned to the app.

The app turns the native flow on only when `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is a test publishable key (`pk_test_…`) and the build is iOS or Android. A missing key, a live key, web, or a build without the onramp native module keeps the hosted browser checkout.

## Point a build at the server

`eas.json` production and the existing preview profile point Buy at `https://pay.boredefi.com/api/onramp-session`. Do not use those profiles for this test. The `onramp-preview` profile is the test build: Android APK, and an iOS store binary for internal TestFlight only. It does not set the onramp URL or the publishable key, and it does not auto-increment the store build number. Set the variables below as EAS environment variables on that build. Do not set `EXPO_PUBLIC_VERCEL_BYPASS` on a store build. It is only for a protected preview: when set, the app sends it as `x-vercel-protection-bypass`.

```bash
EXPO_PUBLIC_BUY_CRYPTO=1
EXPO_PUBLIC_ONRAMP_URL=https://<onramp-host>.vercel.app
# test publishable key only. A live key disables in-app checkout.
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=
# optional, only if ONRAMP_APP_TOKEN is set on the server
EXPO_PUBLIC_ONRAMP_TOKEN=
# optional preview-only Vercel protection bypass. Never set this for production.
# EXPO_PUBLIC_VERCEL_BYPASS=
```

`EXPO_PUBLIC_ONRAMP_URL` may be the origin or the full `/api/onramp-session` URL. Expo inlines `EXPO_PUBLIC_*` at bundle time, so restart Metro after changing them.

## Run it locally without Vercel

No Stripe call is made until a request arrives. Without the key for the selected mode the process still starts, and a purchase request returns 503. The process does not print the key.

```bash
STRIPE_SECRET_KEY_TEST=sk_test_... npx tsx server/onramp/dev-server.ts
# live mode, still loopback-only:
ONRAMP_MODE=live STRIPE_SECRET_KEY_LIVE=sk_live_... npx tsx server/onramp/dev-server.ts
```

Listens on `http://127.0.0.1:8787` only (override the port with `PORT`). Then:

```bash
EXPO_PUBLIC_BUY_CRYPTO=1 EXPO_PUBLIC_ONRAMP_URL=http://127.0.0.1:8787 npx expo start
```

A phone cannot reach `127.0.0.1` on your computer. Use the Vercel preview URL for a device.

## Tests

```bash
npm test
```

Address checks, live-key refusal, and the app's request builder are covered there. Stripe itself is mocked. A real test-mode purchase still needs `STRIPE_SECRET_KEY_TEST` from the Dashboard and Stripe's own test card flow on `crypto.link.com`.

# Buy crypto server (Stripe test mode)

This folder is the test-mode card-to-crypto endpoint for BoreDefi Wallet. Stripe is the merchant of record (KYC and payment). BoreDefi does not add a fee. The handler never reads a seed or a private key. It accepts a public receiving address, checks the asset/network pair, and asks Stripe for a hosted onramp session.

The live Crypto Onramp application on the PepLabs LLC Stripe account (`acct_1NTG8FABpDCXMIZ8`) is still under review. **Do not deploy this with a live key, do not attach it to boredefi.com, and do not promote a Vercel deployment to production.**

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

The server calls `POST https://api.stripe.com/v1/crypto/onramp_sessions` with `Stripe-Version: 2026-10-28.endive;crypto_onramp_beta=v2`, locks the wallet address, and locks the asset and network to the pair the app chose. The response to the app is only `redirect_url`. `client_secret` is not forwarded.

Allowed pairs are the ones in `src/wallet/onramp/offers.ts` (ETH and USDC on Ethereum and Base, POL/MATIC and USDC on Polygon, AVAX and USDC on Avalanche, SOL and USDC on Solana).

## Environment

Set these on the host. Never commit them and never put the secret in the Expo app.

| Name | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY_TEST` | Yes | Test secret key, `sk_test_…`, from the Stripe Dashboard in **test mode**. `sk_live_` and `rk_live_` are refused. The server does not read `STRIPE_SECRET_KEY`. |
| `ONRAMP_ALLOWED_ORIGINS` | No | Comma-separated browser origins, for example `https://pwiggle.github.io`. Requests with no `Origin` (the iOS and Android apps) are allowed. `http://localhost` and `http://127.0.0.1` are allowed for Expo web. Any other browser origin is rejected when this is set. When it is unset, non-local browser origins are rejected too, except those two loopback hosts. |
| `ONRAMP_APP_TOKEN` | No | If set, the app must send the same value in `x-boredefi-onramp`. The matching app value is `EXPO_PUBLIC_ONRAMP_TOKEN`, which is bundled into the binary, so this is not a secret. It only cuts down anonymous callers. |

Rate limit: 10 requests per minute per IP, in memory on each instance.

## Deploy a Vercel preview ($0)

The repo root `vercel.json` tells Vercel not to build the Expo app. The function is `api/onramp-session.ts` and uses Node's built-in `fetch` only, so the install step is a no-op.

1. In Vercel, add this GitHub repo as a **new** project on the Hobby plan. Do not assign `boredefi.com` or any production domain.
2. Framework preset: **Other**. Root directory: the repository root. Build command: empty (already set in `vercel.json`).
3. Environment variables, **Preview** scope (leave Production unset until you deliberately decide otherwise):
   - `STRIPE_SECRET_KEY_TEST` = the test secret from Developers → API keys while the Dashboard is in test mode.
4. Deploy from this branch so Vercel creates a **Preview** deployment, or run the Vercel CLI without `--prod`:
   ```bash
   npx vercel
   ```
   Do not run `vercel --prod`.
5. The preview URL looks like `https://boredefi-wallet-<id>.vercel.app`. `POST /api/onramp-session` without a body returns a JSON error. There is no website on this deployment, and it must not be attached to boredefi.com.

## Point a dev build at the preview

Do not put these in `eas.json` production. Store builds leave `EXPO_PUBLIC_BUY_CRYPTO` unset, which keeps Buy hidden.

```bash
EXPO_PUBLIC_BUY_CRYPTO=1
EXPO_PUBLIC_ONRAMP_URL=https://<preview>.vercel.app
# optional, only if ONRAMP_APP_TOKEN is set on the server
EXPO_PUBLIC_ONRAMP_TOKEN=
```

`EXPO_PUBLIC_ONRAMP_URL` may be the origin or the full `/api/onramp-session` URL. Expo inlines `EXPO_PUBLIC_*` at bundle time, so restart Metro after changing them.

## Run it locally without Vercel

No Stripe call is made until a request arrives. Without a test key the process still starts, and a purchase request returns 503.

```bash
STRIPE_SECRET_KEY_TEST=sk_test_... npx tsx server/onramp/dev-server.ts
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

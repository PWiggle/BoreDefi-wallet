# Transak Buy provider

BoreDefi Wallet can offer Transak as a second card-to-crypto option next to Stripe. BoreDefi does not add a partner fee. This file is the setup and disclosure draft for PepLabs LLC. Nothing here has been published, and nobody has signed up for a Transak account from this work.

## What the app does

- The Buy screen lets the user pick **Stripe** or **Transak** after choosing an asset and network this wallet can receive (ETH, USDC, POL, SOL on Ethereum, Base, Polygon, and Solana).
- Transak opens its hosted widget in the same in-app browser tab Stripe uses (SFSafariViewController on iOS, a Chrome Custom Tab on Android; the system browser if that tab is unavailable). The in-app dApp browser is not used, and no extra camera or microphone permission is added (Play already rejected several of those). The tab must not use `rel=noreferrer`.
- The app POSTs the user's public address, network, and asset to `EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT` (`/api/widget-url`). That server calls Transak's Create Widget URL API and returns a short-lived `widgetUrl` (about five minutes, single-use `sessionId`). The widget is prefilled with the address and network, and `disableWalletAddressForm=true` locks the address so the purchase cannot be redirected.
- A missing, placeholder, or non-https endpoint hides the Transak option. The Transak API key and API secret never ship in the app; they stay on the server as `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, and `TRANSAK_ENV`.
- Staging is the server default (`TRANSAK_ENV=STAGING`) and opens `https://global-stg.transak.com`. Set `PRODUCTION` on the server only after KYB is approved; that opens `https://global.transak.com`.
- Partner fee is not a widget parameter. It is set in the Transak Partner Dashboard and must stay at **0%** in both Staging and Production.

The server lives in a separate project (`boredefi-transak-api`), not in this wallet repo. It has not been deployed. Do not add it to pay.boredefi.com, boredefi.com, boredswap.app, or mevvy.app.

## Account and keys

A PepLabs LLC / BoreDefi Wallet partner account exists at [dashboard.transak.com](https://dashboard.transak.com). The Buy partner fee is already **0%**. Staging and production API keys, plus the staging API secret, are stored privately on the build machine, not in this repository.

To go from this draft to a testable app build, then to production:

1. Host `boredefi-transak-api` as a new private Vercel project on team `boredefi-7457` (Hobby / free). Set `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, and `TRANSAK_ENV=STAGING` as project env vars. Do not deploy until Patrick says yes.
2. If Transak requires a partner IP allowlist for Create Widget URL, add Vercel's outbound IPs (or a static egress) in the dashboard.
3. If the dashboard asks for an app referrer or domain, use the package name `com.boredefi.wallet` (Android and iOS) and, if a website origin is required, `www.boredefi.com`.
4. Put the hosted origin in the app build config as `EXPO_PUBLIC_TRANSAK_WIDGET_ENDPOINT` (EAS environment or a local `.env` that is not committed). For local testing, `http://127.0.0.1:8788` is enough. Rebuild the app. Do not commit the endpoint if it is still a preview URL with a bypass, and never put the API secret in the app or in `.env.example`.
5. Before taking real payments, complete business verification (KYB) at [forms.transak.com/kyb](https://forms.transak.com/kyb) as PepLabs LLC.
6. After KYB is approved, set the production API key and secret on the server, set `TRANSAK_ENV=PRODUCTION`, confirm partner fee is still **0%** on the Production Products tab, then point store builds at the same endpoint. Switch environments only on the server.
7. Update [boredefi.com/privacy](https://boredefi.com/privacy) and the Play / App Store data-safety forms with the draft wording below **before** a store release that includes Transak. Do not publish those changes until you are ready to ship this feature.

Staging keys are enough to exercise the widget in test mode. Going live needs the KYB approval in step 5.

## Draft disclosure wording

Do not publish these yet. They are drafts for Patrick to paste when the feature ships.

### boredefi.com/privacy

Add a section next to the existing "Buying crypto with Stripe" section, and mention Transak in the summary paragraph that currently names only Stripe.

**Summary sentence to add** (alongside the Stripe sentence):

> If you choose Transak at checkout, the app opens Transak's hosted widget with your public wallet address and the asset and network you chose. PepLabs LLC does not store this information. Transak collects and processes payment and identity checks under its own privacy policy.

**Section draft:**

> **Buying crypto with Transak**
>
> When you choose Transak on the Buy screen, the app opens Transak's hosted checkout (global.transak.com, or global-stg.transak.com while we are in staging) in a secure in-app browser tab. The app sends only your public wallet address and the asset and network you chose (for example ETH on Ethereum, or SOL on Solana). The address is locked so the purchase cannot be sent elsewhere.
>
> Transak is the merchant of record. It collects and processes your payment details and identity verification under the [Transak Privacy Policy](https://transak.com/privacy-policy). PepLabs LLC never sees your card, bank, or ID information, and Transak sends purchased crypto directly to your own wallet address. BoreDefi does not add a fee. Any Transak fee is shown before you pay.
>
> PepLabs LLC does not store your address or your choice from this flow.

Also add Transak to the "Direct requests to public services" list only if you want it listed with the other third parties. The dedicated section above is enough, in the same style as Stripe.

### Google Play Data safety

The current listing already needs to cover Stripe for Buy. When Transak ships, add Transak as another third party for the same data types, collected only when the user starts a Transak purchase, not used for advertising or tracking, and not required for the rest of the app.

Draft answers:

- **Financial info → User payment info:** Not collected by PepLabs. Shared with Transak (and already with Stripe) only if the user taps Buy and continues with that provider, so they can process the card or bank payment. Encrypted in transit. Not sold. Not used for advertising.
- **Financial info → Purchase history:** Shared with Transak only as needed to complete and support that onramp order. Not sold. Not used for advertising.
- **Personal info → User IDs:** The user's public wallet address is sent to Transak (and already to Stripe) to deliver crypto to that address. This is not a PepLabs account ID. Not sold. Not used for advertising.
- **Identity / government ID, photos, and financial account numbers:** Not collected by the app. If Transak asks for identity verification, that happens on Transak's own checkout page, under Transak's policy.
- **Data collection:** Optional and feature-specific (Buy → Transak). Users who never buy crypto, or who only use Stripe, do not send this data to Transak.

### Apple App Store privacy (App Privacy / nutrition labels)

Update the App Privacy section for a release that includes Transak, in addition to the existing Stripe disclosure:

- **Payment Info** and **Purchase History:** No, not collected by the app itself. Used by Transak on its checkout page if the user chooses Transak. Link Transak's privacy policy.
- **User ID:** The public wallet address may be sent to Transak to deliver crypto. Purposes: App Functionality. Linked to the user's identity by Transak for their KYC, not used by PepLabs for tracking. Not used for tracking across apps and websites.
- Do not add Contact Info, Location, Photos, or Browsing History for this feature. The wallet still does not collect those.

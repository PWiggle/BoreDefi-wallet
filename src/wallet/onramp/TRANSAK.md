# Transak Buy provider

BoreDefi Wallet can offer Transak as a second card-to-crypto option next to Stripe. BoreDefi does not add a partner fee. This file is the setup and disclosure draft for PepLabs LLC. Nothing here has been published, and nobody has signed up for a Transak account from this work.

## What the app does

- The Buy screen lets the user pick **Stripe** or **Transak** after choosing an asset and network this wallet can receive (ETH, USDC, POL, SOL on Ethereum, Base, Polygon, and Solana).
- Transak opens its hosted widget in the same in-app browser tab Stripe uses (SFSafariViewController on iOS, a Chrome Custom Tab on Android; the system browser if that tab is unavailable). The in-app dApp browser is not used, and no extra camera or microphone permission is added (Play already rejected several of those).
- The widget is prefilled with the user's own public address and network. `disableWalletAddressForm=true` locks the address so the purchase cannot be redirected.
- The partner API key comes from `EXPO_PUBLIC_TRANSAK_API_KEY` at build time. It is not hardcoded. A missing value or a `REPLACE_ME`-style placeholder hides the Transak option.
- Staging is the default: `EXPO_PUBLIC_TRANSAK_ENVIRONMENT=STAGING` opens `https://global-stg.transak.com`. Set `PRODUCTION` only after KYB is approved; that opens `https://global.transak.com`.
- Partner fee is not a widget parameter. It is set in the Transak Partner Dashboard and must stay at **0%** in both Staging and Production.

This integration does not call Transak's Create Widget URL API. That endpoint is backend-only and needs an API secret plus an IP allowlist. If Transak later requires a session URL, add a server path like the Stripe onramp (secret stays on the server; never in the app).

## What Patrick needs to do to get keys

No Transak account was created for this work. To go from the placeholder to a working staging key, then to production:

1. Sign up at [dashboard.transak.com](https://dashboard.transak.com) with a **PepLabs LLC corporate email** (not a personal address).
2. In the dashboard, open the **Staging** environment and copy the staging API key (the public partner key, not the API secret).
3. In the dashboard **Products** tab, with Staging selected, set the partner fee to **0%** and save.
4. If the dashboard asks for an app referrer or domain, use the package name `com.boredefi.wallet` (Android and iOS) and, if a website origin is required, `www.boredefi.com`.
5. Put the staging key in the app build config as `EXPO_PUBLIC_TRANSAK_API_KEY` (EAS environment or a local `.env` that is not committed). Leave `EXPO_PUBLIC_TRANSAK_ENVIRONMENT=STAGING`. Rebuild the app. Do not commit the key and do not put the API secret in the app or in `.env.example`.
6. Before taking real payments, complete business verification (KYB) at [forms.transak.com/kyb](https://forms.transak.com/kyb) as PepLabs LLC.
7. After KYB is approved, copy the **Production** API key, set partner fee to **0%** again on the Production Products tab, then set `EXPO_PUBLIC_TRANSAK_API_KEY` to the production key and `EXPO_PUBLIC_TRANSAK_ENVIRONMENT=PRODUCTION` on the store build. Switch environments only at build time.
8. Update [boredefi.com/privacy](https://boredefi.com/privacy) and the Play / App Store data-safety forms with the draft wording below **before** a store release that includes Transak. Do not publish those changes until you are ready to ship this feature.

Test keys are enough to exercise the widget in staging. Going live needs the KYB approval in step 6.

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

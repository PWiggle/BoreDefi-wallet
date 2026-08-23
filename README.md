# BoreDefi Wallet

Non-custodial React Native wallet. Android is the first target; the same codebase is iOS-ready.

**Phase 1** covers creating or importing a BIP39 wallet, a backup flow that cannot be skipped, PIN and biometric unlock, encrypted on-device key storage, and send / receive / balances / activity.

**Phase 2** adds same-chain DEX aggregator swaps (best route), WalletConnect so this wallet can connect to dApps, and more EVM chains.

**Phase 3** adds stake / unstake, cross-chain bridge, NFT view / send, and an in-app dApp browser.

**Phase 4** adds Discover / Market (CoinGecko), a Chrome companion extension, and Ledger signing over WebHID.

## What is not included

No fiat on-ramp, Apple Pay, or bank rails. There is no backend that holds keys.

## Security model

- Keys are generated and stored only on the device.
- The BIP39 phrase is written to [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) (Android Keystore / iOS Keychain) and is never logged or transmitted.
- A new wallet is held in memory until the user writes the phrase down **and** re-enters three of the words. There is no skip control.
- Unlock is a 6-digit PIN. Biometrics are an optional convenience unlock.
- Swap and bridge quotes go to LI.FI as public HTTP. NFT lists go to public Blockscout APIs. The seed is never sent. The signed transaction stays on-device.
- WalletConnect sessions and the in-app browser share only the public address and signatures the user approves.
- Optional RPC / WalletConnect project ID overrides belong in a local `.env` (see `.env.example`). Do not put a seed, private key, or privileged API key in the repo.
- Discover uses the public CoinGecko API (no key). Market data is public; it never includes the seed.
- The Chrome extension encrypts the phrase with a PIN-derived AES-GCM key in `chrome.storage.local`. The mobile vault and the extension vault are separate — import the same phrase if you want the same address.
- Ledger: the seed stays on the device. This app only receives an address and signatures.

## Stack

Expo SDK 57 + React Native 0.86, with **ethers v6** for BIP39 / BIP44 (`m/44'/60'/0'/0/0`) and EVM signing.

Swaps and bridges use the public [LI.FI](https://docs.li.fi/) quote API. Same-chain quotes stay on **Swap** (`fromChain === toChain`). Cross-chain quotes are **Bridge** (`fromChain !== toChain`). LI.FI aggregates 1inch, 0x, Kyber, Paraswap, LayerSwap, and others. 0x and 1inch direct APIs now require API keys, which we will not put in this public repo.

WalletConnect is **Reown WalletKit** (`@reown/walletkit`) plus `@walletconnect/react-native-compat`. This is the wallet-side SDK (the app is the wallet, not a dApp). Pairing uses a `wc:` URI from QR, paste, or the in-app browser. A public Cloud project ID is required for the relay:

1. Create a project at [dashboard.reown.com](https://dashboard.reown.com)
2. Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` in a local `.env`
3. Restart Metro (`npx expo start`)

That ID is a client identifier, not a key that can move funds.

The in-app browser uses `react-native-webview` plus an injected EIP-1193 `window.ethereum` (`isBoreDefi` and `isMetaMask` for site compatibility). Signing reuses the same on-device path as WalletConnect.

A companion **Chrome extension** lives in `extension/` (see [Load the Chrome extension](#load-the-chrome-extension)). It injects the same style of provider into https pages.

### Discover / Market

Home shows a live USD total (native balance × CoinGecko price, including `$0.00`), native + USDC/USDT rows with live price and 24h change, and a short top-market strip. **Discover** loads public CoinGecko top markets by default (`/coins/markets`), with trending as a secondary strip and a Retry button if the request fails. No API key and no custom browser `User-Agent`. Search and token rows deep-link into existing Send / Swap / Stake when the asset is on the in-app list (ETH → Lido, USDC → Aave V3, natives → send, listed symbols → swap).

### Ledger

Attempted path:

| Runtime | Transport | Status |
| --- | --- | --- |
| Chrome extension / Expo web | `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-eth` | Implemented. Unlock the device, open the Ethereum app, confirm on hardware. Send / swap / bridge sign EIP-1559 txs at `44'/60'/0'/0/0`. |
| Expo/React Native Android or iOS | USB HID or BLE | **Not shipped.** `@ledgerhq/react-native-hid` is unmaintained and is not wired for this Expo SDK 57 New Architecture prebuild. `@ledgerhq/react-native-hw-transport-ble` needs `react-native-ble-plx`, extra Bluetooth/location permissions, and a custom JSC that this project does not use. |

The signing helpers (`buildUnsignedLedgerTx`, `applyLedgerSignature`) are shared and covered by unit tests. On a phone, **Settings → Ledger** explains the gap and points at the extension / Expo web WebHID path. Stake, NFTs, WalletConnect, and the in-app browser still use the software key when a Ledger is not connected.

## Phase 3 protocol choices

### Stake

| Market | Why |
| --- | --- |
| **Lido stETH on Ethereum** | Canonical liquid staking. `submit()` on `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`. Unstake uses the withdrawal queue at `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` (`requestWithdrawals` / `claimWithdrawals`). Avoids running a 32 ETH validator from a phone. |
| **Aave V3 USDC supply** | Instant withdraw and the most portable “put assets to work” interface. Pools: Ethereum `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`, Base `0xA238Dd80C259a72c79Bd56434e4eC5138f2Bc59B`, and the shared L2 pool `0x794a61358D6845594F94dc1DB02A252b5b4814aD` on Arbitrum, Optimism, Polygon, and Avalanche. |

Native beacon-chain staking is not mobile-friendly. BNB Aave is omitted because the pool address was not verified for this app. Markets are listed only on their home chain.

### Bridge

Verified: LI.FI `GET https://li.quest/v1/quote` accepts `fromChain !== toChain` and returns a `transactionRequest` (example: Base → Arbitrum native ETH via LayerSwap). Bridge reuses that quote + on-device send. Same-chain or bridge-step quotes are rejected on the Swap path.

### NFTs

Public Blockscout v2 `GET {nftApi}/addresses/{addr}/nft?type=ERC-721,ERC-1155` on Ethereum, Base, Arbitrum, Optimism, Polygon, and BNB Chain. No API key. Avalanche has no Blockscout catalog here — the list is empty and send is manual (contract + token id). Transfers use `safeTransferFrom` for both ERC-721 and ERC-1155.

### dApp browser

In-app WebView with an injected provider. Sites can call `eth_requestAccounts`, read RPCs, switch among supported chains, and sign. `wc:` URIs from the address bar or page navigation pair through WalletConnect. Bookmarks: Uniswap, Aave, Lido, Jumper.

## Requirements

- Node.js 22.13+
- npm 10+
- Android Studio with:
  - Android SDK Platform **36**
  - Android SDK Build-Tools **36.0.0**
  - A device or emulator
- `ANDROID_HOME` pointing at the SDK

iOS builds need Xcode 26.4+ (Expo SDK 57). They are not required for Android work.

## Install and run (Android)

```bash
git clone https://github.com/PWiggle/BoreDefi-wallet.git
cd BoreDefi-wallet
npm install
```

Optional: copy `.env.example` to `.env` and set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`.

Generate the native Android project (package `com.boredefi.wallet`, `compileSdk` / `targetSdk` 36) and compile to a device or emulator:

```bash
npx expo prebuild --platform android
npx expo run:android
```

`npm run android` is the same as `expo run:android`.

To compile a debug APK without installing it (requires the Android SDK above):

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
cd android
./gradlew assembleDebug
```

This environment produced `app-debug.apk` with package `com.boredefi.wallet`, `compileSdk` 36, and `targetSdk` 36.

The `android/` folder is generated and gitignored. Re-run prebuild after changing native plugins in `app.json`. After adding WalletConnect native peers or `react-native-webview`, run prebuild again.

## Load the Chrome extension

```bash
npm install
npm run extension:build
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/unpacked`.

Details: [`extension/README.md`](extension/README.md).

## Public web test (phone)

One HTTPS URL for Phases 1–4:

**https://pwiggle.github.io/BoreDefi-wallet/**

This is an Expo web export hosted on GitHub Pages (`experiments.baseUrl` is `/BoreDefi-wallet`). A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) builds `npx expo export --platform web` and publishes the `gh-pages` branch on pushes to `main` or `cursor/phase1-wallet-61ec`.

If that URL 404s the first time, enable Pages once: repo **Settings → Pages → Deploy from a branch → `gh-pages` / root**. The API cannot enable Pages from this agent.

The web build shows a **TEST-ONLY** banner. Never enter a real recovery phrase or use real funds. Vault data on web is local to that browser profile (`localStorage`), not Android Keystore / iOS Keychain.

```bash
npm run export:web   # writes dist/ (gitignored)
```

### Android identifiers

| Setting | Value |
| --- | --- |
| Application ID / package | `com.boredefi.wallet` |
| compileSdk | 36 |
| targetSdk | 36 |
| minSdk | 24 |

These are pinned with `expo-build-properties` in `app.json`.

## Other commands

```bash
npm start                    # Metro bundler
npm run typecheck            # TypeScript
npm test                     # Wallet unit tests (no device required)
npm run check:android-config # package name + SDK 36
npm run extension:build      # Chrome unpacked bundle
npm run export:web           # static site for GitHub Pages
npm run prebuild:android
```

## Networks

| Network | Native token | Default public RPC | NFT catalog |
| --- | --- | --- | --- |
| Ethereum | ETH | `https://ethereum-rpc.publicnode.com` | Blockscout v2 |
| Base | ETH | `https://mainnet.base.org` | Blockscout v2 |
| Arbitrum | ETH | `https://arbitrum-one-rpc.publicnode.com` | Blockscout v2 |
| Optimism | ETH | `https://optimism-rpc.publicnode.com` | Blockscout v2 |
| Polygon | POL | `https://polygon-bor-rpc.publicnode.com` | Blockscout v2 |
| BNB Chain | BNB | `https://bsc-rpc.publicnode.com` | Blockscout v2 |
| Avalanche | AVAX | `https://avalanche-c-chain-rpc.publicnode.com` | Manual send only |

All of these are EVM chains on the same BIP44 account. Activity uses public Blockscout or Routescan account APIs. Rate limits on public endpoints are expected.

Swap / bridge token list (per chain): native + wrapped native + USDC + USDT. Ethereum also lists stETH.

## Test plan (device)

### Phase 1

1. Fresh install → **Create new wallet**. Confirm there is no skip on the backup screen.
2. Leave the acknowledge box unchecked; **Continue** stays disabled.
3. Check the box, continue, and fail verification with a wrong word. Confirm you cannot proceed.
4. Enter the correct three words, set a PIN, enable biometrics if the device has them.
5. Background the app and return. Confirm the lock screen. Unlock with PIN and with biometrics.
6. On Home, switch networks and confirm the address is the same and balances load or show a connection error (no crash).
7. Receive: QR encodes `ethereum:<address>@<chainId>`. Copy address.
8. Send: scan a QR or paste a recipient, review fee, reject an amount larger than balance + fee.
9. On a funded test account, send a small amount and confirm the hash appears in Activity.
10. Settings → reveal phrase requires PIN. Delete wallet requires PIN and returns to Welcome.
11. Import the same phrase and confirm the same address.

### Phase 2

12. Home shows Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, and Avalanche.
13. **Swap**: pick a chain, from/to tokens, amount larger than balance → error. Valid amount → quote shows a route name (for example 1inch) and a minimum received amount. Confirming without funds fails cleanly.
14. On a funded account, swap a small amount of native → USDC (or the reverse). If an ERC-20 spend is required, an approval is sent first. Confirm the hash.
15. Confirm a quote that would be cross-chain is not offered (same-chain only). Use **Bridge** instead.
16. **Connect** without `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`: the screen explains how to set a Reown project ID.
17. With a project ID: on [react-app.walletconnect.com](https://react-app.walletconnect.com) (or any WC v2 dApp) copy/scan the `wc:` URI, approve the session, then reject a `personal_sign` and approve a later one. Disconnect from Settings or the Connect screen.
18. Confirm logs never print the recovery phrase or private key.

### Phase 3

19. **Stake** on Ethereum: Lido ETH market appears. Amount larger than wallet ETH fails. Funded account: stake a small amount → stETH balance rises. Unstake creates a withdrawal-queue request. When finalized, **Claim finalized** returns ETH.
20. **Stake** on Base (or Arbitrum / Optimism / Polygon / Avalanche): Aave V3 USDC appears. Supply a small USDC amount, then withdraw. BNB Chain shows no market.
21. **Bridge**: from and to chains must differ. Amount larger than balance fails. Quote names the LI.FI tool and a minimum received amount. Confirming without funds fails cleanly. Funded account: bridge a small native amount and confirm the source-chain hash.
22. **NFTs**: on Ethereum / Base / etc., the list loads from Blockscout or is empty without crashing. Avalanche explains there is no catalog. **Send NFT manually** with an invalid address is rejected. Funded account: send an ERC-721 (and an ERC-1155 amount if you hold one).
23. **Browser**: open Uniswap / Aave / Lido / Jumper from bookmarks. The site can request accounts; reject once, then approve. A sign or send prompt can be rejected. Paste a `wc:` URI in the address bar and confirm the existing WalletConnect overlay appears. Switching the wallet network emits `chainChanged` to the page.
24. Confirm logs still never print the recovery phrase or private key.

### Phase 4

25. Home shows a USD total and token rows (ETH/native + USDC/USDT) with live CoinGecko prices, plus a Markets strip. Open Discover: top markets load by default (or a clear error + Retry). Search “eth”, tap Ethereum, confirm price / cap / volume, then **Send** / **Swap** / **Stake** land on those screens (ETH stake is Lido on Ethereum).
26. USDC search → Stake opens Aave on a supported chain. A token not on the in-app list shows stats only.
27. Chrome: load `extension/unpacked`. Create a wallet — no skip on backup; wrong verify words fail. Set PIN, unlock, see a balance or RPC error, send with an invalid address/amount fails. On a dApp page, `window.ethereum.isBoreDefi` is true after unlock; reject by locking first.
28. **Ledger** on Android: the screen explains WebHID is unavailable and points at the extension. On Chrome (extension or Expo web) with a Nano + Ethereum app: Connect shows the device address; a small send/swap/bridge asks for a device confirmation. Unplug → disconnect.
29. Confirm logs and the extension service worker never print the recovery phrase or private key. No fiat UI exists.
30. Open **https://pwiggle.github.io/BoreDefi-wallet/** on a phone. Confirm the TEST-ONLY banner. Do not use a real seed or real funds. Walk through create/backup/PIN, Home, Discover, Swap/Stake screens, and (optional) Ledger on a desktop Chrome tab.

## License

MIT

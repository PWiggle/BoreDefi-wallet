# BoreDefi Wallet

Non-custodial React Native wallet. Android is the first target; the same codebase is iOS-ready.

**Phase 1** covers creating or importing a BIP39 wallet, a backup flow that cannot be skipped, PIN and biometric unlock, encrypted on-device key storage, and send / receive / balances / activity.

**Phase 2** adds same-chain DEX aggregator swaps (best route), WalletConnect so this wallet can connect to dApps, and more EVM chains.

## What is not included yet

No stake, bridge, in-app dApp browser, fiat on-ramp, or Chrome extension. Those are later phases. There is no backend that holds keys.

## Security model

- Keys are generated and stored only on the device.
- The BIP39 phrase is written to [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) (Android Keystore / iOS Keychain) and is never logged or transmitted.
- A new wallet is held in memory until the user writes the phrase down **and** re-enters three of the words. There is no skip control.
- Unlock is a 6-digit PIN. Biometrics are an optional convenience unlock.
- Swap quotes go to LI.FI as public HTTP. The seed is never sent. The signed transaction stays on-device.
- WalletConnect sessions share only the public address and signatures the user approves.
- Optional RPC / WalletConnect project ID overrides belong in a local `.env` (see `.env.example`). Do not put a seed, private key, or privileged API key in the repo.

## Stack

Expo SDK 57 + React Native 0.86, with **ethers v6** for BIP39 / BIP44 (`m/44'/60'/0'/0/0`) and EVM signing.

Swaps use the public [LI.FI](https://docs.li.fi/) quote API (`fromChain === toChain` only). LI.FI aggregates 1inch, 0x, Kyber, Paraswap, and others. 0x and 1inch direct APIs now require API keys, which we will not put in this public repo.

WalletConnect is **Reown WalletKit** (`@reown/walletkit`) plus `@walletconnect/react-native-compat`. This is the wallet-side SDK (the app is the wallet, not a dApp). Pairing uses a `wc:` URI from QR or paste. A public Cloud project ID is required for the relay:

1. Create a project at [dashboard.reown.com](https://dashboard.reown.com)
2. Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` in a local `.env`
3. Restart Metro (`npx expo start`)

That ID is a client identifier, not a key that can move funds.

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

The `android/` folder is generated and gitignored. Re-run prebuild after changing native plugins in `app.json`. After adding WalletConnect native peers, run prebuild again.

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
npm run prebuild:android
```

## Networks

| Network | Native token | Default public RPC |
| --- | --- | --- |
| Ethereum | ETH | `https://ethereum-rpc.publicnode.com` |
| Base | ETH | `https://mainnet.base.org` |
| Arbitrum | ETH | `https://arbitrum-one-rpc.publicnode.com` |
| Optimism | ETH | `https://optimism-rpc.publicnode.com` |
| Polygon | POL | `https://polygon-bor-rpc.publicnode.com` |
| BNB Chain | BNB | `https://bsc-rpc.publicnode.com` |
| Avalanche | AVAX | `https://avalanche-c-chain-rpc.publicnode.com` |

All of these are EVM chains on the same BIP44 account. Activity uses public Blockscout or Routescan account APIs. Rate limits on public endpoints are expected.

Swap token list (per chain): native + wrapped native + USDC + USDT.

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
15. Confirm a quote that would be cross-chain is not offered (same-chain only).
16. **Connect** without `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`: the screen explains how to set a Reown project ID.
17. With a project ID: on [react-app.walletconnect.com](https://react-app.walletconnect.com) (or any WC v2 dApp) copy/scan the `wc:` URI, approve the session, then reject a `personal_sign` and approve a later one. Disconnect from Settings or the Connect screen.
18. Confirm logs never print the recovery phrase or private key.

## License

MIT

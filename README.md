# BoreDefi Wallet

Phase 1 of a non-custodial React Native wallet. Android is the first target; the same codebase is iOS-ready.

This release covers creating or importing a BIP39 wallet, a backup flow that cannot be skipped, PIN and biometric unlock, encrypted on-device key storage, and send / receive / balances / activity on Ethereum, Base, and Polygon.

## What Phase 1 is not

No swap, stake, bridge, dApp browser, fiat on-ramp, or Chrome extension. Those are later phases. There is no backend that holds keys.

## Security model

- Keys are generated and stored only on the device.
- The BIP39 phrase is written to [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) (Android Keystore / iOS Keychain) and is never logged or transmitted.
- A new wallet is held in memory until the user writes the phrase down **and** re-enters three of the words. There is no skip control.
- Unlock is a 6-digit PIN. Biometrics are an optional convenience unlock.
- Public RPCs and Blockscout history APIs are used for chain data. Optional RPC overrides belong in a local `.env` (see `.env.example`). Do not put a seed, private key, or privileged API key in the repo.

## Stack

Expo SDK 57 + React Native 0.86, with **ethers v6** for BIP39 / BIP44 (`m/44'/60'/0'/0/0`) and EVM signing.

[Trust Wallet Core](https://developer.trustwallet.com/developer/wallet-core/faq) is a strong later option for Bitcoin / Solana and other non-EVM chains, but it does not ship a first-class React Native module. Phase 1 is EVM-only, so ethers is the maintained path with the smallest native surface.

## Requirements

- Node.js 22.13+
- npm 10+
- Android Studio with:
  - Android SDK Platform **36**
  - Android SDK Build-Tools **36.0.0**
  - A device or emulator
- `ANDROID_HOME` pointing at the SDK

iOS builds need Xcode 26.4+ (Expo SDK 57). They are not required for Phase 1 Android work.

## Install and run (Android)

```bash
git clone https://github.com/PWiggle/BoreDefi-wallet.git
cd BoreDefi-wallet
npm install
```

Generate the native Android project (package `com.boredefi.wallet`, `compileSdk` / `targetSdk` 36) and compile to a device or emulator:

```bash
npx expo prebuild --platform android
npx expo run:android
```

`npm run android` is the same as `expo run:android`.

The `android/` folder is generated and gitignored. Re-run prebuild after changing native plugins in `app.json`.

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
npm start              # Metro bundler
npm run typecheck      # TypeScript
npm test               # Wallet unit tests (no device required)
npm run prebuild:android
```

## Networks

| Network | Native token | Default public RPC |
| --- | --- | --- |
| Ethereum | ETH | `https://ethereum-rpc.publicnode.com` |
| Base | ETH | `https://mainnet.base.org` |
| Polygon | POL | `https://polygon-bor-rpc.publicnode.com` |

Activity uses public Blockscout account APIs. Rate limits on public endpoints are expected.

## Test plan (device)

1. Fresh install → **Create new wallet**. Confirm there is no skip on the backup screen.
2. Leave the acknowledge box unchecked; **Continue** stays disabled.
3. Check the box, continue, and fail verification with a wrong word. Confirm you cannot proceed.
4. Enter the correct three words, set a PIN, enable biometrics if the device has them.
5. Background the app and return. Confirm the lock screen. Unlock with PIN and with biometrics.
6. On Home, switch Ethereum / Base / Polygon and confirm the address is the same (same EVM account) and balances load or show a connection error (no crash).
7. Receive: QR encodes `ethereum:<address>@<chainId>`. Copy address.
8. Send: scan a QR or paste a recipient, review fee, reject an amount larger than balance + fee.
9. On a funded test account, send a small amount and confirm the hash appears in Activity.
10. Settings → reveal phrase requires PIN. Delete wallet requires PIN and returns to Welcome.
11. Import the same phrase and confirm the same address.

## License

MIT

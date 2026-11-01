# BoreDefi Chrome extension

Companion to the mobile app. Same non-custodial model: create or import BIP39, forced backup + three-word verify, 6-digit PIN, encrypted vault in `chrome.storage.local` (AES-GCM, PIN-derived key). The seed is decrypted into the service worker only while unlocked.

This is a **Phase 1 / 2** desktop wallet: portfolio, send/receive, and an injected EIP-1193 provider (`window.ethereum` with `isBoreDefi` / `isMetaMask`, plus EIP-6963 `rdns: com.boredefi.wallet`). Sites talk to this profile’s wallet. There is no custodial backend and no fiat on-ramp. The public Connect demo is [https://pwiggle.github.io/BoreDefi-wallet/connect/](https://pwiggle.github.io/BoreDefi-wallet/connect/).

Keys are **not** synced with the Android app. Import the same recovery phrase if you want the same address.

Ledger USB (WebHID) is available from the popup when a device is unlocked with the Ethereum app open.

## Load unpacked

1. From the repo root: `npm install` then `npm run extension:build` (copies ethers, the icon, and bundles Ledger WebHID).
2. Open Chrome (or Chromium) → `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select `extension/unpacked`
5. Pin “BoreDefi Wallet”, open the popup, create or import a wallet

Rebuild after changing extension sources: `npm run extension:build`

## What it does

- Create / import BIP39 (`m/44'/60'/0'/0/0`)
- Backup cannot be skipped; three words must match
- PIN encrypts the phrase on this Chrome profile
- Balances and send/receive on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche
- Injected provider + EIP-6963 announce for WalletConnect-compatible / MetaMask-detecting dApps (unlock the popup first)
- Optional Ledger connect for the popup (WebHID)

## What it does not do

- No seed sync, no cloud backup
- No Chrome Web Store listing in this phase
- No fiat on-ramp
- WalletConnect relay pairing is not in the popup; dApps should use the injected provider

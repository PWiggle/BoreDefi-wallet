#!/usr/bin/env bash
# Starts two Speculos Nano X emulators (Ethereum on :5000, Solana on :5001) for `npm run test:ledger-speculos`.
# Needs `pip install speculos` and the Ledger app ELFs (SPECULOS_APPS, default ./speculos-apps):
#   app-1.23.0-nanox.elf (Ethereum) and solana-master-nanox.elf (Solana).
# Speculos uses its public test seed; nothing here is a real wallet.
set -euo pipefail
APPS="${SPECULOS_APPS:-./speculos-apps}"
SPECULOS="${SPECULOS_BIN:-speculos}"
"$SPECULOS" --model nanox --display headless --api-port 5000 --apdu-port 9999 "$APPS/app-1.23.0-nanox.elf" >/tmp/speculos-eth.log 2>&1 &
"$SPECULOS" --model nanox --display headless --api-port 5001 --apdu-port 9998 "$APPS/solana-master-nanox.elf" >/tmp/speculos-sol.log 2>&1 &
echo "Speculos starting (logs in /tmp/speculos-eth.log, /tmp/speculos-sol.log)"

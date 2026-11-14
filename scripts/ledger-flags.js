/** Build-time Ledger Bluetooth flags, shared by app.config.js and react-native.config.js (plain CommonJS). */
function flag(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v === '1' || v === 'true';
}

/** Which platforms get the Bluetooth native module. iOS needs both flags, matching src/wallet/ledger-ble.ts. */
function ledgerBleNative(env) {
  const android = flag(env.EXPO_PUBLIC_LEDGER_BLE);
  return { android, ios: android && flag(env.EXPO_PUBLIC_LEDGER_BLE_IOS) };
}

module.exports = { flag, ledgerBleNative };

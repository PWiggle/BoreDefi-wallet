/**
 * Wraps app.json. Ledger Nano X over Bluetooth is build-time opt-in, per platform:
 *   EXPO_PUBLIC_LEDGER_BLE=1                              -> Android test builds get Bluetooth + the Ledger screen.
 *   EXPO_PUBLIC_LEDGER_BLE=1 EXPO_PUBLIC_LEDGER_BLE_IOS=1 -> iPhone test builds too (hidden on iPhone by default).
 * With the flags off (store builds today) the Bluetooth native module, its permissions and the iOS Bluetooth prompt
 * are left out entirely, so production builds are unchanged. react-native.config.js applies the same flags to
 * autolinking.
 */
const { ledgerBleNative } = require('./scripts/ledger-flags.js');

const BLE_PLUGIN = 'react-native-ble-plx';
const LOCATION = ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'];

module.exports = ({ config }) => {
  const native = ledgerBleNative(process.env);
  const pluginName = (entry) => (Array.isArray(entry) ? entry[0] : entry);
  let plugins = config.plugins ?? [];
  if (!native.android && !native.ios) {
    plugins = plugins.filter((entry) => pluginName(entry) !== BLE_PLUGIN);
  }
  const android = { ...config.android };
  if (native.android) {
    // Android 11 and older need location to scan for BLE devices; allowed only up to API 30 (see the plugin).
    android.blockedPermissions = (android.blockedPermissions ?? []).filter((name) => !LOCATION.includes(name));
    plugins = [...plugins, './plugins/withLedgerBleLocation'];
  } else {
    android.blockedPermissions = [
      ...new Set([
        ...(android.blockedPermissions ?? []),
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_ADMIN',
        'android.permission.BLUETOOTH_SCAN',
        'android.permission.BLUETOOTH_CONNECT',
      ]),
    ];
  }
  let { name } = config;
  if (process.env.BOREDEFI_SIDE_BY_SIDE === '1') {
    // Local test APKs only: install next to the Play app without touching it (different package, own data).
    android.package = `${android.package}.ledgertest`;
    name = 'BoreDefi Ledger Test';
  }
  return { ...config, name, android, plugins };
};

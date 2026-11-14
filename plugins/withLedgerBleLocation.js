const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * Ledger Bluetooth on Android 11 and older: BLE scanning there needs a location permission. Declare it only up to
 * API 30 (`maxSdkVersion="30"`), replacing react-native-ble-plx's unbounded entries, so Android 12+ users are never
 * asked for location (BLUETOOTH_SCAN is `neverForLocation` there). Only added when the Ledger BLE flag is on.
 */
const LOCATION = ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'];

function withLedgerBleLocation(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const current = Array.isArray(manifest['uses-permission']) ? manifest['uses-permission'] : [];
    const rest = current.filter((item) => !LOCATION.includes(item.$?.['android:name']));
    for (const name of LOCATION) {
      rest.push({ $: { 'android:name': name, 'android:maxSdkVersion': '30', 'tools:node': 'replace' } });
    }
    manifest['uses-permission'] = rest;
    // ble-plx's plugin also writes <uses-permission-sdk-23> copies; keep them bounded too.
    const sdk23 = Array.isArray(manifest['uses-permission-sdk-23']) ? manifest['uses-permission-sdk-23'] : [];
    manifest['uses-permission-sdk-23'] = sdk23.map((item) =>
      LOCATION.includes(item.$?.['android:name']) ? { $: { ...item.$, 'android:maxSdkVersion': '30' } } : item,
    );
    return config;
  });
}

module.exports = withLedgerBleLocation;

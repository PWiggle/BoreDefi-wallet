/**
 * Leaves react-native-ble-plx (Ledger Bluetooth) out of native builds unless the Ledger BLE flag is on for that
 * platform; see app.config.js. JS only loads the Bluetooth transport when the same flag is on.
 */
const { ledgerBleNative } = require('./scripts/ledger-flags.js');

const native = ledgerBleNative(process.env);

module.exports = {
  dependencies: {
    'react-native-ble-plx': {
      platforms: {
        ...(native.android ? {} : { android: null }),
        ...(native.ios ? {} : { ios: null }),
      },
    },
  },
};

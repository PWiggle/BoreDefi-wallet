const { createRunOncePlugin, withAndroidStyles, withAppBuildGradle, withEntitlementsPlist } = require('expo/config-plugins');

const APP_ATTEST = 'com.apple.developer.devicecheck.appattest-environment';
const MATERIAL = 'com.google.android.material:material:1.12.0';

/**
 * Native pieces the Stripe embedded onramp needs on top of its config plugin.
 * App Attest uses the production environment so TestFlight and device builds can pass attestation.
 * Stripe Identity requires an Android theme that extends Material Components.
 */
function withOnrampNative(config) {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults[APP_ATTEST] = 'production';
    return mod;
  });

  config = withAndroidStyles(config, (mod) => {
    const styles = mod.modResults?.resources?.style;
    const list = Array.isArray(styles) ? styles : styles ? [styles] : [];
    for (const style of list) {
      if (style?.$?.name === 'AppTheme') {
        style.$.parent = 'Theme.MaterialComponents.DayNight.NoActionBar';
      }
    }
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    const contents = mod.modResults.contents;
    if (typeof contents === 'string' && !contents.includes('com.google.android.material:material')) {
      mod.modResults.contents = contents.replace(/dependencies\s*\{/, `dependencies {\n    implementation "${MATERIAL}"`);
    }
    return mod;
  });

  return config;
}

module.exports = createRunOncePlugin(withOnrampNative, 'with-onramp-native', '1.0.0');

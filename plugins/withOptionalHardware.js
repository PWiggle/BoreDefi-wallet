const { withAndroidManifest } = require('expo/config-plugins');

/**
 * CAMERA permission makes Play treat a rear camera as required. Declare the
 * camera features optional so Chromebooks and tablets without one can install.
 * Any other uses-feature entry is optional too.
 */
const OPTIONAL_FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.front',
];

function withOptionalHardware(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const current = manifest['uses-feature'];
    const features = Array.isArray(current) ? current : current ? [current] : [];
    const byName = new Map();
    for (const feature of features) {
      const name = feature.$?.['android:name'];
      if (!name) {
        continue;
      }
      feature.$['android:required'] = 'false';
      byName.set(name, feature);
    }
    for (const name of OPTIONAL_FEATURES) {
      if (byName.has(name)) {
        continue;
      }
      const feature = {
        $: {
          'android:name': name,
          'android:required': 'false',
        },
      };
      features.push(feature);
      byName.set(name, feature);
    }
    manifest['uses-feature'] = features;
    return config;
  });
}

module.exports = withOptionalHardware;

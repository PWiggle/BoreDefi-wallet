const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Drop the debug signingConfig from the release build type so bundleRelease
 * stays unsigned. Upload signing happens outside this repo. The debug build
 * type keeps the throwaway debug keystore for local installs.
 */
function withUnsignedRelease(config) {
  return withAppBuildGradle(config, (gradle) => {
    const before = gradle.modResults.contents;
    const next = before.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)[ \t]*signingConfig signingConfigs\.debug\n/,
      '$1',
    );
    if (next === before) {
      throw new Error('Could not remove release signingConfig from app/build.gradle');
    }
    gradle.modResults.contents = next;
    return gradle;
  });
}

module.exports = withUnsignedRelease;

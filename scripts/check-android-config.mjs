import { readFileSync } from 'node:fs';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const android = app.expo.android;
const plugin = app.expo.plugins.find(
  (entry) => Array.isArray(entry) && entry[0] === 'expo-build-properties',
);

const errors = [];
if (android.package !== 'com.boredefi.wallet') {
  errors.push(`android.package is ${android.package}`);
}
if (app.expo.ios.bundleIdentifier !== 'com.boredefi.wallet') {
  errors.push(`ios.bundleIdentifier is ${app.expo.ios.bundleIdentifier}`);
}
if (plugin?.[1]?.android?.compileSdkVersion !== 36) {
  errors.push('compileSdkVersion is not 36');
}
if (plugin?.[1]?.android?.targetSdkVersion !== 36) {
  errors.push('targetSdkVersion is not 36');
}
if (app.expo.version !== '1.0.0') {
  errors.push(`version (versionName) is ${app.expo.version}`);
}
if (android.versionCode !== 26) {
  errors.push(`android.versionCode is ${android.versionCode}`);
}
if (plugin?.[1]?.android?.useLegacyPackaging !== false) {
  errors.push('useLegacyPackaging is not false (16 KB zip alignment needs uncompressed native libs)');
}
if (plugin?.[1]?.android?.enableMinifyInReleaseBuilds !== true) {
  errors.push('release minify is not enabled');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Android package com.boredefi.wallet; versionName 1.0.0; versionCode 26; compileSdk/targetSdk 36');

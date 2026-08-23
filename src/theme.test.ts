import assert from 'node:assert/strict';
import test from 'node:test';

import {
  darkColors,
  lightColors,
  normalizeAppearance,
  paletteForScheme,
  resolveColorScheme,
} from './theme';

test('normalizes appearance and defaults to system', () => {
  assert.equal(normalizeAppearance('light'), 'light');
  assert.equal(normalizeAppearance('dark'), 'dark');
  assert.equal(normalizeAppearance('system'), 'system');
  assert.equal(normalizeAppearance('nope'), 'system');
  assert.equal(normalizeAppearance(undefined), 'system');
});

test('system appearance falls back to dark when the OS scheme is missing', () => {
  assert.equal(resolveColorScheme('system', 'light'), 'light');
  assert.equal(resolveColorScheme('system', 'dark'), 'dark');
  assert.equal(resolveColorScheme('system', null), 'dark');
  assert.equal(resolveColorScheme('system', undefined), 'dark');
  assert.equal(resolveColorScheme('light', 'dark'), 'light');
  assert.equal(resolveColorScheme('dark', 'light'), 'dark');
});

test('both palettes keep the BoreDefi green accent', () => {
  assert.equal(darkColors.accent, '#2EE59D');
  assert.equal(lightColors.accent, '#2EE59D');
  assert.equal(paletteForScheme('light').bg, lightColors.bg);
  assert.equal(paletteForScheme('dark').bg, darkColors.bg);
  assert.notEqual(lightColors.bg, darkColors.bg);
  assert.notEqual(lightColors.text, darkColors.text);
});

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Patrick's personal ETH must never ship in the customer app.
 * Built from halves so this guard file itself does not contain the contiguous address.
 */
const FORBIDDEN = ('640ebc069e89e5691aad' + '192420d22a4b92443387').toLowerCase();

function walk(dir: string, pred: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git') return [];
      return walk(full, pred);
    }
    return pred(name) ? [full] : [];
  });
}

test("Patrick's personal ETH address never appears in src, app config, or known JS bundles", () => {
  const root = join(__dirname, '../..');
  const files = [
    ...walk(join(root, 'src'), (n) => /\.(ts|tsx|js|jsx|json|md|txt)$/i.test(n)),
    ...walk(join(root, 'server'), (n) => /\.(ts|tsx|js|jsx|json|md|txt)$/i.test(n)),
    ...walk(join(root, 'scripts'), (n) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt)$/i.test(n)),
    ...['app.json', 'eas.json', 'package.json', 'App.tsx', 'index.ts', 'app.config.js', 'app.config.ts', 'README.md']
      .map((f) => join(root, f))
      .filter((f) => existsSync(f)),
  ];

  // Built artifacts when present on disk (local export / CI artifact paths).
  for (const rel of [
    'dist',
    'web-build',
    'android/app/src/main/assets',
    'android/app/build/generated',
  ]) {
    files.push(...walk(join(root, rel), (n) => /\.(js|bundle|hbc|json)$/i.test(n)));
  }

  assert.ok(files.length > 0, 'expected files to scan');
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // Binary or unreadable — skip.
      continue;
    }
    assert.ok(
      !text.toLowerCase().includes(FORBIDDEN),
      `forbidden owner address found in ${file}`,
    );
  }
});

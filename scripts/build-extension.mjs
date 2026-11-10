import { appendFileSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = resolve(root, 'extension/unpacked');
mkdirSync(resolve(unpacked, 'vendor'), { recursive: true });

const ethersVendor = resolve(unpacked, 'vendor/ethers.min.js');
cpSync(resolve(root, 'node_modules/ethers/dist/ethers.min.js'), ethersVendor);
appendFileSync(ethersVendor, '\nexport { ethers };\n');
cpSync(resolve(root, 'assets/icon.png'), resolve(unpacked, 'icon.png'));

await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'extension/src/ledger-entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: resolve(unpacked, 'ledger.js'),
  logLevel: 'info',
});

console.log('Wrote extension/unpacked (load this folder unpacked in Chrome).');

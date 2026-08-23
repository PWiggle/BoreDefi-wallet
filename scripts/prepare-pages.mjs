import { copyFileSync, cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
if (!existsSync(join(dist, 'index.html'))) {
  throw new Error('dist/index.html is missing. Run npm run export:web first.');
}

writeFileSync(join(dist, '.nojekyll'), '');
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
cpSync('connect', join(dist, 'connect'), { recursive: true });

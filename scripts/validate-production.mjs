import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';
const indexPath = join(distDir, 'index.html');

function fail(message) {
  console.error(`[validate:prod] ${message}`);
  process.exit(1);
}

if (!existsSync(indexPath)) fail('dist/index.html is missing');

const html = readFileSync(indexPath, 'utf8');

if (/\/src\/main\.ts|src\/main\.ts/.test(html)) {
  fail('dist/index.html still references TypeScript source');
}

if (/app\.js|styles\.css/.test(html)) {
  fail('dist/index.html references the removed build-independent runtime');
}

const assetsDir = join(distDir, 'assets');
if (!existsSync(assetsDir)) fail('dist/assets is missing');

const assets = readdirSync(assetsDir);
const jsAssets = assets.filter((name) => name.endsWith('.js'));
const cssAssets = assets.filter((name) => name.endsWith('.css'));

if (jsAssets.length === 0) fail('no Vite JavaScript bundle found in dist/assets');
if (cssAssets.length === 0) fail('no Vite CSS bundle found in dist/assets');

for (const name of [...jsAssets, ...cssAssets]) {
  if (!html.includes(`./assets/${name}`) && !html.includes(`/assets/${name}`)) {
    fail(`dist/index.html does not reference generated asset ${name}`);
  }
}

for (const required of ['service-worker.js', 'manifest.webmanifest', 'icon.svg']) {
  if (!existsSync(join(distDir, required))) fail(`dist/${required} is missing`);
}

console.log(`[validate:prod] OK — ${jsAssets.length} JS bundle(s), ${cssAssets.length} CSS bundle(s), Vite-only production artifact`);

import { existsSync, readFileSync } from 'node:fs';
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

if (/(?:src|href)=["'][^"']*(?:^|\/)app\.js["']|(?:src|href)=["'][^"']*(?:^|\/)styles\.css["']/.test(html)) {
  fail('dist/index.html references the removed build-independent runtime');
}

const assetRefs = [...html.matchAll(/(?:src|href)=["']\.\/?assets\/([^"']+)["']/g)].map((match) => match[1]);
const jsRefs = assetRefs.filter((name) => name.endsWith('.js'));
const cssRefs = assetRefs.filter((name) => name.endsWith('.css'));

if (jsRefs.length === 0) fail('dist/index.html has no Vite JavaScript bundle reference');
if (cssRefs.length === 0) fail('dist/index.html has no Vite CSS bundle reference');

for (const name of assetRefs) {
  if (!existsSync(join(distDir, 'assets', name))) {
    fail(`referenced Vite asset is missing: dist/assets/${name}`);
  }
}

for (const required of ['service-worker.js', 'manifest.webmanifest', 'icon.svg', 'vocal-worklet.js']) {
  if (!existsSync(join(distDir, required))) fail(`dist/${required} is missing`);
}

const vocalWorklet = readFileSync(join(distDir, 'vocal-worklet.js'), 'utf8');
if (!vocalWorklet.includes("registerProcessor('sound-wave-vocal-processor'")) {
  fail('dist/vocal-worklet.js does not register the Sound Wave vocal processor');
}
if (/createOscillator\s*\(/.test(vocalWorklet)) {
  fail('vocal AudioWorklet must generate one continuous glottal stream without per-note OscillatorNode creation');
}
for (const requiredFeature of ['sourceTractCoupling', 'aspirationDepth', 'centeringStart', 'phraseEnergy']) {
  if (!vocalWorklet.includes(requiredFeature)) {
    fail(`vocal AudioWorklet is missing Human Phrase Model feature: ${requiredFeature}`);
  }
}

console.log(`[validate:prod] OK — ${jsRefs.length} entry JS bundle(s), ${cssRefs.length} entry CSS bundle(s), Vite-only production artifact + Human Phrase Model vocal AudioWorklet`);

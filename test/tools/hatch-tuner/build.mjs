/* global console */
// Builds the hatch slider page: `npm run tune:hatch`, then open .tuner/hatch.html in a browser.
// The page bundles the plugin's own hatch drawing (src/draw/hatch.ts) and presets (src/options.ts).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const out = join(root, '.tuner');
const tmp = join(out, 'build');

await build({
  entry: { tuner: join(here, 'main.ts') },
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  outDir: tmp,
  config: false,
  silent: true,
  minify: false,
  dts: false,
});

const script = readFileSync(join(tmp, 'tuner.global.js'), 'utf8');
const page = readFileSync(join(here, 'page.html'), 'utf8').replace('/*SCRIPT*/', () => script.replace(/<\/script/gi, '<\\/script'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'hatch.html'), page);
rmSync(tmp, { recursive: true, force: true });
console.log(`Hatch sliders: ${join(out, 'hatch.html')}`);

// Builds the landing page into site/dist: the index (the page with its original CSS, plus the
// split-screen controls), and the same page through postcss-sketchify at each roughness (with
// hand.css: the handwritten font, the page's own choice), which the index lays over itself in a frame.
// Also copies the Google Search Console verification file, which must stay for the site to stay verified.
// Uses the plugin build in dist/ (`npm run site` builds it first). Any warning fails the build, so
// everything on the page is really drawn.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import sketchify from '../dist/index.js';
import { indexPage, sketchPage } from './pages.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const SRC = join(SITE, 'src');
const OUT = join(SITE, 'dist');
export const ROUGHNESS = ['subtle', 'normal', 'messy'];

const read = (name) => readFileSync(join(SRC, name), 'utf8');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

const build = async () => {
  const css = read('style.css');
  const body = read('page.html');
  const sketches = await Promise.all(
    ROUGHNESS.map(async (roughness) => ({ roughness, result: await postcss([sketchify({ roughness })]).process(css, { from: join(SRC, 'style.css') }) })),
  );
  // The divider's "sketchified" tag is drawn by the plugin too.
  const tag = await postcss([sketchify({ roughness: 'normal' })]).process(read('tag.css'), { from: join(SRC, 'tag.css') });
  const warnings = [...tag.warnings().map((w) => `tag: ${w.text}`), ...sketches.flatMap(({ roughness, result }) => result.warnings().map((w) => `${roughness}: ${w.line ?? '?'}:${w.column ?? '?'} ${w.text}`))];
  if (warnings.length > 0) {
    console.error(`site: ${warnings.length} warning(s); the page must be drawn completely.\n${warnings.join('\n')}`);
    process.exitCode = 1;
    return;
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'raw.css'), css);
  sketches.forEach(({ roughness, result }) => {
    writeFileSync(join(OUT, `sketch-${roughness}.css`), result.css);
    writeFileSync(join(OUT, `sketch-${roughness}.html`), sketchPage(`sketchify: ${roughness}`, [`sketch-${roughness}.css`, 'hand.css'], body));
  });
  writeFileSync(join(OUT, 'tag.css'), tag.css);
  ['shell.css', 'shell.js', 'hand.css', 'fonts', 'favicon.svg', 'og.png', 'sitemap.xml', 'llms.txt', 'google0f88cebd856d9d90.html'].forEach((name) => cpSync(join(SRC, name), join(OUT, name), { recursive: true }));
  writeFileSync(join(OUT, 'index.html'), indexPage(read('shell.html'), body));

  sketches.forEach(({ roughness, result }) => {
    const report = result.messages.find((m) => m.type === 'sketchify-report');
    if (report) console.log(`site: ${roughness.padEnd(6)} ${report.drawings} drawings, gzip ${kb(report.before.gzip)} → ${kb(report.after.gzip)}`);
  });
  console.log(`site: built ${OUT}`);
};

await build();

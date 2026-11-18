// Builds the landing page into site/dist: the original CSS as it is (raw), the same CSS through
// postcss-sketchify at each roughness (with hand.css: the handwritten font, the page's own choice),
// and the split-screen shell that lays one over the other.
// Uses the plugin build in dist/ (`npm run site` builds it first). Any warning fails the build, so
// everything on the page is really drawn.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import sketchify from '../dist/index.js';

const SITE = dirname(fileURLToPath(import.meta.url));
const SRC = join(SITE, 'src');
const OUT = join(SITE, 'dist');
export const ROUGHNESS = ['subtle', 'normal', 'messy'];

const read = (name) => readFileSync(join(SRC, name), 'utf8');

/** A page of the stack: the shared body HTML with its stylesheets. */
const page = (title, sheets, body) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<title>${title}</title>\n${sheets.map((href) => `<link rel="stylesheet" href="${href}">\n`).join('')}</head>\n<body>\n${body}</body>\n</html>\n`;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

const build = async () => {
  const css = read('style.css');
  const body = read('page.html');
  const sketches = await Promise.all(
    ROUGHNESS.map(async (roughness) => ({ roughness, result: await postcss([sketchify({ roughness })]).process(css, { from: join(SRC, 'style.css') }) })),
  );
  const warnings = sketches.flatMap(({ roughness, result }) => result.warnings().map((w) => `${roughness}: ${w.line ?? '?'}:${w.column ?? '?'} ${w.text}`));
  if (warnings.length > 0) {
    console.error(`site: ${warnings.length} warning(s); the page must be drawn completely.\n${warnings.join('\n')}`);
    process.exitCode = 1;
    return;
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'raw.css'), css);
  writeFileSync(join(OUT, 'raw.html'), page('sketchify: original CSS', ['raw.css'], body));
  sketches.forEach(({ roughness, result }) => {
    writeFileSync(join(OUT, `sketch-${roughness}.css`), result.css);
    writeFileSync(join(OUT, `sketch-${roughness}.html`), page(`sketchify: ${roughness}`, [`sketch-${roughness}.css`, 'hand.css'], body));
  });
  ['shell.css', 'shell.js', 'hand.css', 'fonts'].forEach((name) => cpSync(join(SRC, name), join(OUT, name), { recursive: true }));
  writeFileSync(join(OUT, 'index.html'), read('shell.html'));

  sketches.forEach(({ roughness, result }) => {
    const report = result.messages.find((m) => m.type === 'sketchify-report');
    if (report) console.log(`site: ${roughness.padEnd(6)} ${report.drawings} drawings, gzip ${kb(report.before.gzip)} → ${kb(report.after.gzip)}`);
  });
  console.log(`site: built ${OUT}`);
};

await build();

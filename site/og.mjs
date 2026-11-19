// Takes the link preview image (site/src/og.png, 1200×630) from the built page: the hero, half raw
// and half sketched, with the divider in the middle. Run by hand when the page's look changes
// (`npm run site:og`, which builds first); the image is committed, not made on every deploy.
/* global document -- only inside page.evaluate, which runs in the browser */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE = dirname(fileURLToPath(import.meta.url));
const OUT = join(SITE, 'dist');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(OUT, path.endsWith('/') ? join(path, 'index.html') : path);
  try {
    if (!file.startsWith(OUT) || !(await stat(file)).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const frame = page.frame({ url: /sketch-normal\.html$/ });
  if (!frame) throw new Error('og: no sketched frame');
  await frame.waitForLoadState('load');
  await Promise.all([page.evaluate(() => document.fonts.ready), frame.evaluate(() => document.fonts.ready)]);
  // The roughness switch would cover the buttons; a still picture does not need it.
  await page.addStyleTag({ content: '.dock { display: none; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SITE, 'src', 'og.png') });
  console.log('og: wrote site/src/og.png');
} finally {
  await browser.close();
  server.close();
}

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { indexPage, sketchPage } from '../../site/pages.mjs';
import { transform } from '../helpers/transform';
import { captureLayout, diffLayouts, type Layout } from './lib/layout';
import { type Screenshot, near, pixelAt, rectOf, screenshot } from './lib/pixels';

// The landing page (site/) lays the original page and its sketched copy on top of each other and
// cuts them at a divider, so the two must line up exactly: the core promise, on the real page, at
// every roughness the page lets visitors switch to. The sketched copy also swaps the font for a
// handwritten one with the same metrics (site/src/hand.css), so this checks that too, with the
// real font files loaded.

const SITE = new URL('../../site/src/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, SITE), 'utf8');
const html = read('page.html');
const css = read('style.css');
const hand = read('hand.css');
const cssPath = new URL('style.css', SITE).pathname;
const ROUGHNESS = ['subtle', 'normal', 'messy'] as const;
const WIDTHS = [1280, 390] as const;
const ORIGIN = 'http://site.test/';

/** Opens the page with these styles from a fake origin that also serves site/src/fonts, and waits for the fonts. */
const open = async (page: Page, styles: ReadonlyArray<string>, font: string): Promise<void> => {
  await page.route(`${ORIGIN}**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path.startsWith('fonts/')) return route.fulfill({ body: readFileSync(new URL(path, SITE)), contentType: 'font/woff2' });
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">${styles.map((s) => `<style>${s}</style>`).join('')}</head><body>${html}</body></html>`;
    return route.fulfill({ body: doc, contentType: 'text/html' });
  });
  await page.goto(`${ORIGIN}index.html`);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate((family) => [400, 700].map((weight) => document.fonts.check(`${weight} 16px "${family}"`)), font)).toEqual([true, true]);
  await page.unrouteAll();
};

const layoutWith = async (page: Page, styles: ReadonlyArray<string>, font: string): Promise<Layout> => {
  await open(page, styles, font);
  return captureLayout(page);
};

test.describe('landing page: both copies line up', () => {
  for (const width of WIDTHS) {
    for (const roughness of ROUGHNESS) {
      test(`${width}px, ${roughness}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const before = await layoutWith(page, [css], 'Monaspace Neon');
        const after = await layoutWith(page, [await transform(css, { roughness }, cssPath), hand], 'Monaspace Radon');
        expect(before.elements.length).toBeGreaterThan(50);
        expect(diffLayouts(before, after)).toEqual([]);
      });
    }
  }
});

/** Share of pixels in the element that differ between the two renders. */
const changed = (a: Screenshot, b: Screenshot, rect: { x: number; y: number; width: number; height: number }): number => {
  const points: Array<boolean> = [];
  for (let y = Math.max(0, Math.floor(rect.y) - 4); y < Math.min(a.height, rect.y + rect.height + 4); y += 2) {
    for (let x = Math.max(0, Math.floor(rect.x) - 4); x < Math.min(a.width, rect.x + rect.width + 4); x += 2) {
      points.push(!near(pixelAt(a, x, y), pixelAt(b, x, y), 24));
    }
  }
  return points.filter(Boolean).length / Math.max(1, points.length);
};

test('landing page: the sketched copy is really drawn (same font, so only the drawings differ)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 4000 });
  const targets = ['.top', '.hl', '.install', '.btn', '.stat-hatch', '.stat-blue', '.step', '.code', '.feature', '.list li', 'a.ulink', '.options__row', '.rule'];
  await open(page, [css], 'Monaspace Neon');
  const rects = await Promise.all(targets.map((selector) => rectOf(page, selector)));
  const raw = await screenshot(page);
  await open(page, [await transform(css, {}, cssPath)], 'Monaspace Neon');
  const sketched = await screenshot(page);
  targets.forEach((selector, i) => {
    const rect = rects[i];
    if (!rect) throw new Error(`no ${selector}`);
    expect(changed(raw, sketched, rect), selector).toBeGreaterThan(0.01);
  });
});

// The built index: the page itself, with the sketched copy over it in a frame. Both must line up in
// the real shell too, not only side by side in separate documents.
test.describe('landing page: the index and its sketched frame line up', () => {
  const shellFile = (name: string): string => read(name);
  const targets = ['.hero__title', '.install', '.stat-hatch', '.options__row', '.foot'];

  for (const width of WIDTHS) {
    test(`${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const sketch = await transform(css, { roughness: 'normal' }, cssPath);
      const tag = await transform(shellFile('tag.css'), { roughness: 'normal' }, new URL('tag.css', SITE).pathname);
      const files: Readonly<Record<string, readonly [string, string]>> = {
        'index.html': [indexPage(shellFile('shell.html'), html), 'text/html'],
        'sketch-normal.html': [sketchPage('sketchify: normal', ['sketch-normal.css', 'hand.css'], html), 'text/html'],
        'raw.css': [css, 'text/css'],
        'sketch-normal.css': [sketch, 'text/css'],
        'hand.css': [hand, 'text/css'],
        'tag.css': [tag, 'text/css'],
        'shell.css': [shellFile('shell.css'), 'text/css'],
        'shell.js': [shellFile('shell.js'), 'text/javascript'],
      };
      await page.route(`${ORIGIN}**`, async (route) => {
        const path = new URL(route.request().url()).pathname.slice(1);
        if (path.startsWith('fonts/')) return route.fulfill({ body: readFileSync(new URL(path, SITE)), contentType: 'font/woff2' });
        const file = files[path];
        return file ? route.fulfill({ body: file[0], contentType: file[1] }) : route.fulfill({ status: 404 });
      });
      const warnings: Array<string> = [];
      page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().startsWith('sketchify:')) warnings.push(message.text());
      });
      await page.goto(`${ORIGIN}index.html`);
      const frame = page.frame({ url: `${ORIGIN}sketch-normal.html` });
      if (!frame) throw new Error('no sketched frame');
      await frame.waitForLoadState('load');
      await Promise.all([page.evaluate(() => document.fonts.ready), frame.evaluate(() => document.fonts.ready)]);
      await page.waitForTimeout(100);

      const rects = (selectors: ReadonlyArray<string>): Array<Array<number>> =>
        selectors.map((selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? [r.x + scrollX, r.y + scrollY, r.width, r.height].map((n) => Math.round(n * 10) / 10) : [];
        });
      const outer = await page.evaluate(rects, targets);
      const inner = await frame.evaluate(rects, targets);
      const offset = await page.evaluate(() => {
        const r = document.getElementById('sketch')?.getBoundingClientRect();
        return [r?.x ?? -1, (r?.y ?? -1) + scrollY];
      });
      expect(offset).toEqual([0, 0]);
      expect(outer.every((r) => r.length === 4)).toBe(true);
      expect(inner).toEqual(outer);
      const heights = await page.evaluate(() => [document.body.offsetHeight, document.getElementById('sketch')?.getBoundingClientRect().height]);
      expect(heights[1]).toBeGreaterThanOrEqual(heights[0] ?? Infinity);
      expect(warnings).toEqual([]);
    });
  }
});

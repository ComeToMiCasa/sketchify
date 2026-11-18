import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
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

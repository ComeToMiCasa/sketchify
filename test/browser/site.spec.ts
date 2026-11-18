import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { transform } from '../helpers/transform';
import { captureLayout, diffLayouts, type Layout } from './lib/layout';
import { type Screenshot, near, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// The landing page (site/) lays the original page and its sketched copy on top of each other and
// cuts them at a divider, so the two must line up exactly: the core promise, on the real page, at
// every roughness the page lets visitors switch to.

const SITE = new URL('../../site/src/', import.meta.url);
const html = readFileSync(new URL('page.html', SITE), 'utf8');
const css = readFileSync(new URL('style.css', SITE), 'utf8');
const cssPath = new URL('style.css', SITE).pathname;
const ROUGHNESS = ['subtle', 'normal', 'messy'] as const;
const WIDTHS = [1280, 390] as const;

const layoutWith = async (page: Page, styles: string): Promise<Layout> => {
  await render(page, html, styles);
  return captureLayout(page);
};

test.describe('landing page: both copies line up', () => {
  for (const width of WIDTHS) {
    for (const roughness of ROUGHNESS) {
      test(`${width}px, ${roughness}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const before = await layoutWith(page, css);
        const after = await layoutWith(page, await transform(css, { roughness }, cssPath));
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

test('landing page: the sketched copy is really drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 4000 });
  const targets = ['.top', '.hl', '.install', '.btn', '.stat-hatch', '.stat-blue', '.step', '.code', '.feature', '.list li', 'a.ulink', '.options__row', '.rule'];
  await render(page, html, css);
  const rects = await Promise.all(targets.map((selector) => rectOf(page, selector)));
  const raw = await screenshot(page);
  await render(page, html, await transform(css, {}, cssPath));
  const sketched = await screenshot(page);
  targets.forEach((selector, i) => {
    const rect = rects[i];
    if (!rect) throw new Error(`no ${selector}`);
    expect(changed(raw, sketched, rect), selector).toBeGreaterThan(0.01);
  });
});

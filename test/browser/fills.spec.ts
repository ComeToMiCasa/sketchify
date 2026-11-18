import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { SAME, difference } from './lib/ink';
import { type Rect, type Rgb, type Screenshot, near, pixelAt, rectOf, screenshot, moveAndSettle } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M6a example page (test/pages/fills): rough and marker fills.
// Fill yellow #ffe38a (dark #8a6d00), hover green #9be7a8, bar blue #3b82f6, marker #fff176.

const page = loadPage('fills');

const YELLOW: Rgb = [0xff, 0xe3, 0x8a];
const DARK_YELLOW: Rgb = [0x8a, 0x6d, 0x00];
const GREEN: Rgb = [0x9b, 0xe7, 0xa8];
const BLUE: Rgb = [0x3b, 0x82, 0xf6];
const WHITE: Rgb = [255, 255, 255];

const shoot = async (p: Page, css: string, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, css);
  await moveAndSettle(p, 0, 0);
  return screenshot(p);
};

const transformed = (): Promise<string> => transform(page.css, {}, page.cssPath);

/** Pixels on a grid inside the rect, `inset` px from its edges. */
const inside = (shot: Screenshot, rect: Rect, inset: number): ReadonlyArray<Rgb> =>
  Array.from({ length: 10 }, (_, i) => i).flatMap((i) =>
    Array.from({ length: 10 }, (_, j) => pixelAt(shot, rect.x + inset + ((rect.width - 2 * inset) * (i + 0.5)) / 10, rect.y + inset + ((rect.height - 2 * inset) * (j + 0.5)) / 10)),
  );

const share = (pixels: ReadonlyArray<Rgb>, color: Rgb): number => pixels.filter((px) => near(px, color, 30)).length / pixels.length;

/** Where the fill starts, going down from above the element, at each x. */
const topEdge = (shot: Screenshot, rect: Rect, color: Rgb): ReadonlyArray<number> =>
  Array.from({ length: Math.floor((rect.width - 40) / 4) }, (_, i) => rect.x + 20 + i * 4).map((x) => {
    const y = Array.from({ length: 16 }, (_, k) => rect.y - 4 + k).find((yy) => near(pixelAt(shot, x, yy), color, 40));
    return y === undefined ? Number.NaN : y - rect.y;
  });

const fillMask = (shot: Screenshot, rect: Rect, color: Rgb): ReadonlySet<string> =>
  new Set(
    Array.from({ length: Math.round(rect.width) + 16 }, (_, i) => i - 8)
      .flatMap((dx) => Array.from({ length: Math.round(rect.height) + 16 }, (_, j) => [dx, j - 8] as const))
      .filter(([dx, dy]) => near(pixelAt(shot, rect.x + dx, rect.y + dy), color, 40))
      .map(([dx, dy]) => `${dx},${dy}`),
  );

test.describe('M6a rough and marker fills', () => {
  test('a rough fill paints the inside of the element', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    for (const id of ['block1', 'block2', 'block-framed']) {
      expect(share(inside(shot, await rectOf(p, `#${id}`), 5), YELLOW), `${id}: filled inside`).toBeGreaterThanOrEqual(0.95);
    }
    expect(share(inside(shot, await rectOf(p, '#bar'), 4), BLUE), 'bar without a border: filled').toBeGreaterThanOrEqual(0.9);
  });

  test('its edges are ragged and the original rectangle is gone', async ({ page: p }) => {
    const original = await shoot(p, page.css);
    const shot = await shoot(p, await transformed());
    const rect = await rectOf(p, '#block1');
    // The original background is a straight edge at the element's top.
    expect(new Set(topEdge(original, rect, YELLOW))).toEqual(new Set([0]));
    const edge = topEdge(shot, rect, YELLOW);
    expect(edge.every(Number.isFinite), 'the fill reaches the top edge everywhere').toBe(true);
    expect(Math.max(...edge) - Math.min(...edge), 'the top edge wanders').toBeGreaterThanOrEqual(2);
    // The corner of the element's box is no longer painted (the background is transparent).
    expect(near(pixelAt(shot, rect.x + 0.5, rect.y + 0.5), WHITE, 30), 'corner shows the page').toBe(true);
  });

  test('neighbours get different shapes', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const a = fillMask(shot, await rectOf(p, '#block1'), YELLOW);
    const b = fillMask(shot, await rectOf(p, '#block2'), YELLOW);
    expect(difference(a, b)).toBeGreaterThan(0.01);
  });

  test('a marker reaches past the element and lets the text show through', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    for (const id of ['hl', 'note']) {
      const rect = await rectOf(p, `#${id}`);
      const midY = rect.y + rect.height / 2;
      const yellowish = ([r, g, b]: Rgb): boolean => r > 230 && g > 220 && b < 215;
      // The ends are ragged, so look across several rows, 1-6px past each end.
      const rows = [0.3, 0.5, 0.7].map((f) => rect.y + rect.height * f);
      const past = (x0: number, dir: number): ReadonlyArray<Rgb> => rows.flatMap((y) => Array.from({ length: 6 }, (_, i) => pixelAt(shot, x0 + dir * (1 + i), y)));
      expect(past(rect.x, -1).some(yellowish) && past(rect.x + rect.width, 1).some(yellowish), `${id}: marker past both ends`).toBe(true);
      // Text may sit right next to the marker, so only the marker colour counts here.
      expect(yellowish(pixelAt(shot, rect.x - 12, midY)) || yellowish(pixelAt(shot, rect.x + rect.width + 12, midY)), `${id}: not too far`).toBe(false);
    }
    // Translucent: lighter than the CSS colour on white, and text stays dark under it.
    const hl = await rectOf(p, '#hl');
    const ink = inside(shot, hl, 2);
    expect(ink.some(([r, g, b]) => r < 120 && g < 120 && b < 120), 'text shows through').toBe(true);
  });

  test('hover redraws the fill in the hover colour; a modifier keeps the original background', async ({ page: p }) => {
    await shoot(p, await transformed());
    const btn = await rectOf(p, '#btn1');
    await moveAndSettle(p, btn.x + 4, btn.y + btn.height / 2);
    const hovered = await screenshot(p);
    const pixels = inside(hovered, btn, 6).filter((px) => !(px[0] < 120 && px[1] < 120 && px[2] < 120));
    expect(share(pixels, GREEN), 'hover colour').toBeGreaterThanOrEqual(0.9);

    const shot = await shoot(p, await transformed());
    const flat = await rectOf(p, '#btn-flat');
    // The flat button's own box is painted again, up to its corners' radius.
    expect(near(pixelAt(shot, flat.x + 3, flat.y + flat.height / 2), YELLOW, 30), 'original background').toBe(true);
  });

  test('dark mode uses the dark fill colour', async ({ page: p }) => {
    const shot = await shoot(p, await transformed(), 'dark');
    expect(share(inside(shot, await rectOf(p, '#block1'), 5), DARK_YELLOW), 'dark fill').toBeGreaterThanOrEqual(0.95);
  });

  test('a background image stays as it is', async ({ page: p }) => {
    const original = await shoot(p, page.css);
    const shot = await shoot(p, await transformed());
    const rect = await rectOf(p, '#image');
    const a = inside(original, rect, 6);
    const b = inside(shot, rect, 6);
    expect(a.every((px, i) => near(px, b[i] ?? [0, 0, 0], 4))).toBe(true);
  });

  test('without the transform the measures see a plain background (control)', async ({ page: p }) => {
    const shot = await shoot(p, page.css);
    const rect = await rectOf(p, '#block1');
    expect(near(pixelAt(shot, rect.x + 0.5, rect.y + 0.5), YELLOW, 30)).toBe(true);
    expect(SAME).toBeGreaterThan(0);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { HATCH_PRESETS } from '../../src/options';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { SAME, difference, inkMask } from './lib/ink';
import { type Rect, type Rgb, type Screenshot, pixelAt, rectOf, screenshot, moveAndSettle } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M6c example page (test/pages/exact-hatch): elements of known size, whose
// hatch is drawn stroke by stroke into the border drawing. Hatch blue #3b82f6 (dark: amber
// #f59e0b), hover green #16a34a, border ink #1d2433.

const page = loadPage('exact-hatch');
const { over, weight } = HATCH_PRESETS.normal;

type Ink = (px: Rgb) => boolean;
const blue: Ink = ([r, g, b]) => b - r > 60 && b - g > 30;
const green: Ink = ([r, g, b]) => g - r > 40 && g - b > 40;
const amber: Ink = ([r, g, b]) => r - b > 100 && g - b > 50;
const dark: Ink = ([r, g, b]) => r < 110 && g < 110 && b < 130 && Math.max(r, g, b) - Math.min(r, g, b) < 40;

const shoot = async (p: Page, css: string, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, css);
  await moveAndSettle(p, 0, 0);
  return screenshot(p);
};

const transformed = (css = page.css): Promise<string> => transform(css, {}, page.cssPath);

/** Pixels along a horizontal line `dy` px above the element (negative: inside), between its rounded corners. */
const rowAbove = (shot: Screenshot, rect: Rect, dy: number, inset = 16): ReadonlyArray<Rgb> =>
  Array.from({ length: Math.floor(rect.width - 2 * inset) }, (_, i) => pixelAt(shot, rect.x + inset + i, rect.y - dy));

const share = (pixels: ReadonlyArray<Rgb>, ink: Ink): number => pixels.filter(ink).length / pixels.length;

const inside = (shot: Screenshot, rect: Rect, inset: number): ReadonlyArray<Rgb> => {
  const w = Math.floor(rect.width - 2 * inset);
  const h = Math.floor(rect.height - 2 * inset);
  return Array.from({ length: w * h }, (_, i) => pixelAt(shot, rect.x + inset + (i % w), rect.y + inset + Math.floor(i / w)));
};

test.describe('M6c exact hatch', () => {
  test('strokes end unevenly: some reach past the border, none beyond the reach', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    for (const id of ['card1', 'boxed', 'bare', 'hinted']) {
      const rect = await rectOf(p, `#${id}`);
      // 2px outside the top edge: some strokes end there, others end before it.
      const band = share(rowAbove(shot, rect, 2), blue);
      expect(band, `${id}: strokes past the edge`).toBeGreaterThan(0.05);
      expect(band, `${id}: not every stroke reaches as far`).toBeLessThan(0.6);
      // Past `over` plus a whole stroke weight, nothing.
      expect(share(rowAbove(shot, rect, over + weight + 2), blue), `${id}: nothing beyond the reach`).toBe(0);
    }
  });

  test('the inside is hatched: strokes and gaps, no solid background', async ({ page: p }) => {
    const original = await shoot(p, page.css);
    const shot = await shoot(p, await transformed());
    for (const id of ['card1', 'wide', 'boxed', 'bare', 'hinted']) {
      const rect = await rectOf(p, `#${id}`);
      expect(share(inside(original, rect, 6), blue), `${id}: solid in the original`).toBeGreaterThan(0.95);
      const s = share(inside(shot, rect, 6), blue);
      expect(s, `${id}: ink share`).toBeGreaterThan(0.3);
      expect(s, `${id}: ink share`).toBeLessThan(0.75);
    }
  });

  test('no strokes outside rounded corners', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    for (const id of ['card1', 'bare']) {
      const rect = await rectOf(p, `#${id}`);
      // Just outside each corner of the bounding box: well outside a 12–16px rounded corner.
      const corners = [
        [rect.x - 2, rect.y - 2],
        [rect.x + rect.width + 1, rect.y - 2],
        [rect.x - 2, rect.y + rect.height + 1],
        [rect.x + rect.width + 1, rect.y + rect.height + 1],
      ] as const;
      expect(corners.filter(([x, y]) => blue(pixelAt(shot, x, y))), `${id}: corners`).toEqual([]);
    }
  });

  test('neighbours differ, and every hatch slants the same way', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const a = inkMask(shot, await rectOf(p, '#card1'), blue);
    const b = inkMask(shot, await rectOf(p, '#card2'), blue);
    expect(difference(a, b)).toBeGreaterThan(SAME);
    // Along "/" (up and to the right) ink continues; along "\" it is broken by the gaps.
    for (const id of ['card1', 'card2', 'card3', 'wide', 'boxed', 'bare']) {
      const mask = inkMask(shot, await rectOf(p, `#${id}`), blue);
      const keys = [...mask].map((key) => key.split(',').map(Number) as [number, number]);
      const along = keys.filter(([x, y]) => mask.has(`${x + 4},${y - 4}`)).length;
      const across = keys.filter(([x, y]) => mask.has(`${x + 4},${y + 4}`)).length;
      expect(along, `${id}: slant`).toBeGreaterThan(across * 1.5);
    }
  });

  test('the border looks like the border of an element without a hatch', async ({ page: p }) => {
    // The same cards drawn with a plain (solid) fill: the border comes from the same square drawing.
    // A white hatch on the white page, so only the border shows in both.
    const white = page.css.replace('--hatch: #3b82f6;', '--hatch: #ffffff;');
    const solid = await shoot(p, await transformed(white.replace(/\.card \{([^}]*)--sketch-fill: hatch;/, '.card {$1')));
    const hatched = await shoot(p, await transformed(white));
    for (const id of ['card1', 'card2', 'card3']) {
      const rect = await rectOf(p, `#${id}`);
      expect(difference(inkMask(solid, rect, dark), inkMask(hatched, rect, dark)), `${id}: border`).toBeLessThan(SAME);
    }
  });

  test('hover and dark mode change the hatch colour', async ({ page: p }) => {
    await shoot(p, await transformed());
    const card = await rectOf(p, '#card1');
    await moveAndSettle(p, card.x + card.width / 2, card.y + card.height / 2);
    // The hover drawing is a large SVG; under load WebKit can take a few frames to swap it in, so
    // shoot again until it shows (the expectations below are unchanged).
    await expect.poll(async () => share(inside(await screenshot(p), card, 6), green), { timeout: 3000 }).toBeGreaterThan(0.3);
    const hovered = await screenshot(p);
    expect(share(inside(hovered, card, 6), green), 'green on hover').toBeGreaterThan(0.3);
    expect(share(inside(hovered, card, 6), blue), 'no blue on hover').toBe(0);

    const night = await shoot(p, await transformed(), 'dark');
    for (const id of ['card1', 'wide', 'bare']) {
      const rect = await rectOf(p, `#${id}`);
      expect(share(inside(night, rect, 6), amber), `${id}: amber in dark mode`).toBeGreaterThan(0.3);
      expect(share(inside(night, rect, 6), blue), `${id}: no blue in dark mode`).toBe(0);
    }
  });

  test('an element over the size limit keeps the repeated hatch', async ({ page: p }) => {
    await shoot(p, await transformed());
    const style = await p.$eval('#big', (el) => {
      const s = getComputedStyle(el);
      return { size: s.backgroundSize, clip: s.backgroundClip };
    });
    expect(style).toEqual({ size: '192px 192px', clip: 'padding-box' });
  });
});

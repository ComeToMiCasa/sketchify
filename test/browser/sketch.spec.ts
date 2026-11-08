import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Rect, type Rgb, type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M1 example page (test/pages/sketch) to check where the drawing
// is and is not. Borders there are red (#e5484d); the hover colour is blue (#3b82f6).

const page = loadPage('sketch');

type Ink = (px: Rgb) => boolean;
// Thin anti-aliased lines are paler than the CSS colour, so ink is judged by hue, not distance.
const red: Ink = ([r, g, b]) => r - g > 40 && r - b > 40;
const blue: Ink = ([r, g, b]) => b - r > 40 && b - g > 20;
const white: Ink = ([r, g, b]) => r > 245 && g > 245 && b > 245;

type Element = { readonly id: string; readonly width: number };

const ELEMENTS: ReadonlyArray<Element> = [
  { id: 'sharp-1', width: 1 },
  { id: 'sharp-2', width: 2 },
  { id: 'sharp-4', width: 4 },
  { id: 'round-1', width: 1 },
  { id: 'round-2', width: 2 },
  { id: 'round-4', width: 4 },
  { id: 'btn', width: 2 },
  { id: 'twice', width: 2 },
  { id: 'important', width: 2 },
  { id: 'wide', width: 2 },
  { id: 'responsive', width: 3 },
];

/** Whether any pixel within ±4px of (x, y) along the axis across the border is ink. */
const inkAcross = (shot: Screenshot, x: number, y: number, vertical: boolean, ink: Ink): boolean =>
  Array.from({ length: 9 }, (_, i) => i - 4).some((d) => ink(pixelAt(shot, vertical ? x + d : x, vertical ? y : y + d)));

/**
 * Share of positions along the middle 80% of each side, every 4px, that have ink across
 * the border centre. A 9-slice that does not stretch leaves gaps here.
 */
const sideCoverage = (shot: Screenshot, rect: Rect, width: number, ink: Ink): Readonly<Record<string, number>> => {
  const along = (length: number): ReadonlyArray<number> =>
    Array.from({ length: Math.floor((length * 0.8) / 4) + 1 }, (_, i) => length * 0.1 + i * 4);
  const half = width / 2;
  const share = (hits: ReadonlyArray<boolean>): number => hits.filter(Boolean).length / hits.length;
  return {
    top: share(along(rect.width).map((dx) => inkAcross(shot, rect.x + dx, rect.y + half, false, ink))),
    bottom: share(along(rect.width).map((dx) => inkAcross(shot, rect.x + dx, rect.y + rect.height - half, false, ink))),
    left: share(along(rect.height).map((dy) => inkAcross(shot, rect.x + half, rect.y + dy, true, ink))),
    right: share(along(rect.height).map((dy) => inkAcross(shot, rect.x + rect.width - half, rect.y + dy, true, ink))),
  };
};

/** Number of pixels in the rect (grown by 6px for the outset) that differ between two shots. */
const changedPixels = (a: Screenshot, b: Screenshot, rect: Rect): number => {
  const xs = Array.from({ length: Math.floor(rect.width) + 12 }, (_, i) => Math.floor(rect.x) - 6 + i);
  const ys = Array.from({ length: Math.floor(rect.height) + 12 }, (_, i) => Math.floor(rect.y) - 6 + i);
  return ys.reduce(
    (count, y) => count + xs.filter((x) => pixelAt(a, x, y).some((v, i) => Math.abs(v - (pixelAt(b, x, y)[i] ?? 0)) > 8)).length,
    0,
  );
};

const shoot = async (p: Page, css: string): Promise<Screenshot> => {
  await render(p, page.html, css);
  await p.mouse.move(0, 0);
  return screenshot(p);
};

test.describe('M1 borders are drawn where the border is', () => {
  test('every example element', async ({ page: p }) => {
    const original = await shoot(p, page.css);
    const transformed = await transform(page.css, {}, page.cssPath);
    const drawn = await shoot(p, transformed);

    for (const { id, width } of ELEMENTS) {
      const rect = await rectOf(p, `#${id}`);
      // Replaced by a drawing (a later `border` shorthand must not have reset it).
      expect(changedPixels(original, drawn, rect), `${id}: drawing differs from the plain border`).toBeGreaterThan(40);
      // Continuous along each side.
      for (const [side, share] of Object.entries(sideCoverage(drawn, rect, width, red))) {
        expect(share, `${id} ${side}: ink along the side`).toBeGreaterThanOrEqual(0.9);
      }
      // No fill inside: the centre has no border-coloured ink (text there is dark, not red).
      expect(red(pixelAt(drawn, rect.x + rect.width / 2, rect.y + rect.height / 2)), `${id}: centre has no ink`).toBe(false);
    }
  });

  test('rounded corners curve and sharp corners do not', async ({ page: p }) => {
    await render(p, page.html, await transform(page.css, {}, page.cssPath));
    const shot = await screenshot(p);
    for (const id of ['round-1', 'round-2', 'round-4']) {
      const rect = await rectOf(p, `#${id}`);
      expect(white(pixelAt(shot, rect.x + 1, rect.y + 1)), `${id}: corner is outside the curve`).toBe(true);
      expect(white(pixelAt(shot, rect.x + rect.width - 2, rect.y + rect.height - 2)), `${id}: opposite corner`).toBe(true);
    }
    for (const { id, width } of ELEMENTS.filter((e) => e.id.startsWith('sharp'))) {
      const rect = await rectOf(p, `#${id}`);
      const near = Array.from({ length: 5 }, (_, i) => i - 2).flatMap((dx) =>
        Array.from({ length: 5 }, (_, j) => j - 2).map((dy) => pixelAt(shot, rect.x + width / 2 + dx, rect.y + width / 2 + dy)),
      );
      expect(near.some(red), `${id}: ink at the sharp corner`).toBe(true);
    }
  });

  test('a complete :hover rule switches to its own drawing', async ({ page: p }) => {
    const hovered = async (css: string): Promise<readonly [Screenshot, Rect]> => {
      await render(p, page.html, css);
      const rect = await rectOf(p, '#btn');
      await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return [await screenshot(p), rect];
    };
    const [original] = await hovered(page.css);
    const [shot, rect] = await hovered(await transform(page.css, {}, page.cssPath));
    expect(changedPixels(original, shot, rect), 'btn:hover is a drawing, not the plain blue border').toBeGreaterThan(40);
    for (const [side, share] of Object.entries(sideCoverage(shot, rect, 2, blue))) {
      expect(share, `btn:hover ${side}`).toBeGreaterThanOrEqual(0.9);
    }
  });
});

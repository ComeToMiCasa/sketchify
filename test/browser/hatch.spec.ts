import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { SAME, difference } from './lib/ink';
import { type Rect, type Rgb, type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M6b example page (test/pages/hatch): a repeated hatch tile as the
// background. Hatch blue #3b82f6 (dark amber #f59e0b), hover green #16a34a.

const page = loadPage('hatch');

type Ink = (px: Rgb) => boolean;
const blue: Ink = ([r, g, b]) => b - r > 60 && b - g > 30;
const green: Ink = ([r, g, b]) => g - r > 40 && g - b > 40;
const amber: Ink = ([r, g, b]) => r - b > 100 && g - b > 50;

const shoot = async (p: Page, css: string, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, css);
  await p.mouse.move(0, 0);
  return screenshot(p);
};

const transformed = (): Promise<string> => transform(page.css, {}, page.cssPath);

/** Every pixel of the rect shrunk by `inset`. */
const pixelsIn = (shot: Screenshot, rect: Rect, inset: number): ReadonlyArray<readonly [number, number, Rgb]> => {
  const x0 = Math.ceil(rect.x + inset);
  const y0 = Math.ceil(rect.y + inset);
  const w = Math.floor(rect.width - 2 * inset);
  const h = Math.floor(rect.height - 2 * inset);
  return Array.from({ length: w * h }, (_, i) => [x0 + (i % w), y0 + Math.floor(i / w)] as const).map(([x, y]) => [x, y, pixelAt(shot, x, y)] as const);
};

const share = (pixels: ReadonlyArray<readonly [number, number, Rgb]>, ink: Ink): number => pixels.filter(([, , px]) => ink(px)).length / pixels.length;

const maskIn = (shot: Screenshot, rect: Rect, ink: Ink): ReadonlySet<string> =>
  new Set(pixelsIn(shot, rect, 4).filter(([, , px]) => ink(px)).map(([x, y]) => `${Math.round(x - rect.x)},${Math.round(y - rect.y)}`));

test.describe('M6b hatch fill', () => {
  test('the inside is hatched: strokes and gaps, no solid background', async ({ page: p }) => {
    const original = await shoot(p, page.css);
    const shot = await shoot(p, await transformed());
    for (const id of ['card1', 'bare', 'big', 'line']) {
      const rect = await rectOf(p, `#${id}`);
      expect(share(pixelsIn(original, rect, 4), blue), `${id}: solid in the original`).toBeGreaterThan(0.95);
      const s = share(pixelsIn(shot, rect, 4), blue);
      expect(s, `${id}: hatch ink share`).toBeGreaterThan(0.2);
      expect(s, `${id}: hatch ink share`).toBeLessThan(0.7);
    }
  });

  test('no seams: every column and row of a large area has about the same amount of ink', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const rect = await rectOf(p, '#big');
    const pixels = pixelsIn(shot, rect, 3);
    const xs = [...new Set(pixels.map(([x]) => x))];
    const ys = [...new Set(pixels.map(([, y]) => y))];
    const byColumn = xs.map((x) => share(pixels.filter(([px]) => px === x), blue));
    const byRow = ys.map((y) => share(pixels.filter(([, py]) => py === y), blue));
    const mean = (list: ReadonlyArray<number>): number => list.reduce((a, b) => a + b, 0) / list.length;
    for (const [name, list] of [['column', byColumn], ['row', byRow]] as const) {
      const m = mean(list);
      const worst = Math.max(...list.map((v) => Math.abs(v - m)));
      expect(worst, `${name} ink differs from the mean ${m.toFixed(2)} by at most`).toBeLessThan(0.12);
    }
  });

  test('the hatch stays inside the padding box', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    for (const id of ['card1', 'big']) {
      const rect = await rectOf(p, `#${id}`);
      // Outside the element, and on the border itself.
      const ring = [
        ...Array.from({ length: 20 }, (_, i) => [rect.x + (rect.width * (i + 0.5)) / 20, rect.y - 3] as const),
        ...Array.from({ length: 20 }, (_, i) => [rect.x - 3, rect.y + (rect.height * (i + 0.5)) / 20] as const),
        ...Array.from({ length: 20 }, (_, i) => [rect.x + (rect.width * (i + 0.5)) / 20, rect.y + rect.height + 2] as const),
      ];
      expect(ring.filter(([x, y]) => blue(pixelAt(shot, x, y))), `${id}: no hatch outside`).toEqual([]);
    }
    // Outside the rounded corner of the card.
    const card = await rectOf(p, '#card1');
    expect(blue(pixelAt(shot, card.x + 3, card.y + 3)), 'no hatch outside the rounded corner').toBe(false);
  });

  test('neighbours start the tile at different places', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const a = maskIn(shot, await rectOf(p, '#card1'), blue);
    const b = maskIn(shot, await rectOf(p, '#card2'), blue);
    expect(difference(a, b)).toBeGreaterThan(SAME);
  });

  test('hover and dark mode change the hatch colour', async ({ page: p }) => {
    await shoot(p, await transformed());
    const card = await rectOf(p, '#card1');
    await p.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    const hovered = await screenshot(p);
    expect(share(pixelsIn(hovered, card, 4), green), 'green hatch on hover').toBeGreaterThan(0.2);
    expect(share(pixelsIn(hovered, card, 4), blue), 'no blue on hover').toBe(0);

    const dark = await shoot(p, await transformed(), 'dark');
    const big = await rectOf(p, '#big');
    expect(share(pixelsIn(dark, big, 4), amber), 'amber hatch in dark mode').toBeGreaterThan(0.2);
    expect(share(pixelsIn(dark, big, 4), blue), 'no blue in dark mode').toBe(0);
  });
});

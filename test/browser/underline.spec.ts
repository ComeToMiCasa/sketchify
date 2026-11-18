import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Rect, type Rgb, type Screenshot, pixelAt, screenshot, moveAndSettle } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M6d example page (test/pages/underline): underlines drawn as a border image
// (the one-sided line's drawing) just below each line of an inline element. Link blue #2563eb (dark: amber #f59e0b), hover green
// #16a34a, danger red #dc2626.

const page = loadPage('underline');

type Ink = (px: Rgb) => boolean;
const blue: Ink = ([r, g, b]) => b - r > 60 && b - g > 30;
const green: Ink = ([r, g, b]) => g - r > 40 && g - b > 40;
const red: Ink = ([r, g, b]) => r - g > 80 && r - b > 80;
const amber: Ink = ([r, g, b]) => r - b > 100 && g - b > 50;

const shoot = async (p: Page, css: string, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, css);
  await moveAndSettle(p, 0, 0);
  return screenshot(p);
};

const transformed = (): Promise<string> => transform(page.css, {}, page.cssPath);

/** The line boxes of an inline element (one per line it wraps onto). */
const fragments = (p: Page, id: string): Promise<ReadonlyArray<Rect>> =>
  p.$eval(`#${id}`, (el) => Array.from(el.getClientRects()).map((r) => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height })));

/**
 * Share of a fragment's columns with ink in the 4px just below it, where the underline is drawn.
 * Letters stay inside the line box, so only an underline fills these columns.
 */
const underlined = (shot: Screenshot, rect: Rect, ink: Ink): number => {
  const xs = Array.from({ length: Math.floor(rect.width) - 2 }, (_, i) => Math.ceil(rect.x) + 1 + i);
  const bottom = Math.floor(rect.y + rect.height);
  return xs.filter((x) => Array.from({ length: 4 }, (_, i) => pixelAt(shot, x, bottom - 1 + i)).some(ink)).length / xs.length;
};

const styleOf = (p: Page, id: string): Promise<{ readonly line: string; readonly image: string }> =>
  p.$eval(`#${id}`, (el) => {
    const s = getComputedStyle(el);
    return { line: s.textDecorationLine, image: s.borderImageSource.startsWith('url(') ? 'url' : s.borderImageSource };
  });

test.describe('M6d underlines', () => {
  test('every line of a wrapped link is underlined, by the drawing and not the browser', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const lines = await fragments(p, 'long');
    expect(lines.length, 'the link wraps').toBeGreaterThanOrEqual(2);
    lines.forEach((rect, i) => expect(underlined(shot, rect, blue), `line ${i + 1}`).toBeGreaterThan(0.85));
    for (const id of ['long', 'short1', 'short2', 'quiet', 'danger', 'badge']) {
      expect(await styleOf(p, id), id).toEqual({ line: 'none', image: 'url' });
    }
  });

  test('colours: red for danger, and the badge keeps its background colour', async ({ page: p }) => {
    const shot = await shoot(p, await transformed());
    const [danger] = await fragments(p, 'danger');
    expect(danger && underlined(shot, danger, red)).toBeGreaterThan(0.85);
    const [badge] = await fragments(p, 'badge');
    if (!badge) throw new Error('#badge missing');
    expect(underlined(shot, badge, blue)).toBeGreaterThan(0.85);
    const [r, g, b] = pixelAt(shot, badge.x + 2, badge.y + 2);
    expect(r > 240 && g > 230 && b > 180 && b < 215, `badge background ${r},${g},${b}`).toBe(true);
  });

  test('hover: another colour, or no underline', async ({ page: p }) => {
    await shoot(p, await transformed());
    const [home] = await fragments(p, 'short1');
    if (!home) throw new Error('#short1 missing');
    await moveAndSettle(p, home.x + home.width / 2, home.y + home.height / 2);
    expect(underlined(await screenshot(p), home, green), 'green on hover').toBeGreaterThan(0.85);
    // No underline on hover: the same as the original CSS hovered.
    const hoverQuiet = async (css: string): Promise<number> => {
      await shoot(p, css);
      const [quiet] = await fragments(p, 'quiet');
      if (!quiet) throw new Error('#quiet missing');
      await moveAndSettle(p, quiet.x + quiet.width / 2, quiet.y + quiet.height / 2);
      return underlined(await screenshot(p), quiet, green);
    };
    const original = await hoverQuiet(page.css);
    expect(Math.abs((await hoverQuiet(await transformed())) - original), 'no underline on hover').toBeLessThan(0.05);
    expect(await styleOf(p, 'quiet')).toEqual({ line: 'none', image: 'none' });
  });

  test('dark mode draws in the dark theme colour', async ({ page: p }) => {
    const shot = await shoot(p, await transformed(), 'dark');
    for (const rect of await fragments(p, 'long')) expect(underlined(shot, rect, amber)).toBeGreaterThan(0.85);
  });

  test('the browser underline stays where the drawing cannot follow', async ({ page: p }) => {
    await shoot(p, await transformed());
    for (const id of ['inherited', 'note', 'dotted', 'plain']) {
      expect(await styleOf(p, id), id).toEqual({ line: 'underline', image: 'none' });
    }
  });
});

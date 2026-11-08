import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Ink, SAME, amber, blue, colored, difference, green, inkMask, red } from './lib/ink';
import { type Screenshot, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M3 example page (test/pages/theme): border colours from variables, and a
// dark-mode theme in a media query. Light: red, hover blue. Dark: green, hover amber.

const page = loadPage('theme');

type Scheme = 'light' | 'dark';

const shoot = async (p: Page, scheme: Scheme): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, await transform(page.css, {}, page.cssPath));
  await p.mouse.move(0, 0);
  return screenshot(p);
};

const THEMED = ['root-var', 'chain', 'fallback', 'wide', 'pseudo', 'hb1'];

const inkOf = async (p: Page, shot: Screenshot, id: string, ink: Ink): Promise<ReadonlySet<string>> => inkMask(shot, await rectOf(p, `#${id}`), ink);

test.describe('M3 colours from variables', () => {
  test('light mode draws in the :root colour', async ({ page: p }) => {
    const shot = await shoot(p, 'light');
    for (const id of [...THEMED, 'own']) {
      expect((await inkOf(p, shot, id, red)).size, `${id}: red ink`).toBeGreaterThan(200);
      expect((await inkOf(p, shot, id, green)).size, `${id}: no dark-mode ink`).toBe(0);
    }
  });

  test('dark mode draws in the media query colour, with the same shapes', async ({ page: p }) => {
    const light = await shoot(p, 'light');
    const lightShapes = await Promise.all(THEMED.map((id) => inkOf(p, light, id, colored)));
    const dark = await shoot(p, 'dark');
    for (const [i, id] of THEMED.entries()) {
      const mask = await inkOf(p, dark, id, green);
      expect(mask.size, `${id}: green ink`).toBeGreaterThan(200);
      expect((await inkOf(p, dark, id, red)).size, `${id}: no light-mode ink left`).toBe(0);
      const shape = await inkOf(p, dark, id, colored);
      expect(difference(shape, lightShapes[i] ?? new Set()), `${id}: same shape as in light mode`).toBeLessThan(SAME);
    }
  });

  test("the rule's own variable wins over the theme", async ({ page: p }) => {
    const dark = await shoot(p, 'dark');
    expect((await inkOf(p, dark, 'own', red)).size).toBeGreaterThan(200);
    expect((await inkOf(p, dark, 'own', green)).size).toBe(0);
  });

  test('hover uses the theme accent in both modes', async ({ page: p }) => {
    for (const [scheme, accent, base] of [['light', blue, red], ['dark', amber, green]] as const) {
      await shoot(p, scheme);
      const rect = await rectOf(p, '#hb2');
      await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const shot = await screenshot(p);
      expect(inkMask(shot, rect, accent).size, `${scheme}: accent ink on hover`).toBeGreaterThan(200);
      expect(inkMask(shot, rect, base).size, `${scheme}: no base ink on hover`).toBe(0);
    }
  });
});

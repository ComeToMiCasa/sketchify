import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { SAME, difference, inkMask } from './lib/ink';
import { type Rect, type Rgb, type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// `@sketchify base` (M7a) on test/pages/base: unstyled form controls and hr. Ink #1d2433, accent
// #2563eb; in dark mode (option) ink #e5e7eb, accent #f59e0b. The page's own field is red.

const page = loadPage('base');
const DARK = { base: { dark: { ink: '#e5e7eb', accent: '#f59e0b' } } };

type Ink = (px: Rgb) => boolean;
const dark: Ink = ([r, g, b]) => r < 120 && g < 120 && b < 140;
const blue: Ink = ([r, g, b]) => b - r > 60 && b - g > 30;
const red: Ink = ([r, g, b]) => r - g > 80 && r - b > 80;
const amber: Ink = ([r, g, b]) => r - b > 100 && g - b > 50;

const shoot = async (p: Page, css: string, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, css);
  await p.mouse.move(0, 0);
  return screenshot(p);
};

const count = (shot: Screenshot, rect: Rect, ink: Ink, inset = 0): number => {
  const w = Math.floor(rect.width - 2 * inset);
  const h = Math.floor(rect.height - 2 * inset);
  return Array.from({ length: w * h }, (_, i) => pixelAt(shot, rect.x + inset + (i % w), rect.y + inset + Math.floor(i / w))).filter(ink).length;
};

const IDS = ['text', 'email', 'memo', 'pick', 'check1', 'check2', 'radio1', 'radio2', 'rule', 'own'];

test.describe('M7a @sketchify base', () => {
  test('sizes stay close to the browser defaults (within 4px)', async ({ page: p }) => {
    const sizes = async (css: string) => {
      await shoot(p, css);
      return Promise.all(IDS.map(async (id) => [id, await rectOf(p, `#${id}`)] as const));
    };
    const original = await sizes(page.css);
    const based = await sizes(await transform(page.css, {}, page.cssPath));
    original.forEach(([id, before], i) => {
      const after = based[i]?.[1];
      expect(Math.abs((after?.width ?? 0) - before.width), `${id} width ${before.width} → ${after?.width}`).toBeLessThanOrEqual(4);
      expect(Math.abs((after?.height ?? 0) - before.height), `${id} height ${before.height} → ${after?.height}`).toBeLessThanOrEqual(4);
    });
  });

  test('everything is drawn: outlines, the arrow, boxes and circles, ticks and dots in the accent', async ({ page: p }) => {
    const shot = await shoot(p, await transform(page.css, {}, page.cssPath));
    const sources = await p.evaluate(() =>
      Object.fromEntries(
        ['text', 'email', 'memo', 'pick', 'rule', 'check1', 'radio1'].map((id) => {
          const s = getComputedStyle(document.getElementById(id) as HTMLElement);
          return [id, `${s.borderImageSource.slice(0, 4)} ${s.backgroundImage.slice(0, 4)} ${s.appearance}`];
        }),
      ),
    );
    for (const id of ['text', 'email', 'memo', 'rule']) expect(sources[id]?.startsWith('url('), id).toBe(true);
    expect(sources['pick']).toBe('url( url( none');
    expect(sources['check1']).toBe('none url( none');
    expect(sources['radio1']).toBe('none url( none');
    // The select arrow, in the right end of the select.
    const pick = await rectOf(p, '#pick');
    expect(count(shot, { x: pick.x + pick.width - 24, y: pick.y + 4, width: 18, height: pick.height - 8 }, dark)).toBeGreaterThan(8);
    // Boxes and circles in ink; ticks and dots in the accent, only when checked.
    for (const id of ['check1', 'check2', 'radio1', 'radio2']) expect(count(shot, await rectOf(p, `#${id}`), dark), `${id} outline`).toBeGreaterThan(10);
    expect(count(shot, await rectOf(p, '#check1'), blue), 'tick').toBeGreaterThan(5);
    expect(count(shot, await rectOf(p, '#radio1'), blue), 'dot').toBeGreaterThan(5);
    expect(count(shot, await rectOf(p, '#check2'), blue)).toBe(0);
    expect(count(shot, await rectOf(p, '#radio2'), blue)).toBe(0);
  });

  test('neighbouring checkboxes look different', async ({ page: p }) => {
    const shot = await shoot(p, await transform(page.css, {}, page.cssPath));
    expect(difference(inkMask(shot, await rectOf(p, '#check2'), dark), inkMask(shot, await rectOf(p, '#check3'), dark))).toBeGreaterThan(SAME);
  });

  test('focus: a drawn ring in the accent replaces the browser outline', async ({ page: p }) => {
    const before = await shoot(p, await transform(page.css, {}, page.cssPath));
    for (let i = 0; i < 10 && (await p.evaluate(() => document.activeElement?.id ?? '')) !== 'text'; i += 1) await p.keyboard.press('Tab');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('text');
    expect(await p.$eval('#text', (el) => getComputedStyle(el).outlineStyle)).toBe('none');
    const text = await rectOf(p, '#text');
    // The ring lies 2–6px outside the field: nothing there before focus, accent ink after.
    const ring = { x: text.x + 10, y: text.y - 6, width: text.width - 20, height: 4 };
    expect(count(before, ring, blue), 'no ring before focus').toBe(0);
    expect(count(await screenshot(p), ring, blue), 'accent ring').toBeGreaterThan(20);
    // A mouse click focuses a text field as visibly.
    await p.mouse.click(1, 1);
    await p.click('#memo');
    expect(await p.$eval('#memo', (el) => getComputedStyle(el).outlineStyle)).toBe('none');
    const memo = await rectOf(p, '#memo');
    expect(count(await screenshot(p), { x: memo.x + 10, y: memo.y - 6, width: memo.width - 20, height: 4 }, blue), 'ring on click').toBeGreaterThan(20);
    // The checkbox shows the focus ring too. Safari's Tab skips checkboxes (a macOS setting), so
    // there it is focused from script right after a key press, which still counts as keyboard focus.
    for (let i = 0; i < 10 && (await p.evaluate(() => document.activeElement?.id ?? '')) !== 'check1'; i += 1) await p.keyboard.press('Tab');
    if ((await p.evaluate(() => document.activeElement?.id)) !== 'check1') await p.focus('#check1');
    expect(await p.evaluate(() => [document.activeElement?.id, document.activeElement?.matches(':focus-visible')])).toEqual(['check1', true]);
    expect(await p.$eval('#check1', (el) => getComputedStyle(el).outlineStyle)).toBe('none');
    const check = await rectOf(p, '#check1');
    expect(count(await screenshot(p), { x: check.x - 5, y: check.y - 5, width: check.width + 10, height: 4 }, blue), 'checkbox ring').toBeGreaterThan(4);
  });

  test("a field the page draws itself keeps the browser's focus outline", async ({ page: p }) => {
    await shoot(p, await transform(page.css, {}, page.cssPath));
    await p.click('#own');
    expect(await p.$eval('#own', (el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test("the page's own style wins over the base", async ({ page: p }) => {
    const shot = await shoot(p, await transform(page.css, {}, page.cssPath));
    const own = await rectOf(p, '#own');
    expect(count(shot, { x: own.x - 3, y: own.y - 3, width: own.width + 6, height: 8 }, red)).toBeGreaterThan(50);
    expect(count(shot, { x: own.x - 3, y: own.y - 3, width: own.width + 6, height: 8 }, dark)).toBeLessThan(5);
  });

  test('dark colours from the option', async ({ page: p }) => {
    const shot = await shoot(p, await transform(page.css, DARK, page.cssPath), 'dark');
    expect(count(shot, await rectOf(p, '#check1'), amber), 'amber tick').toBeGreaterThan(5);
    expect(count(shot, await rectOf(p, '#check1'), blue), 'no blue').toBe(0);
  });
});

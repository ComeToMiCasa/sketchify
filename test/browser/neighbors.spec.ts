import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Ink, SAME, blue, difference, inkMask, red } from './lib/ink';
import { type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M2 example page (test/pages/neighbors): the same border on many
// elements must not look copied. Borders are red (#e5484d); the hover colour is blue (#3b82f6).

const page = loadPage('neighbors');

const shoot = async (p: Page): Promise<Screenshot> => {
  await render(p, page.html, await transform(page.css, {}, page.cssPath));
  await p.mouse.move(0, 0);
  return screenshot(p);
};

const masks = async (p: Page, shot: Screenshot, ids: ReadonlyArray<string>, ink: Ink): Promise<ReadonlyArray<ReadonlySet<string>>> =>
  Promise.all(ids.map(async (id) => inkMask(shot, await rectOf(p, `#${id}`), ink)));

const CARDS = ['11', '12', '13', '21', '22', '23', '31', '32', '33'].map((n) => `c${n}`);
const ITEMS = Array.from({ length: 12 }, (_, i) => `i${i + 1}`);

test.describe('M2 neighbouring elements get different drawings', () => {
  test('identical drawings measure as the same (control)', async ({ page: p }) => {
    const shot = await shoot(p);
    const [card] = await masks(p, shot, ['c11'], red);
    expect(card?.size ?? 0, 'the card has ink').toBeGreaterThan(200);
    expect(difference(card ?? new Set(), card ?? new Set())).toBe(0);
  });

  test('siblings differ', async ({ page: p }) => {
    const shot = await shoot(p);
    const cards = await masks(p, shot, CARDS, red);
    const items = await masks(p, shot, ITEMS, red);
    const pairs = (list: ReadonlyArray<ReadonlySet<string>>, ids: ReadonlyArray<string>, step: number) =>
      list.slice(0, -1).flatMap((mask, i) => ((i + 1) % step === 0 ? [] : [[ids[i], ids[i + 1], mask, list[i + 1]] as const]));
    for (const [a, b, ma, mb] of [...pairs(cards, CARDS, 3), ...pairs(items, ITEMS, ITEMS.length)]) {
      expect(difference(ma, mb ?? new Set()), `${a} and ${b}`).toBeGreaterThan(SAME);
    }
  });

  test('look-alikes in the same place under other parents differ', async ({ page: p }) => {
    const shot = await shoot(p);
    for (const own of ['1', '2', '3']) {
      const ids = ['1', '2', '3'].map((group) => `c${group}${own}`);
      const [a, b, c] = await masks(p, shot, ids, red);
      expect(difference(a ?? new Set(), b ?? new Set()), `${ids[0]} and ${ids[1]}`).toBeGreaterThan(SAME);
      expect(difference(b ?? new Set(), c ?? new Set()), `${ids[1]} and ${ids[2]}`).toBeGreaterThan(SAME);
      expect(difference(a ?? new Set(), c ?? new Set()), `${ids[0]} and ${ids[2]}`).toBeGreaterThan(SAME);
    }
  });

  test('many different drawings appear, not just a few', async ({ page: p }) => {
    const shot = await shoot(p);
    const items = await masks(p, shot, ITEMS, red);
    // Group drawings that measure as the same; twelve siblings cycle through seeds and flips.
    const kinds = items.reduce<ReadonlyArray<ReadonlySet<string>>>(
      (seen, mask) => (seen.some((other) => difference(other, mask) < SAME) ? seen : [...seen, mask]),
      [],
    );
    expect(kinds.length).toBeGreaterThanOrEqual(6);
  });

  test('a complete :hover rule keeps the shape and changes the colour', async ({ page: p }) => {
    await render(p, page.html, await transform(page.css, {}, page.cssPath));
    for (const id of ['hb1', 'hb2', 'hb3']) {
      const rect = await rectOf(p, `#${id}`);
      await p.mouse.move(0, 0);
      const before = inkMask(await screenshot(p), rect, red);
      await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const shot = await screenshot(p);
      const after = inkMask(shot, rect, blue);
      expect(inkMask(shot, rect, red).size, `${id}: no red left on hover`).toBe(0);
      expect(after.size, `${id}: blue ink on hover`).toBeGreaterThan(200);
      expect(difference(before, after), `${id}: same shape`).toBeLessThan(SAME);
    }
  });

  test('a pseudo-element border is drawn', async ({ page: p }) => {
    const shot = await shoot(p);
    const rect = await rectOf(p, '#pseudo');
    const mask = inkMask(shot, rect, red);
    expect(mask.size, 'ink around the ::before box').toBeGreaterThan(300);
    expect(red(pixelAt(shot, rect.x + rect.width / 2, rect.y + rect.height / 2)), 'centre has no ink').toBe(false);
  });
});

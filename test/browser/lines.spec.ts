import { expect, test, type Page } from '@playwright/test';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Ink, SAME, blue, difference, green, red } from './lib/ink';
import { type Rect, type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Reads pixels of the M5 example page (test/pages/lines): one-sided lines must reach both ends
// of their element, stay continuous, and leave the other sides empty. Light: red, list hover
// blue. Dark: green.

const page = loadPage('lines');

type Side = 'top' | 'right' | 'bottom' | 'left';
type Line = {
  readonly id: string;
  readonly side: Side;
  readonly width: number;
  /** Another line starts within 8px of its end (the tabs), so ink just past the end may be the neighbour's. */
  readonly crowded?: boolean;
};

const LINES: ReadonlyArray<Line> = [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `li${i + 1}`, side: 'bottom' as const, width: 1 })),
  { id: 'hr', side: 'top', width: 2 },
  { id: 'quote', side: 'left', width: 4 },
  { id: 'tab1', side: 'bottom', width: 2, crowded: true },
  { id: 'tab2', side: 'bottom', width: 2, crowded: true },
  { id: 'tab3', side: 'bottom', width: 2, crowded: true },
];

const shoot = async (p: Page, scheme: 'light' | 'dark' = 'light'): Promise<Screenshot> => {
  await p.emulateMedia({ colorScheme: scheme });
  await render(p, page.html, await transform(page.css, {}, page.cssPath));
  await p.mouse.move(0, 0);
  return screenshot(p);
};

const vertical = (side: Side): boolean => side === 'left' || side === 'right';

/** The line's centre across, and its start and end along, in page coordinates. */
const axis = (rect: Rect, line: Line): { readonly centre: number; readonly start: number; readonly end: number } => {
  const half = line.width / 2;
  switch (line.side) {
    case 'top':
      return { centre: rect.y + half, start: rect.x, end: rect.x + rect.width };
    case 'bottom':
      return { centre: rect.y + rect.height - half, start: rect.x, end: rect.x + rect.width };
    case 'left':
      return { centre: rect.x + half, start: rect.y, end: rect.y + rect.height };
    case 'right':
      return { centre: rect.x + rect.width - half, start: rect.y, end: rect.y + rect.height };
    default: {
      const unreachable: never = line.side;
      return unreachable;
    }
  }
};

/** Whether there is ink within ±5px across the line at a position along it. */
const inkAt = (shot: Screenshot, line: Line, centre: number, along: number, ink: Ink): boolean =>
  Array.from({ length: 11 }, (_, i) => i - 5).some((d) => ink(vertical(line.side) ? pixelAt(shot, centre + d, along) : pixelAt(shot, along, centre + d)));

const inkNear = (shot: Screenshot, line: Line, centre: number, from: number, to: number, ink: Ink): boolean =>
  Array.from({ length: Math.max(1, Math.round(to - from) + 1) }, (_, i) => from + i).some((along) => inkAt(shot, line, centre, along, ink));

/** Ink pixels in the band around the line, relative to its start. */
const bandMask = (shot: Screenshot, rect: Rect, line: Line, ink: Ink): ReadonlySet<string> => {
  const { centre, start, end } = axis(rect, line);
  const cells = Array.from({ length: Math.round(end - start) + 8 }, (_, i) => i - 4).flatMap((a) =>
    Array.from({ length: 13 }, (_, j) => j - 6).map((d) => [a, d] as const),
  );
  return new Set(
    cells
      .filter(([a, d]) => ink(vertical(line.side) ? pixelAt(shot, centre + d, start + a) : pixelAt(shot, start + a, centre + d)))
      .map(([a, d]) => `${a},${d}`),
  );
};

test.describe('M5 one-sided lines', () => {
  test('every line reaches both ends of its element and no further', async ({ page: p }) => {
    const shot = await shoot(p);
    for (const line of LINES) {
      const rect = await rectOf(p, `#${line.id}`);
      const { centre, start, end } = axis(rect, line);
      expect(inkNear(shot, line, centre, start, start + 3, red), `${line.id}: ink at the start`).toBe(true);
      expect(inkNear(shot, line, centre, end - 3, end, red), `${line.id}: ink at the end`).toBe(true);
      if (!line.crowded) {
        expect(inkNear(shot, line, centre, start - 12, start - 5, red), `${line.id}: nothing before the start`).toBe(false);
        expect(inkNear(shot, line, centre, end + 5, end + 12, red), `${line.id}: nothing after the end`).toBe(false);
      }
    }
  });

  test('every line is continuous', async ({ page: p }) => {
    const shot = await shoot(p);
    for (const line of LINES) {
      const rect = await rectOf(p, `#${line.id}`);
      const { centre, start, end } = axis(rect, line);
      const length = end - start;
      const positions = Array.from({ length: Math.floor((length * 0.9) / 4) + 1 }, (_, i) => start + length * 0.05 + i * 4);
      const share = positions.filter((along) => inkAt(shot, line, centre, along, red)).length / positions.length;
      expect(share, `${line.id}: ink along the line`).toBe(1);
    }
  });

  test('the other sides stay empty', async ({ page: p }) => {
    const shot = await shoot(p);
    for (const id of ['quote', 'tab2']) {
      const rect = await rectOf(p, `#${id}`);
      const midX = rect.x + rect.width / 2;
      const midY = rect.y + rect.height / 2;
      const probes: ReadonlyArray<readonly [string, number, number]> = [
        ['top', midX, rect.y + 1],
        ['right', rect.x + rect.width - 1, midY],
        ...(id === 'tab2' ? [['left', rect.x + 1, midY] as const] : [['bottom', midX, rect.y + rect.height - 1] as const]),
      ];
      for (const [side, x, y] of probes) {
        expect(red(pixelAt(shot, x, y)), `${id} ${side}: no ink`).toBe(false);
      }
    }
  });

  test('neighbouring dividers differ (M2 variants)', async ({ page: p }) => {
    const shot = await shoot(p);
    const lines = LINES.filter((l) => l.id.startsWith('li'));
    const masks = await Promise.all(lines.map(async (line) => bandMask(shot, await rectOf(p, `#${line.id}`), line, red)));
    masks.slice(1).forEach((mask, i) => {
      expect(difference(mask, masks[i] ?? new Set()), `${lines[i]?.id} and ${lines[i + 1]?.id}`).toBeGreaterThan(SAME);
    });
  });

  test('a wrapping inline link has its line under every line of text', async ({ page: p }) => {
    const shot = await shoot(p);
    const fragments = await p.locator('#link').evaluate((el) =>
      Array.from(el.getClientRects()).map((r) => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height })),
    );
    expect(fragments.length).toBeGreaterThanOrEqual(2);
    for (const [i, rect] of fragments.entries()) {
      const line: Line = { id: `link line ${i + 1}`, side: 'bottom', width: 2 };
      const { centre, start, end } = axis(rect, line);
      const positions = Array.from({ length: Math.floor((end - start - 8) / 4) + 1 }, (_, k) => start + 4 + k * 4);
      const share = positions.filter((along) => inkAt(shot, line, centre, along, red)).length / positions.length;
      expect(share, `${line.id}: ink under the text`).toBeGreaterThanOrEqual(0.95);
    }
  });

  test('hover and dark mode change the colour, not the shape', async ({ page: p }) => {
    const light = await shoot(p);
    const li = LINES[4];
    if (!li) throw new Error('no list item');
    const rect = await rectOf(p, `#${li.id}`);
    const lightMask = bandMask(light, rect, li, red);

    await p.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const hovered = await screenshot(p);
    expect(bandMask(hovered, rect, li, red).size, 'no red on hover').toBe(0);
    expect(difference(bandMask(hovered, rect, li, blue), lightMask), 'same shape on hover').toBeLessThan(SAME);

    const dark = await shoot(p, 'dark');
    for (const line of LINES) {
      const r = await rectOf(p, `#${line.id}`);
      expect(bandMask(dark, r, line, green).size, `${line.id}: green in dark mode`).toBeGreaterThan(20);
      expect(bandMask(dark, r, line, red).size, `${line.id}: no red in dark mode`).toBe(0);
    }
  });
});

// Negative control: the spec's warning. Stretching the whole drawing (no fixed ends) scales its
// end margins with the element, so long dividers stop short of both ends.
test('stretching the whole line instead of fixing its ends is caught', async ({ page: p }) => {
  const stretched = (await transform(page.css, {}, page.cssPath)).replace('0 16 11 16 / 0 16px 11px 16px', '0 0 11 0 / 0 0 11px 0');
  await render(p, page.html, stretched);
  await p.mouse.move(0, 0);
  const shot = await screenshot(p);
  const line = LINES[0];
  if (!line) throw new Error('no line');
  const { centre, start, end } = axis(await rectOf(p, `#${line.id}`), line);
  expect(inkNear(shot, line, centre, start, start + 3, red) && inkNear(shot, line, centre, end - 3, end, red)).toBe(false);
});

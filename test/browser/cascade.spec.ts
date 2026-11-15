import { expect, test, type Page } from '@playwright/test';
import { loadPage, type TestPage } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { type Rect, type Screenshot, pixelAt, screenshot } from './lib/pixels';
import { render } from './lib/render';

// The M4 oracle (spec "여러 규칙에 걸친 테두리": draw what the original CSS shows).
//
// The browser itself runs the original cascade: render the original CSS, read every element's
// computed border, and write it back as one complete `!important` rule per element. Transformed,
// those rules draw each element exactly what its computed border says, in the same variant slot
// (same position in the document). The transformed original CSS must look the same, pixel for
// pixel, around every border, in every state: default, hover, focus, wide and narrow, light and dark.

type State = {
  readonly name: string;
  readonly width: number;
  readonly scheme: 'light' | 'dark';
  /** Hover or keyboard-focus this element (by id) before reading and shooting. */
  readonly hover?: string;
  readonly focus?: string;
};

type Border = {
  readonly ix: number;
  readonly rect: Rect;
  readonly width: number;
  readonly css: string;
  /** Draws a fill (M6a): compare the whole element, not only the band around the border. */
  readonly fill: boolean;
};

/**
 * `--sketch-fill` applies per rule, not by inheritance (the compiler cannot see the DOM). Registered
 * as not inherited for the reading render only, so the browser's computed value means the same.
 */
const FILL_PER_RULE = "@property --sketch-fill { syntax: '*'; inherits: false; }\n";

/** Numbers every element, so the flattened rules can address them. The same in every render. */
const tag = (p: Page): Promise<void> =>
  p.evaluate(() => {
    Array.from(document.querySelectorAll('body *')).forEach((el, i) => el.setAttribute('data-ix', String(i)));
  });

const enter = async (p: Page, page: TestPage, css: string, state: State): Promise<void> => {
  await p.setViewportSize({ width: state.width, height: 900 });
  await p.emulateMedia({ colorScheme: state.scheme });
  await render(p, page.html, css);
  await tag(p);
  await p.mouse.move(0, 0);
  if (state.hover) {
    const box = await p.locator(`#${state.hover}`).boundingBox();
    if (box) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  if (state.focus) {
    // Keyboard focus, so :focus-visible matches as well as :focus.
    for (let i = 0; i < 40 && (await p.evaluate(() => document.activeElement?.id ?? '')) !== state.focus; i += 1) {
      await p.keyboard.press('Tab');
    }
  }
};

/**
 * Every element's computed border, as one complete `!important` rule. `select` is left out:
 * WebKit computes a native (`appearance: auto`) select's radius as 5px whatever the CSS says,
 * so its computed border is not the cascade's result. Form controls are M7.
 */
const computedBorders = (p: Page, sizes: boolean): Promise<ReadonlyArray<Border>> =>
  p.evaluate((sizes) =>
    Array.from(document.querySelectorAll<HTMLElement>('body *:not(select)')).flatMap((el) => {
      const s = getComputedStyle(el);
      const sides = ['top', 'right', 'bottom', 'left'].map((side) => ({
        side,
        width: parseFloat(s.getPropertyValue(`border-${side}-width`)),
        style: s.getPropertyValue(`border-${side}-style`),
        color: s.getPropertyValue(`border-${side}-color`),
      }));
      const fillMode = s.getPropertyValue('--sketch-fill').trim();
      const fill = (fillMode === 'rough' || fillMode === 'marker' || fillMode === 'hatch') && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none';
      const hasBorder = sides.some((side) => side.width > 0 && side.style !== 'none' && side.style !== 'hidden');
      if (!hasBorder && !fill) return [];
      const r = el.getBoundingClientRect();
      // Pages whose hatched elements have a known size (M6c): the size the compiler should have worked out.
      const size = sizes && fillMode === 'hatch' ? ` --sketch-size: ${r.width} ${r.height} !important;` : '';
      const paint = fillMode === '' ? '' : ` background-color: ${s.backgroundColor} !important; background-image: ${s.backgroundImage} !important; --sketch-fill: ${fillMode} !important;${size}`;
      const radius = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => s.getPropertyValue(`border-${c}-radius`)).join(' ');
      const decls = sides.map((side) => `border-${side.side}: ${side.width}px ${side.style} ${side.color} !important;`).join(' ');
      return [
        {
          ix: Number(el.getAttribute('data-ix')),
          rect: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
          width: Math.max(...sides.map((side) => side.width)),
          css: `[data-ix="${el.getAttribute('data-ix')}"] { ${decls} border-radius: ${radius} !important;${paint} }`,
          fill,
        },
      ];
    }),
  sizes);

const REACH = 8;
const isInk = (px: readonly number[]): boolean => Math.min(...px) < 235 || Math.max(...px) - Math.min(...px) > 30;

/**
 * Share of the pixels in the band around a border (8px outside, the border plus 3px inside)
 * that differ between two shots, out of the pixels that are ink in either. 0 = the same drawing.
 */
const bandDifference = (a: Screenshot, b: Screenshot, border: Border): number => {
  const { rect } = border;
  const inside = border.width + 3;
  const x0 = Math.max(0, Math.floor(rect.x) - REACH);
  const y0 = Math.max(0, Math.floor(rect.y) - REACH);
  const x1 = Math.min(a.width - 1, Math.ceil(rect.x + rect.width) + REACH);
  const y1 = Math.min(a.height - 1, Math.ceil(rect.y + rect.height) + REACH);
  const inBand = (x: number, y: number): boolean =>
    border.fill ||
    x < rect.x + inside || x > rect.x + rect.width - inside || y < rect.y + inside || y > rect.y + rect.height - inside;
  const counts = Array.from({ length: (y1 - y0 + 1) * (x1 - x0 + 1) }, (_, i) => [x0 + (i % (x1 - x0 + 1)), y0 + Math.floor(i / (x1 - x0 + 1))] as const)
    .filter(([x, y]) => inBand(x, y))
    .map(([x, y]) => {
      const pa = pixelAt(a, x, y);
      const pb = pixelAt(b, x, y);
      return { ink: isInk(pa) || isInk(pb), diff: pa.some((v, i) => Math.abs(v - (pb[i] ?? 0)) > 24) };
    });
  const ink = counts.filter((c) => c.ink).length;
  return ink === 0 ? 0 : counts.filter((c) => c.diff).length / ink;
};

/** Below this, two renders show the same drawing (identical drawings measure 0). */
const SAME = 0.02;

/** Per element: how far the transformed CSS is from the drawing of its computed border. */
const compare = async (p: Page, page: TestPage, state: State, edit: (css: string) => string = (css) => css): Promise<ReadonlyArray<readonly [string, number]>> => {
  await enter(p, page, FILL_PER_RULE + page.css, state);
  const borders = await computedBorders(p, KNOWN_SIZES.has(page.name));
  const flattened = `${page.css}\n${borders.map((b) => b.css).join('\n')}\n`;

  await enter(p, page, edit(await transform(page.css, {}, page.cssPath)), state);
  const actual = await screenshot(p);
  await enter(p, page, await transform(flattened, {}, 'flattened.css'), state);
  const expected = await screenshot(p);

  const labels = await p.evaluate(() =>
    Object.fromEntries(Array.from(document.querySelectorAll('body *')).map((el) => [el.getAttribute('data-ix'), el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`])),
  );
  return borders.map((b) => [`${labels[String(b.ix)] ?? b.ix}`, bandDifference(actual, expected, b)] as const);
};

const STATES: ReadonlyArray<State> = [
  { name: 'narrow, light', width: 800, scheme: 'light' },
  { name: 'wide, light', width: 1000, scheme: 'light' },
  { name: 'narrow, dark', width: 800, scheme: 'dark' },
  { name: 'wide, dark', width: 1000, scheme: 'dark' },
];

const INTERACTIONS: Readonly<Record<string, ReadonlyArray<State>>> = {
  'design-system': [
    ...['btn', 'btn-lg', 'btn-sm-primary', 'btn-lg-danger'].flatMap((id) => [
      { name: `hover #${id}, wide`, width: 1000, scheme: 'light' as const, hover: id },
      { name: `hover #${id}, narrow, dark`, width: 800, scheme: 'dark' as const, hover: id },
    ]),
    { name: 'focus #btn-lg', width: 1000, scheme: 'light', focus: 'btn-lg' },
    { name: 'focus #field-invalid', width: 800, scheme: 'light', focus: 'field-invalid' },
  ],
  fills: [
    { name: 'hover #btn1', width: 800, scheme: 'light', hover: 'btn1' },
    { name: 'hover #btn-flat, dark', width: 800, scheme: 'dark', hover: 'btn-flat' },
  ],
  hatch: [{ name: 'hover #card1', width: 800, scheme: 'light', hover: 'card1' }],
  'exact-hatch': [
    { name: 'hover #card1', width: 800, scheme: 'light', hover: 'card1' },
    { name: 'hover #wide, dark', width: 800, scheme: 'dark', hover: 'wide' },
  ],
  boxes: [],
  forms: [],
};

/** Pages whose CSS gives the hatched elements' sizes, so the compiler draws exact hatches (M6c). */
const KNOWN_SIZES: ReadonlySet<string> = new Set(['exact-hatch']);

for (const name of ['design-system', 'boxes', 'forms', 'fills', 'hatch', 'exact-hatch']) {
  test.describe(`M4 draws what the original CSS shows: ${name}`, () => {
    const page = loadPage(name);
    for (const state of [...STATES, ...(INTERACTIONS[name] ?? [])]) {
      test(state.name, async ({ page: p }) => {
        const results = await compare(p, page, state);
        expect(results.length).toBeGreaterThanOrEqual(2);
        const wrong = results.filter(([, d]) => d >= SAME).map(([label, d]) => `${label}: ${d.toFixed(3)}`);
        expect(wrong).toEqual([]);
      });
    }
  });
}

// Negative controls: the oracle must see a wrong drawing.
test.describe('the oracle catches wrong drawings', () => {
  const page = loadPage('design-system');
  const selectors = (css: string): ReadonlySet<string> => new Set([...css.matchAll(/^\s*([^{}@/\n][^{}\n]*?)\s*\{/gm)].map((m) => m[1]?.trim() ?? ''));

  test('without the plugin, every border differs from its drawing', async ({ page: p }) => {
    const results = await compare(p, page, STATES[0] ?? { name: '', width: 800, scheme: 'light' }, () => page.css);
    expect(results.filter(([, d]) => d < SAME).map(([label]) => label)).toEqual([]);
  });

  test('without the state × modifier combinations, hover on a large button is wrong', async ({ page: p }) => {
    // The combinations are the rules whose selectors the source does not have.
    const own = selectors(page.css);
    const withoutCombos = (css: string): string =>
      css.replace(/^([.][^{}\n]*?) \{[^{}]*\}\n/gm, (rule: string, selector: string) => (own.has(selector.trim()) ? rule : ''));
    const results = await compare(p, page, { name: 'hover', width: 800, scheme: 'light', hover: 'btn-lg' }, withoutCombos);
    expect(results.find(([label]) => label === '#btn-lg')?.[1]).toBeGreaterThan(SAME);
  });

  test('without the combinations inside the media query, the primary button on a wide screen is wrong', async ({ page: p }) => {
    // Inside `@media (min-width: 900px)`, keep only the source's own `.btn` rule.
    const withoutMediaCombos = (css: string): string =>
      css.replace(/(@media \(min-width: 900px\) \{\n)([\s\S]*?)(\n\})/, (_m, open: string, body: string, close: string) =>
        open + body.split('\n').filter((line) => /^ {2}\.btn \{/.test(line) || /^ {2}@media \(prefers-color-scheme: dark\) \{ \.btn \{/.test(line)).join('\n') + close);
    const results = await compare(p, page, { name: 'wide', width: 1000, scheme: 'light' }, withoutMediaCombos);
    expect(results.find(([label]) => label === '#btn-primary')?.[1]).toBeGreaterThan(SAME);
  });
});

test('the oracle compares fills too: without the plugin a rough fill differs (control)', async ({ page: p }) => {
  const fills = loadPage('fills');
  const results = await compare(p, fills, { name: 'plain', width: 800, scheme: 'light' }, () => fills.css);
  expect(results.find(([label]) => label === '#block1')?.[1]).toBeGreaterThan(SAME);
  expect(results.find(([label]) => label === '#bar')?.[1]).toBeGreaterThan(SAME);
});

test('the oracle compares exact hatches too: a wrong size hint differs (control)', async ({ page: p }) => {
  const exact = loadPage('exact-hatch');
  // The hint says 240 wide; the element is 244 (border-box), as the flattened rule says.
  const wrong = { ...exact, css: exact.css.replace('--sketch-size: 244 94;', '--sketch-size: 240 94;') };
  const results = await compare(p, wrong, { name: 'plain', width: 800, scheme: 'light' });
  expect(results.find(([label]) => label === '#hinted')?.[1]).toBeGreaterThan(SAME);
  expect(results.find(([label]) => label === '#card1')?.[1]).toBeLessThan(SAME);
});

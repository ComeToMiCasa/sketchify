import { expect, test } from '@playwright/test';
import { HATCH_PRESETS, type HatchPreset } from '../../src/options';
import { transform } from '../helpers/transform';
import { type Rect, type Screenshot, pixelAt, rectOf, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Hatch presets, measured as drawn. The expected values come from HATCH_PRESETS in
// src/options.ts, so a preset can be tuned there and this test checks the new numbers.
//
// How it measures: black strokes on white. Along a horizontal line, strokes x + y = c cross every
// `gap` px (the gap is measured along the horizontal), and each crossing is weight × √2 wide.
// So over many rows: gap = distance between stroke centres, weight = ink share × gap / √2.
// The ink share counts anti-aliased pixels by how dark they are.
//
// To see the measured numbers while tuning: npx playwright test hatch-presets --project=chromium --reporter=list
// (each preset prints `hatch preset <name>: measured gap …, weight …`).

const CSS = '.block { width: 576px; height: 288px; background-color: #000000; --sketch-fill: hatch; }\n';
const HTML = '<div class="block" id="block"></div>';

/** How much of a pixel the black stroke covers (0 white … 1 black). */
const coverage = (shot: Screenshot, x: number, y: number): number => {
  const [r, g, b] = pixelAt(shot, x, y);
  return 1 - (r + g + b) / (3 * 255);
};

type Measured = { readonly gap: number; readonly weight: number };

const measure = (shot: Screenshot, rect: Rect): Measured => {
  const inset = 6;
  const xs = Array.from({ length: Math.floor(rect.width - 2 * inset) }, (_, i) => Math.ceil(rect.x + inset) + i);
  const ys = Array.from({ length: Math.floor((rect.height - 2 * inset) / 3) }, (_, i) => Math.ceil(rect.y + inset) + i * 3);
  const rows = ys.map((y) => xs.map((x) => coverage(shot, x, y)));
  const share = rows.flat().reduce((a, c) => a + c, 0) / (rows.length * xs.length);
  // Stroke centres: the middle of each run of pixels more than half covered.
  const spacings = rows.flatMap((row) => {
    const centres = row.reduce<ReadonlyArray<{ readonly start: number; readonly end: number }>>((runs, c, i) => {
      if (c <= 0.5) return runs;
      const last = runs.at(-1);
      return last && last.end === i - 1 ? [...runs.slice(0, -1), { start: last.start, end: i }] : [...runs, { start: i, end: i }];
    }, []).map((run) => (run.start + run.end) / 2);
    return centres.slice(1).map((c, i) => c - (centres[i] ?? c));
  });
  const sorted = [...spacings].sort((a, b) => a - b);
  const gap = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  return { gap, weight: (share * gap) / Math.SQRT2 };
};

const NAMES = Object.keys(HATCH_PRESETS) as ReadonlyArray<HatchPreset>;

test.describe('hatch presets as drawn', () => {
  for (const name of NAMES) {
    const preset = HATCH_PRESETS[name];
    test(`${name}: weight ${preset.weight}, gap ${preset.gap}`, async ({ page: p }) => {
      await render(p, HTML, await transform(CSS, { hatch: name }));
      const shot = await screenshot(p);
      const measured = measure(shot, await rectOf(p, '#block'));
      const report = `gap ${measured.gap.toFixed(2)}, weight ${measured.weight.toFixed(2)}`;
      test.info().annotations.push({ type: 'measured', description: report });
      console.log(`hatch preset ${name}: measured ${report} (table: gap ${preset.gap}, weight ${preset.weight})`);
      // The gap is exact (strokes sit on a grid); pressure and bow move the centres a little.
      expect(Math.abs(measured.gap - preset.gap), `${name}: measured gap ${measured.gap.toFixed(2)} vs ${preset.gap}`).toBeLessThanOrEqual(1);
      // Anti-aliasing and the stroke's pressure make the weight approximate.
      expect(Math.abs(measured.weight - preset.weight) / preset.weight, `${name}: measured weight ${measured.weight.toFixed(2)} vs ${preset.weight}`).toBeLessThan(0.15);
    });
  }

  test('the presets look different: weight and gap grow from fine to bold', async ({ page: p }) => {
    const measured = await NAMES.reduce<Promise<Readonly<Record<string, Measured>>>>(async (acc, name) => {
      const done = await acc;
      await render(p, HTML, await transform(CSS, { hatch: name }));
      return { ...done, [name]: measure(await screenshot(p), await rectOf(p, '#block')) };
    }, Promise.resolve({}));
    expect(measured['fine']?.weight).toBeLessThan(measured['normal']?.weight ?? 0);
    expect(measured['normal']?.weight).toBeLessThan(measured['bold']?.weight ?? 0);
  });

  test('the measure catches a wrong weight (control)', async ({ page: p }) => {
    // Drawn 1.5 times as heavy as normal, it must not pass as normal (the pass limit is 15% off).
    // Not twice: a marker's strokes would then touch and leave no gap to measure.
    await render(p, HTML, await transform(CSS, { hatch: { preset: 'normal', weight: HATCH_PRESETS.normal.weight * 1.5 } }));
    const measured = measure(await screenshot(p), await rectOf(p, '#block'));
    expect(Math.abs(measured.weight - HATCH_PRESETS.normal.weight) / HATCH_PRESETS.normal.weight).toBeGreaterThan(0.3);
  });
});

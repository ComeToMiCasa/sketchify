import { expect, test } from '@playwright/test';
import { type Rgb, rectOf, sample, screenshot } from './lib/pixels';
import { render } from './lib/render';

// Checks the pixel helpers on a page whose colours are known, the way
// prototypes/edge-tests/measure.py judged drawings. Drawing tests from M1 reuse them.

const PALETTE: Readonly<Record<string, Rgb>> = {
  red: [229, 72, 77],
  blue: [59, 130, 246],
  white: [255, 255, 255],
};

const HTML = '<div class="t" id="box"></div>';
const CSS = `
  html, body { margin: 0; background: #fff; }
  .t { margin: 40px; width: 120px; height: 60px; border: 6px solid #e5484d; background: #3b82f6; }
`;

test('pixel helpers read known colours inside, on and outside an element', async ({ page }) => {
  await render(page, HTML, CSS);
  const shot = await screenshot(page);
  const box = await rectOf(page, '#box');
  const midY = box.height / 2;

  expect(box).toEqual({ x: 40, y: 40, width: 132, height: 72 });
  expect(sample(shot, box, box.width / 2, midY, PALETTE)).toBe('blue');
  expect(sample(shot, box, 3, midY, PALETTE)).toBe('red');
  expect(sample(shot, box, -3, midY, PALETTE)).toBe('white');
  expect(sample(shot, box, box.width + 3, midY, PALETTE)).toBe('white');
});

import type { Rect, Rgb, Screenshot } from './pixels';
import { pixelAt } from './pixels';

// Ink masks: where a drawing put a colour around an element, for comparing drawings' shapes.

/** Whether a pixel is ink of some colour. Judged by hue, since thin lines are paler than the CSS colour. */
export type Ink = (px: Rgb) => boolean;

export const red: Ink = ([r, g, b]) => r - g > 40 && r - b > 40;
export const blue: Ink = ([r, g, b]) => b - r > 40 && b - g > 20;
export const green: Ink = ([r, g, b]) => g - r > 40 && g - b > 40;
/**
 * Any coloured (saturated) ink, whatever the hue. For comparing the shapes of drawings in
 * different colours: hue tests lose a colour's faint edge pixels at different rates.
 * Grey text is not saturated, so it does not count.
 */
export const colored: Ink = (px) => Math.max(...px) - Math.min(...px) > 40;
export const amber: Ink = ([r, g, b]) => r - b > 100 && g - b > 50 && r - g > 30;

/** How far a drawing may reach outside the border box (largest outset on the test pages + line). */
const REACH = 8;

/** Ink pixels around an element, in coordinates relative to its border box. */
export const inkMask = (shot: Screenshot, rect: Rect, ink: Ink): ReadonlySet<string> => {
  const x0 = Math.round(rect.x) - REACH;
  const y0 = Math.round(rect.y) - REACH;
  const w = Math.round(rect.width) + 2 * REACH;
  const h = Math.round(rect.height) + 2 * REACH;
  return new Set(
    Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)] as const)
      .filter(([dx, dy]) => ink(pixelAt(shot, x0 + dx, y0 + dy)))
      .map(([dx, dy]) => `${dx},${dy}`),
  );
};

/** Share of ink pixels that only one of the two masks has (0 = same drawing). */
export const difference = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  const union = new Set([...a, ...b]);
  const only = [...union].filter((key) => a.has(key) !== b.has(key)).length;
  return union.size === 0 ? 0 : only / union.size;
};

/** Below this two drawings are taken as the same; identical drawings measure about 0.01. */
export const SAME = 0.1;

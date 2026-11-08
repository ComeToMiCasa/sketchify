import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

// Ported from prototypes/edge-tests/measure.py (near / name / sample).

export type Rgb = readonly [r: number, g: number, b: number];

export type Screenshot = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export const decodePng = (buffer: Uint8Array): Screenshot => {
  const png = PNG.sync.read(Buffer.from(buffer));
  return { width: png.width, height: png.height, data: png.data };
};

/** Full-page screenshot; pixel coordinates are document coordinates (device scale 1). */
export const screenshot = async (page: Page): Promise<Screenshot> => decodePng(await page.screenshot({ fullPage: true }));

/** Document-coordinate box of the first element matching the selector. */
export const rectOf = (page: Page, selector: string): Promise<Rect> =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  });

export const pixelAt = (shot: Screenshot, x: number, y: number): Rgb => {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= shot.width || py >= shot.height) {
    throw new RangeError(`pixel (${px}, ${py}) is outside the ${shot.width}x${shot.height} screenshot`);
  }
  const i = (py * shot.width + px) * 4;
  return [shot.data[i] ?? 0, shot.data[i + 1] ?? 0, shot.data[i + 2] ?? 0];
};

export const near = (a: Rgb, b: Rgb, tolerance = 40): boolean =>
  a.every((value, i) => Math.abs(value - (b[i] ?? 0)) <= tolerance);

/** Name of the first palette colour near the pixel, or `other(r,g,b)`. */
export const colorName = (pixel: Rgb, palette: Readonly<Record<string, Rgb>>, tolerance = 40): string =>
  Object.entries(palette).find(([, color]) => near(pixel, color, tolerance))?.[0] ?? `other(${pixel.join(',')})`;

/** Samples a pixel at an offset from a rect's top-left corner and names its colour. */
export const sample = (
  shot: Screenshot,
  rect: Rect,
  dx: number,
  dy: number,
  palette: Readonly<Record<string, Rgb>>,
): string => colorName(pixelAt(shot, rect.x + dx, rect.y + dy), palette);

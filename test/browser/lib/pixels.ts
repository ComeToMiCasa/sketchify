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

/**
 * Waits until the page is painted as styled: every image a computed `border-image-source` or
 * `background-image` uses (the drawings) is decoded, then two animation frames pass. Without it,
 * WebKit under load was sometimes captured before painting a hover's new drawing, or with a large
 * drawing not yet decoded.
 */
export const settle = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const urls = new Set<string>();
    document.querySelectorAll('*').forEach((el) => {
      const style = getComputedStyle(el);
      [style.borderImageSource, style.backgroundImage].forEach((value) => {
        for (const match of value.matchAll(/url\("([^"]*)"\)/g)) if (match[1]) urls.add(match[1]);
      });
    });
    await Promise.all(
      [...urls].map((src) => {
        const img = new Image();
        img.src = src;
        return img.decode().catch(() => undefined);
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

/**
 * Moves the mouse and waits until the page shows it. Under load, WebKit sometimes misses a mouse
 * move (the element under the pointer never gets `:hover`), so this checks that it did, moving off
 * by 1px and back if not; then it waits until two full-page screenshots in a row are the same, since
 * a hover can swap in a large SVG that takes several frames to paint. At most 10 tries each.
 */
export const moveAndSettle = async (page: Page, x: number, y: number): Promise<void> => {
  const hovered = (): Promise<boolean> =>
    page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.matches(':hover') ?? true, [x, y] as const);
  const point = async (tries: number): Promise<void> => {
    await page.mouse.move(x, y);
    await settle(page);
    if ((await hovered()) || tries <= 1) return;
    await page.mouse.move(x + 1, y + 1);
    await point(tries - 1);
  };
  const steady = async (previous: Buffer, tries: number): Promise<void> => {
    await settle(page);
    const next = await page.screenshot({ fullPage: true });
    if (!previous.equals(next) && tries > 1) await steady(next, tries - 1);
  };
  await point(10);
  await steady(await page.screenshot({ fullPage: true }), 10);
};

/** Full-page screenshot, after the page has settled; pixel coordinates are document coordinates (device scale 1). */
export const screenshot = async (page: Page): Promise<Screenshot> => {
  await settle(page);
  return decodePng(await page.screenshot({ fullPage: true }));
};

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

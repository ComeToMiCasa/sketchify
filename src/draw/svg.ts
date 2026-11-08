// SVG strings and data URIs. Pure; knows nothing about PostCSS.

/** Rounds to one decimal place; avoids `-0`. */
export const round1 = (n: number): number => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
};

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** Rounds every number in a path to one decimal place (Rough.js prints full precision). */
export const tidyPath = (d: string): string => d.replace(NUMBER, (n) => String(round1(Number(n))));

/**
 * A mirrored copy of a drawing (spec "이웃 요소 변형"). The element itself is never flipped,
 * since that would flip its text too; the SVG content is, with the same path data.
 */
export type Flip = 'none' | 'x' | 'y' | 'xy';

/** In the order the variant rules pick them: own position mod 4 = index. */
export const FLIPS: ReadonlyArray<Flip> = ['none', 'x', 'y', 'xy'];

/** The `transform` attribute (with a leading space) that mirrors a `width`×`height` drawing, or ''. */
export const flipTransform = (flip: Flip, width: number, height: number = width): string => {
  const w = round1(width);
  const h = round1(height);
  switch (flip) {
    case 'none':
      return '';
    case 'x':
      return ` transform='matrix(-1 0 0 1 ${w} 0)'`;
    case 'y':
      return ` transform='matrix(1 0 0 -1 0 ${h})'`;
    case 'xy':
      return ` transform='matrix(-1 0 0 -1 ${w} ${h})'`;
    default: {
      const unreachable: never = flip;
      return unreachable;
    }
  }
};

export const svgDocument = (width: number, height: number, body: string): string =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${round1(width)}' height='${round1(height)}' viewBox='0 0 ${round1(width)} ${round1(height)}'>${body}</svg>`;

/**
 * `url("data:image/svg+xml,…")` with only the characters that must be escaped.
 * `%` goes first so the escapes themselves are not escaped again; `%` appears in colours like `rgb(0 0 0 / 50%)`.
 */
export const dataUri = (svg: string): string =>
  `url("data:image/svg+xml,${svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, '%22')}")`;

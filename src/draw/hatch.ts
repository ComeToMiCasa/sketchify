// Hatch fill tile for elements of unknown size (spec "채움", "크기 처리"; M6b). Pure.
// Ported from prototypes/fills.mjs penHatchTile(): pen strokes laid down at 45°, nearly
// straight, one gentle bow each, a per-stroke weight, and pressure that swells and thins along
// the stroke. Every variation is periodic in the tile size, so strokes continue exactly across
// the seams of the repeated background.
import type { HatchOptions } from '../options';
import { dataUri, round1, svgDocument } from './svg';

export type HatchTile = { readonly size: number; readonly svg: string; readonly url: string };

/**
 * The tile size: a multiple of `gap` (so strokes line up across seams) chosen so that the
 * pressure swells and thins about once every `pressureLength` along a stroke. The defaults give
 * the spec's 192px.
 */
export const hatchTileSize = (options: Pick<HatchOptions, 'gap' | 'pressureLength'>): number =>
  2 * options.gap * Math.max(1, Math.round(options.pressureLength / (Math.SQRT2 * options.gap)));

const TAU = 2 * Math.PI;

/** A hash of an integer key and the seed, in [0, 1). The same key always gives the same value. */
const hashFor =
  (seed: number) =>
  (n: number): number => {
    const h0 = (n * 374761393 + seed * 668265263) | 0;
    const h1 = Math.imul(h0 ^ (h0 >>> 13), 1274126177);
    return ((h1 ^ (h1 >>> 16)) >>> 0) / 4294967296;
  };

/** A filled ribbon per stroke: its centre bows, its width follows the pressure. */
export const drawHatchTile = (color: string, options: HatchOptions, seed: number): HatchTile => {
  const T = hatchTileSize(options);
  const { gap } = options;
  const hash = hashFor(seed);
  // Per-stroke parameters depend only on the stroke's position mod T: the tile repeats exactly.
  const params = (c: number) => {
    const key = ((c % T) + T) % T;
    return {
      bow: (options.bow / 0.5) * (0.25 + hash(key) * 0.55) * (hash(key + 3) < 0.5 ? -1 : 1),
      bowPhase: hash(key + 5) * TAU,
      base: options.weight - options.weightJitter + hash(key + 11) * 2 * options.weightJitter,
      press: options.pressure * (0.625 + hash(key + 17) * 0.75),
      pressPhase: hash(key + 19) * TAU,
    };
  };
  // How far past the tile each stroke runs. A stroke's end is cut square across it, so its corners
  // sit up to half its width (plus the bow) back from the end along each axis: run past the tile
  // by more than that, or the seams show notches where thick strokes end short of the edge.
  // At least 6px, the step between outline points, which covers the presets up to weight ~8.
  const widest = (options.weight + options.weightJitter) * (1 + 1.375 * options.pressure);
  const reach = widest / 2 / Math.SQRT2 + (options.bow / 0.5) * 0.8 + 2;
  const past = 6 * Math.max(1, Math.ceil(reach / 6));
  const ribbons = Array.from({ length: Math.floor((2 * T + 4 * gap) / gap) + 1 }, (_, i) => -2 * gap + i * gap).flatMap((c) => {
    const { bow, bowPhase, base, press, pressPhase } = params(c);
    // Points along the stroke x + y = c, every 6px of x, at least `past` beyond the tile on all
    // four sides. The points sit on a 6px grid, so the ends keep one more point (up to 6px more):
    // cutting at `past` exactly could end a stroke short of it and leave a notch at the seam.
    const points = Array.from({ length: Math.ceil((T + 2 * past) / 6) + 1 }, (_, k) => -past + k * 6)
      .map((x) => ({ x, y: c - x }))
      .filter(({ y }) => y > -past - 6 && y < T + past + 6)
      .map(({ x, y }) => {
        // Along the stroke, period T keeps it seamless across tiles.
        const along = x - y;
        const off = bow * Math.sin((TAU * along) / T + bowPhase);
        const width = base * (1 + press * Math.sin((TAU * along) / T + pressPhase));
        // The centre is nudged along the normal (1,1)/√2; the edges are ±width/2 along it.
        const cx = x + off / Math.SQRT2;
        const cy = y + off / Math.SQRT2;
        const h = width / 2 / Math.SQRT2;
        return { left: `${round1(cx + h)} ${round1(cy + h)}`, right: `${round1(cx - h)} ${round1(cy - h)}` };
      });
    if (points.length < 2) return [];
    return [`M${points.map((p) => p.left).join('L')}L${[...points].reverse().map((p) => p.right).join('L')}Z`];
  });
  const svg = svgDocument(T, T, `<path d='${ribbons.join('')}' fill='${color}' stroke='none'/>`);
  return { size: T, svg, url: dataUri(svg) };
};

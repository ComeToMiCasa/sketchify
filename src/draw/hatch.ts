// Hatch fills (spec "Fills", "Element sizes"). Pure. The repeated tile for elements of unknown size (M6b),
// and the exact hatch for elements of known size (M6c, below).
// Ported from prototypes/fills.mjs penHatchTile(): pen strokes laid down at 45°, nearly
// straight, one gentle bow each, a per-stroke weight, and pressure that swells and thins along
// the stroke. Every variation is periodic in the tile size, so strokes continue exactly across
// the seams of the repeated background.
import type { HatchOptions } from '../options';
import { seeded } from './fill';
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

// --- Exact hatch (M6c): elements of known size ------------------------------------
// Ported from prototypes/fills.mjs exactHatch(): Rough.js-style hachure. Each stroke runs between
// where its line meets the element's outline (a rounded rectangle), each end nudged to land
// somewhere between `over` outside the outline and the middle of the border line.

export type ExactHatchInput = {
  /** The element's border-box size (px). */
  readonly width: number;
  readonly height: number;
  /** The outer corner radius (px); 0 for sharp corners. */
  readonly radius: number;
  /** The border line's width (px); 0 without a border. */
  readonly border: number;
  readonly color: string;
  readonly options: HatchOptions;
  readonly seed: number;
  /** Where the border box's top-left corner sits in the drawing. */
  readonly at: number;
};

/** The longest a stroke's ink reaches past the outline: `over` plus half the widest stroke. */
export const exactHatchReach = (options: HatchOptions): number =>
  options.over + ((options.weight + options.weightJitter) * (1 + 1.375 * options.pressure)) / 2;

/** Whether a point is inside the rounded rectangle [0, w] × [0, h] with corner radius r. */
const insideOutline = (w: number, h: number, r: number) => (x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = x < r ? r : x > w - r ? w - r : x;
  const cy = y < r ? r : y > h - r ? h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Bisects between an outside `a` and an inside `b` for where `inside` changes. */
const edgeBetween = (a: number, b: number, inside: (x: number) => boolean): number => {
  let out = a;
  let ins = b;
  for (let i = 0; i < 30; i += 1) {
    const mid = (out + ins) / 2;
    if (inside(mid)) ins = mid;
    else out = mid;
  }
  return ins;
};

/**
 * The x range where the stroke x + y = c is inside the outline, or undefined. The outline is
 * convex, so the inside part of a line is one piece.
 */
const crossing = (c: number, w: number, h: number, r: number): readonly [number, number] | undefined => {
  const x1 = Math.max(0, c - h);
  const x2 = Math.min(w, c);
  if (x2 - x1 < 1.5) return undefined;
  const inside = insideOutline(w, h, r);
  const on = (x: number): boolean => inside(x, c - x);
  if (on(x1) && on(x2)) return [x1, x2];
  const probe = Array.from({ length: 33 }, (_, i) => x1 + ((x2 - x1) * i) / 32).find(on);
  if (probe === undefined) return undefined;
  const a = on(x1) ? x1 : edgeBetween(x1, probe, on);
  const b = on(x2) ? x2 : edgeBetween(x2, probe, on);
  return b - a < 1.5 ? undefined : [a, b];
};

/** Taper length at a `taper` end (px), from the prototype. */
const TAPER = 2.5;

/**
 * Distance between outline points along a stroke (px). The stroke bends once (its bow) and swells
 * about once per `pressureLength` (≥ 100px), so points this far apart follow it; closer points only
 * make the CSS bigger.
 */
const STEP = 24;

/** A closed outline as a path: the first point absolute, the rest relative (shorter numbers). */
const outlinePath = (points: ReadonlyArray<readonly [number, number]>): string => {
  const [first] = points;
  if (!first) return '';
  const rounded = points.map(([x, y]) => [round1(x), round1(y)] as const);
  const moves = rounded.slice(1).map(([x, y], i) => {
    const [px, py] = rounded[i] ?? first;
    return `${round1(x - px)} ${round1(y - py)}`;
  });
  return `M${rounded[0]?.[0]} ${rounded[0]?.[1]}l${moves.join(' ')}z`;
};

/** The strokes as one filled path, in the element's colour. */
export const drawExactHatch = (input: ExactHatchInput): string => {
  const { width: w, height: h, options, at } = input;
  const r = Math.min(input.radius, w / 2, h / 2);
  const rand = seeded(input.seed);
  const S2 = Math.SQRT2;
  // Along the stroke (down-left to up-right is x up, y down) and across it.
  const d = [1 / S2, -1 / S2] as const;
  const n = [1 / S2, 1 / S2] as const;
  const first = rand() * options.gap;
  const count = Math.max(0, Math.ceil((w + h - first) / options.gap));
  const ribbons = Array.from({ length: count }, (_, i) => first + i * options.gap).flatMap((c) => {
    const range = crossing(c, w, h, r);
    // The draws below happen for every stroke, so one stroke's shape never shifts another's.
    const e1 = -options.over + rand() * (options.over + input.border / 2);
    const e2 = -options.over + rand() * (options.over + input.border / 2);
    const base = options.weight - options.weightJitter + rand() * 2 * options.weightJitter;
    const press = options.pressure * (0.625 + rand() * 0.75);
    const phase = rand() * TAU;
    const lambda = options.pressureLength * (0.85 + rand() * 0.3);
    const bowSize = (options.bow / 0.5) * (0.25 + rand() * 0.55) * (rand() < 0.5 ? -1 : 1);
    if (!range) return [];
    const [xa, xb] = range;
    // e > 0 ends inside the outline, e < 0 past it; e is measured across a straight edge.
    const p1 = [xa + d[0] * e1 * S2, c - xa + d[1] * e1 * S2] as const;
    const p2 = [xb - d[0] * e2 * S2, c - xb - d[1] * e2 * S2] as const;
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (L < 3) return [];
    const bow = bowSize * Math.min(1, L / 60);
    const taper = options.ends === 'taper';
    // Dense samples only near a tapered end; the middle is nearly straight.
    const middle = Array.from({ length: Math.max(0, Math.ceil((L - TAPER - STEP) / STEP)) }, (_, k) => STEP + k * STEP).filter((t) => t < L - TAPER);
    const ts = taper ? [0, 0.8, 1.6, TAPER, ...middle, L - TAPER, L - 1.6, L - 0.8, L] : [0, ...middle, L];
    const steps = ts.filter((t, k) => t >= 0 && t <= L && (k === 0 || t > (ts[k - 1] ?? -1)));
    const edges = steps.map((t) => {
      const off = bow * Math.sin((Math.PI * t) / L);
      const thin = taper ? Math.min(1, 0.3 + (0.7 * Math.min(t, L - t)) / TAPER) : 1;
      const hw = (base * (1 + press * Math.sin((TAU * t) / lambda + phase)) * thin) / 2;
      const cx = at + p1[0] + d[0] * t + n[0] * off;
      const cy = at + p1[1] + d[1] * t + n[1] * off;
      return { left: [cx + n[0] * hw, cy + n[1] * hw] as const, right: [cx - n[0] * hw, cy - n[1] * hw] as const };
    });
    return [outlinePath([...edges.map((e) => e.left), ...[...edges].reverse().map((e) => e.right)])];
  });
  return ribbons.length === 0 ? '' : `<path d='${ribbons.join('')}' fill='${input.color}' stroke='none'/>`;
};

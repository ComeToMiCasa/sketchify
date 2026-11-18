// Fills drawn into the same 9-slice SVG as the border (spec "Fills", M6a). Pure.
// Ported from prototypes/fills.mjs: blob() (rough solid) and marker() (highlighter).
import rough from 'roughjs';
import type { HatchOptions, Rough } from '../options';
import { round1, tidyPath } from './svg';

export type FillInput =
  | {
      readonly kind: 'rough' | 'marker';
      /** A literal CSS colour, baked into the SVG. */
      readonly color: string;
    }
  /**
   * An exact hatch (M6c): the element's border-box size is known, so the drawing is made at that
   * size and each stroke ends at the outline (spec "Fills", "Element sizes").
   */
  | {
      readonly kind: 'hatch';
      readonly color: string;
      readonly width: number;
      readonly height: number;
      readonly hatch: HatchOptions;
    };

/** The fills drawn on the square 9-slice source. */
export type SquareFill = Extract<FillInput, { readonly kind: 'rough' | 'marker' }>;

/** How far a marker reaches past the element's left and right edges, and past its top and bottom. */
export const MARKER_REACH = { across: 6, along: 2 } as const;

/** Highlighter ink lets text and outlines show through (prototype value). */
export const MARKER_OPACITY = 0.55;

/** Where the element sits on the square source SVG. */
export type FillBox = {
  /** Width and height of the source SVG. */
  readonly size: number;
  /** Distance from the SVG edge to the element's outer (border-box) edge. */
  readonly edge: number;
  /** Distance from the SVG edge to the centre of the border line. */
  readonly margin: number;
  readonly radius: number;
};

const generator = rough.generator();

/** Park–Miller, as in the prototype: the same seed gives the same shape. */
export const seeded = (seed: number): (() => number) => {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
};

const roundedRect = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

/** Filled Rough.js paths as `<path>` elements in the fill colour. */
const filled = (drawable: ReturnType<typeof generator.rectangle>, color: string, opacity?: number): string =>
  generator
    .toPaths(drawable)
    .filter((path) => path.fill && path.fill !== 'none')
    .map((path) => `<path d='${tidyPath(path.d)}' fill='${color}'${opacity === undefined ? '' : ` fill-opacity='${opacity}'`} stroke='none'/>`)
    .join('');

/**
 * A solid blob with ragged edges, just inside the border line (under it), or just inside the
 * element's edge when there is no border.
 */
const roughFill = (box: FillBox, color: string, rough: Rough, seed: number): string => {
  const m = box.margin + 1.5;
  const w = box.size - 2 * m;
  const options = { stroke: 'none', fill: color, fillStyle: 'solid', seed, roughness: rough.roughness * (1.6 / 1.3), bowing: rough.bowing, maxRandomnessOffset: rough.maxRandomnessOffset };
  const drawable = box.radius > 0 ? generator.path(roundedRect(m, m, w, w, Math.max(box.radius - 1, 1)), options) : generator.rectangle(m, m, w, w, options);
  return filled(drawable, color);
};

/** A highlighter swipe: ragged left and right ends, slightly wavy long edges, past the element. */
const markerFill = (box: FillBox, color: string, rough: Rough, seed: number): string => {
  const rand = seeded(seed);
  const left = box.edge - MARKER_REACH.across;
  const right = box.size - left;
  const top = box.edge - MARKER_REACH.along;
  const bottom = box.size - top;
  const jag = MARKER_REACH.across + 1;
  const ys = Array.from({ length: Math.floor((bottom - top) / 9) + 1 }, (_, i) => top + i * 9);
  const leftEnd = ys.map((y) => [round1(left + rand() * jag), y] as [number, number]);
  const rightEnd = ys.map((y) => [round1(right - rand() * jag), y] as [number, number]);
  const inner = box.edge + 4;
  const poly: Array<[number, number]> = [
    ...leftEnd,
    [inner, round1(bottom - rand() * 2)],
    [box.size - inner, round1(bottom - rand() * 2)],
    ...rightEnd.reverse(),
    [box.size - inner, round1(top + rand() * 2)],
    [inner, round1(top + rand() * 2)],
  ];
  const drawable = generator.polygon(poly, { stroke: 'none', fill: color, fillStyle: 'solid', seed, roughness: rough.roughness * (0.8 / 1.3) });
  return filled(drawable, color, MARKER_OPACITY);
};

/** The fill's SVG elements, drawn under the border line. */
export const fillPaths = (fill: SquareFill, box: FillBox, rough: Rough, seed: number): string =>
  fill.kind === 'rough' ? roughFill(box, fill.color, rough, seed) : markerFill(box, fill.color, rough, seed);

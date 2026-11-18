// 9-slice border drawings (spec "Borders"). Ported from prototypes/showcase/gen.mjs nineSlice().
import rough from 'roughjs';
import type { Rough } from '../options';
import { type FillInput, MARKER_REACH, fillPaths } from './fill';
import { drawExactHatch, exactHatchReach } from './hatch';
import { FLIPS, type Flip, dataUri, flipTransform, round1, svgDocument, tidyPath } from './svg';

export type NineSliceInput = {
  /** Border width in px; 0 for a fill without a border. */
  readonly width: number;
  /** Uniform corner radius in px; 0 for sharp corners. */
  readonly radius: number;
  /** A literal CSS colour, baked into the SVG. */
  readonly color: string;
  readonly rough: Rough;
  /** Rough.js seed. Must not be 0 (Rough.js treats 0 as "random"). */
  readonly seed: number;
  /** A fill drawn under the border (M6a), or none (the original background stays). */
  readonly fill?: FillInput;
};

/** Where the drawing sits relative to the element's border box. */
export type NineSliceGeometry = {
  /** Distance from the SVG edge to the centre of the drawn line. */
  readonly margin: number;
  /** Corner slice size: `border-image-slice` and `border-image-width` (px). */
  readonly slice: number;
  /** Width and height of the square source SVG. */
  readonly size: number;
  /** `border-image-outset` (px): lines up the drawn line with the centre of the real border. */
  readonly outset: number;
};

export type NineSlice = NineSliceGeometry & {
  readonly svg: string;
  readonly url: string;
};

/** The `border-image-slice`, `-width` and `-outset` values that place a drawing on an element. */
export type ImagePlacement = { readonly slice: string; readonly width: string; readonly outset: string };

/** `fill` also paints the middle of the drawing (the element's inside). */
export const nineSlicePlacement = (geometry: NineSliceGeometry, fill = false): ImagePlacement => ({
  slice: `${geometry.slice}${fill ? ' fill' : ''}`,
  width: `${geometry.slice}px`,
  outset: `${geometry.outset}px`,
});

/** Length of the stretchable middle of each edge in the source SVG. */
const EDGE = 120;

/**
 * Rounded corners get a slice just big enough for the curve (margin 4 + radius), so small
 * elements don't shrink their corners; sharp corners keep room for the overshoot (at least 14).
 * Thick lines push the margin out so the line is never clipped and the outset never goes negative.
 */
export const nineSliceGeometry = (width: number, radius: number, reach = 0): NineSliceGeometry => {
  if (width === 0) return fillOnlyGeometry(radius, reach);
  const rounded = radius > 0;
  // `reach`: how far a fill goes past the element (a marker), which the outset must cover.
  const margin = Math.max(rounded ? 4 : 6, width / 2 + 2, reach > 0 ? width / 2 + reach + 2 : 0);
  const slice = rounded ? margin + Math.max(radius, 4) : Math.max(margin + 2, 14);
  return { margin, slice, size: 2 * slice + EDGE, outset: round1(margin - width / 2) };
};

/**
 * A fill without a border (M6a) has no line overshoot to make room for, so its corner slices
 * only hold the fill's corner (or a marker's ragged end). Small slices keep small elements, like
 * a 12px progress bar or a highlighted word, from making the browser shrink the drawing.
 */
const fillOnlyGeometry = (radius: number, reach: number): NineSliceGeometry => {
  const margin = reach > 0 ? reach + 2 : 2;
  const slice = reach > 0 ? margin + 2 : margin + Math.max(radius, 3);
  return { margin, slice, size: 2 * slice + EDGE, outset: margin };
};

/**
 * The geometry for a request: a marker fill needs room past the element, and so does an exact
 * hatch (its strokes end up to `over` past the outline). Without a border, an exact hatch's corner
 * slices still hold the rounded corner, so a stretched drawing keeps its corners round.
 */
export const geometryFor = (input: Pick<NineSliceInput, 'width' | 'radius' | 'fill'>): NineSliceGeometry => {
  const fill = input.fill;
  if (fill?.kind === 'hatch') {
    // Whole pixels, so the drawing starts on the pixel grid like the plain border's (same anti-aliasing).
    const reach = Math.ceil(exactHatchReach(fill.hatch));
    if (input.width > 0) {
      // The border is the plain border's drawing, set `inset` in from the drawing's edge; the
      // corner slices hold its corners whole (see drawExactNineSlice).
      const plain = nineSliceGeometry(input.width, input.radius);
      const outer = nineSliceGeometry(input.width, input.radius, reach);
      return { ...outer, slice: round1(outer.outset - plain.outset + plain.slice) };
    }
    const margin = reach + 2;
    const slice = margin + Math.max(input.radius, 3);
    return { margin, slice, size: 2 * slice + EDGE, outset: margin };
  }
  return nineSliceGeometry(input.width, input.radius, fill?.kind === 'marker' ? MARKER_REACH.across : 0);
};

/** The exact-size drawing's width and height: the border box plus the outset on each side. */
export const exactSize = (geometry: NineSliceGeometry, width: number, height: number): readonly [number, number] => [
  round1(width + 2 * geometry.outset),
  round1(height + 2 * geometry.outset),
];

/**
 * Whether an exact-size drawing can be placed 1:1: each side is longer than its two corner slices.
 * A smaller element would make the browser shrink the whole drawing.
 */
export const exactFits = (geometry: NineSliceGeometry, width: number, height: number): boolean =>
  exactSize(geometry, width, height).every((side) => side >= 2 * geometry.slice + 1);

const roundedRect = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

const generator = rough.generator();

/** Rough.js draws each line twice, so one pass is thinner to keep the visible weight (spec "Stroke width"). */
const STROKE_SCALE = 0.85;

/** The border line drawn on the square source, as one `<g>`. */
const borderLines = (input: NineSliceInput, geometry: NineSliceGeometry, transform: string): string => {
  const { margin, size } = geometry;
  const side = size - 2 * margin;
  const options = {
    stroke: input.color,
    strokeWidth: input.width,
    seed: input.seed,
    roughness: input.rough.roughness,
    bowing: input.rough.bowing,
    maxRandomnessOffset: input.rough.maxRandomnessOffset,
  };
  const drawable =
    input.radius > 0 ? generator.path(roundedRect(margin, margin, side, side, input.radius), options) : generator.rectangle(margin, margin, side, side, options);
  const paths = generator
    .toPaths(drawable)
    .map((path) => `<path d='${tidyPath(path.d)}'/>`)
    .join('');
  return `<g${transform} fill='none' stroke='${input.color}' stroke-width='${round1(input.width * STROKE_SCALE)}' stroke-linecap='round' stroke-linejoin='round'>${paths}</g>`;
};

/**
 * An exact hatch (M6c) at the element's size. The border is the square drawing cut into the same
 * nine pieces the browser would make (corners as they are, edges stretched), so it looks like the
 * border of an element of unknown size. The hatch goes under it. Flips mirror the border only: a
 * mirrored hatch would slant the other way. Each flip draws its own hatch instead.
 */
const drawExactNineSlice = (input: NineSliceInput, fill: Extract<FillInput, { readonly kind: 'hatch' }>, flip: Flip): NineSlice => {
  const geometry = geometryFor(input);
  const { outset } = geometry;
  const [W, H] = exactSize(geometry, fill.width, fill.height);
  // The border without a fill: the same square drawing an element of unknown size gets, placed
  // where the browser would put it (its own outset from the border box).
  const plain = nineSliceGeometry(input.width, input.radius);
  const { size: S, slice: k } = plain;
  const inset = round1(outset - plain.outset);
  const hatch = drawExactHatch({
    width: fill.width,
    height: fill.height,
    radius: input.radius,
    border: input.width,
    color: fill.color,
    options: fill.hatch,
    seed: input.seed * FLIPS.length + FLIPS.indexOf(flip) + 1,
    at: outset,
  });
  // Source and target of each piece along one axis: [source start, source length, target start, target length].
  const cuts = (total: number): ReadonlyArray<readonly [number, number, number, number]> => [
    [0, k, inset, k],
    [k, S - 2 * k, round1(inset + k), round1(total - 2 * inset - 2 * k)],
    [S - k, k, round1(total - inset - k), k],
  ];
  const pieces = cuts(W).flatMap(([sx, sw, tx, tw], col) =>
    cuts(H).flatMap(([sy, sh, ty, th], row) =>
      col === 1 && row === 1
        ? []
        : [`<svg x='${tx}' y='${ty}' width='${tw}' height='${th}' viewBox='${sx} ${sy} ${sw} ${sh}' preserveAspectRatio='none'><use href='#b'/></svg>`],
    ),
  );
  const border = input.width > 0 ? `<defs><g id='b'>${borderLines(input, plain, flipTransform(flip, S))}</g></defs>${pieces.join('')}` : '';
  const svg = svgDocument(W, H, `${hatch}${border}`);
  return { ...geometry, svg, url: dataUri(svg) };
};

export const drawNineSlice = (input: NineSliceInput, flip: Flip = 'none'): NineSlice => {
  if (input.fill?.kind === 'hatch') return drawExactNineSlice(input, input.fill, flip);
  const geometry = geometryFor(input);
  const { margin, size, outset } = geometry;
  const transform = flipTransform(flip, size);
  const fill = input.fill
    ? `<g${transform}>${fillPaths(input.fill, { size, edge: outset, margin, radius: input.radius }, input.rough, input.seed + 100)}</g>`
    : '';
  const svg = svgDocument(size, size, `${fill}${input.width > 0 ? borderLines(input, geometry, transform) : ''}`);
  return { ...geometry, svg, url: dataUri(svg) };
};

// --- One-sided lines (spec "One-sided borders, hr, underlines") -------------------------------
// Ported from prototypes/showcase/gen.mjs strip(): a single line whose two ends stay fixed
// and whose middle stretches along its length.

export type LineSide = 'top' | 'right' | 'bottom' | 'left';

export type StripInput = {
  readonly side: LineSide;
  /** Border width in px. */
  readonly width: number;
  readonly color: string;
  readonly rough: Rough;
  /** Rough.js seed. Must not be 0. */
  readonly seed: number;
};

/** Fixed length at each end of the line (px). */
const STRIP_END = 16;
/** Gap between the drawing's edge and the line's end; the outset gives it back so the line reaches the element's end. */
const STRIP_MARGIN = 3;

export type StripGeometry = {
  /** Width and height of the source SVG. */
  readonly svgWidth: number;
  readonly svgHeight: number;
  /** Across the line: the drawing's thickness (line plus room for the wobble). */
  readonly across: number;
  readonly placement: ImagePlacement;
};

const horizontal = (side: LineSide): boolean => side === 'top' || side === 'bottom';

/**
 * Only the line's side gets a drawing width; the other sides get 0, so their slices draw nothing.
 * (A thin element would still shrink the drawing; see the opposite outset below.)
 * The ends (16px) are fixed and the middle stretches. The outset along the line gives back the
 * end margin, so the line reaches the element's ends; across the line it puts the line's centre
 * on the centre of the real border.
 */
export const stripGeometry = (width: number, side: LineSide): StripGeometry => {
  const across = round1(width + 10);
  const length = 2 * STRIP_END + EDGE;
  const centre = round1((across - width) / 2);
  const C = STRIP_END;
  const M = STRIP_MARGIN;
  // The opposite side's outset (nothing is drawn there) keeps the image area at least as deep as
  // the drawing, so a thin element (an `hr` is 1–2px high) does not make the browser shrink it.
  const A = across;
  const byside: Readonly<Record<LineSide, ImagePlacement>> = {
    top: { slice: `${A} ${C} 0 ${C}`, width: `${A}px ${C}px 0 ${C}px`, outset: `${centre}px ${M}px ${A}px ${M}px` },
    right: { slice: `${C} ${A} ${C} 0`, width: `${C}px ${A}px ${C}px 0`, outset: `${M}px ${centre}px ${M}px ${A}px` },
    bottom: { slice: `0 ${C} ${A} ${C}`, width: `0 ${C}px ${A}px ${C}px`, outset: `${A}px ${M}px ${centre}px ${M}px` },
    left: { slice: `${C} 0 ${C} ${A}`, width: `${C}px 0 ${C}px ${A}px`, outset: `${M}px ${A}px ${M}px ${centre}px` },
  };
  return horizontal(side)
    ? { svgWidth: length, svgHeight: across, across, placement: byside[side] }
    : { svgWidth: across, svgHeight: length, across, placement: byside[side] };
};

export type Strip = StripGeometry & { readonly svg: string; readonly url: string };

/** Lines bow more than box edges in the prototype, so a long divider does not look ruled. */
const STRIP_BOWING = 1.5;

export const drawStrip = (input: StripInput, flip: Flip = 'none'): Strip => {
  const geometry = stripGeometry(input.width, input.side);
  const { svgWidth, svgHeight, across } = geometry;
  const length = Math.max(svgWidth, svgHeight);
  const options = {
    stroke: input.color,
    strokeWidth: input.width,
    seed: input.seed,
    roughness: input.rough.roughness,
    bowing: input.rough.bowing * STRIP_BOWING,
    maxRandomnessOffset: input.rough.maxRandomnessOffset,
  };
  const drawable = horizontal(input.side)
    ? generator.line(STRIP_MARGIN, across / 2, length - STRIP_MARGIN, across / 2, options)
    : generator.line(across / 2, STRIP_MARGIN, across / 2, length - STRIP_MARGIN, options);
  const paths = generator
    .toPaths(drawable)
    .map((path) => `<path d='${tidyPath(path.d)}'/>`)
    .join('');
  const body = `<g${flipTransform(flip, svgWidth, svgHeight)} fill='none' stroke='${input.color}' stroke-width='${round1(input.width * STROKE_SCALE)}' stroke-linecap='round' stroke-linejoin='round'>${paths}</g>`;
  const svg = svgDocument(svgWidth, svgHeight, body);
  return { ...geometry, svg, url: dataUri(svg) };
};

// --- Underlines (spec "One-sided borders, hr, underlines", M6d) ------------------------------------
// The one-sided line's drawing (drawStrip, side `bottom`) on an element without a border: the
// `border-image` width and outset are given in px, so it needs no border and the layout stays.
// The line sits just below the text box, like a `border-bottom` would, with room to wobble.

/**
 * Where an underline drawing goes: the bottom slice only, its line's centre half the line width
 * below the element's bottom edge. The other outsets are the one-sided line's (ends reach the
 * element's ends; the top keeps the image area deep enough not to shrink it).
 */
export const underlinePlacement = (width: number): ImagePlacement => {
  const { placement } = stripGeometry(width, 'bottom');
  const across = round1(width + 10);
  const [top = '0px', right = '0px', , left = '0px'] = placement.outset.split(' ');
  return { ...placement, outset: `${top} ${right} ${round1(across / 2 + width / 2)}px ${left}` };
};

// --- Focus rings (spec "Form controls and @sketchify base", M7a) ----------------------------------
// A focused base field: its border (the same shape as unfocused, in the accent colour) and a
// second hand-drawn ring a little outside it, in one border image. It replaces the browser's focus
// outline, so it must be as easy to see. The ring lies in the outset: the layout stays.

/** Space between the border's outer edge and the ring, and the ring's width (px). */
export const FOCUS_RING = { gap: 2, width: 1.5 } as const;

/**
 * The focused drawing: the plain border's square drawing set `inset` px in from a larger square,
 * so its corners and edges are the unfocused ones (the border does not jump on focus), and the ring
 * around it. The corner slices grow by `inset` and hold both.
 */
export const drawFocusNineSlice = (input: NineSliceInput, flip: Flip = 'none'): { readonly url: string; readonly placement: ImagePlacement } => {
  const plain = nineSliceGeometry(input.width, input.radius);
  const off = input.width / 2 + FOCUS_RING.gap + FOCUS_RING.width / 2;
  const inset = Math.ceil(off + FOCUS_RING.width + 2);
  const size = plain.size + 2 * inset;
  const at = inset + plain.margin - off;
  const side = size - 2 * at;
  const ringOptions = {
    stroke: input.color,
    strokeWidth: FOCUS_RING.width,
    seed: input.seed + 5,
    roughness: input.rough.roughness,
    bowing: input.rough.bowing,
    maxRandomnessOffset: Math.min(input.rough.maxRandomnessOffset, 1.5),
  };
  const ring = input.radius > 0 ? generator.path(roundedRect(at, at, side, side, input.radius + off), ringOptions) : generator.rectangle(at, at, side, side, ringOptions);
  const ringPaths = generator
    .toPaths(ring)
    .map((path) => `<path d='${tidyPath(path.d)}'/>`)
    .join('');
  const body =
    `<g transform='translate(${inset} ${inset})'>${borderLines(input, plain, flipTransform(flip, plain.size))}</g>` +
    `<g${flipTransform(flip, size)} fill='none' stroke='${input.color}' stroke-width='${round1(FOCUS_RING.width * STROKE_SCALE)}' stroke-linecap='round' stroke-linejoin='round'>${ringPaths}</g>`;
  const svg = svgDocument(size, size, body);
  const slice = round1(plain.slice + inset);
  return { url: dataUri(svg), placement: { slice: `${slice}`, width: `${slice}px`, outset: `${round1(plain.outset + inset)}px` } };
};

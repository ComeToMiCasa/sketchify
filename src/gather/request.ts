// From a resolved border state to a drawing request (spec "그리는 테두리와 그대로 두는 테두리"). Pure.
import type { LineSide, NineSliceInput, StripInput } from '../draw/stroke';
import type { ResolvedOptions } from '../options';
import type { BorderState, Declared } from '../read/collect';
import type { FillInput } from '../draw/fill';
import { CORNERS, SIDES, type Color, type Corner, type Radius, type Side, type Style, type Width, isCurrentColor } from '../read/values';
import type { Condition } from '../read/variables';

export type NineSliceRequest = NineSliceInput & { readonly kind: 'nine-slice' };

/** A one-sided line (spec "한 변 border, hr, 밑줄"). */
export type StripRequest = StripInput & { readonly kind: 'strip' };

export type DrawRequest = NineSliceRequest | StripRequest;

/** A drawing for a condition (`@media`, `@supports`) whose variable values change the border. */
export type ConditionVariant = {
  readonly conditions: ReadonlyArray<Condition>;
  /** `undefined`: the border is transparent there, so nothing is drawn. */
  readonly request: DrawRequest | undefined;
};

/** The three seeds of the neighbour variants (spec "이웃 요소 변형"), from prototypes/showcase. */
export const SEEDS = [11, 23, 37] as const;

const allSame = <T>(values: ReadonlyArray<T>, key: (value: T) => string): T | undefined => {
  const [first] = values;
  return first !== undefined && values.every((value) => key(value) === key(first)) ? first : undefined;
};

const pxWidth = (width: Declared<Width>): number | undefined => (width.kind === 'px' ? width.px : undefined);
const solid = (style: Declared<Style>): boolean => style.kind === 'keyword' && style.keyword === 'solid';
const literal = (color: Declared<Color>): string | undefined => (color.kind === 'literal' ? color.css : undefined);

/** Uniform px radius; an unset radius counts as 0. */
const uniformRadius = (border: BorderState): number | undefined => {
  const corners = CORNERS.map((corner) => border.radius[corner]);
  const px = corners.map((radius: Declared<Radius>) => (radius.kind === 'unset' ? 0 : radius.kind === 'px' ? radius.px : undefined));
  return allSame(px, String);
};

/**
 * Radii above this are not drawn (pills, circles). The compiler does not know the element's size,
 * and a corner slice bigger than the element makes the browser shrink the whole drawing until it
 * almost disappears. Such borders are shown as the original CSS draws them.
 */
export const MAX_RADIUS = 32;

/** A drawing request when the state describes a uniform, solid, literal-coloured border. */
export const requestFor = (border: BorderState, options: ResolvedOptions): NineSliceRequest | undefined => {
  if (border.unsupported || border.hasBorderImage) return undefined;
  const sides = SIDES.map((side) => border.sides[side]);
  if (!sides.every((side) => solid(side.style))) return undefined;
  const width = allSame(sides.map((side) => pxWidth(side.width)), String);
  const color = allSame(sides.map((side) => literal(side.color)), String);
  const radius = uniformRadius(border);
  if (width === undefined || width <= 0 || color === undefined || radius === undefined || radius > MAX_RADIUS) return undefined;
  return { kind: 'nine-slice', width, radius, color, rough: options.rough, seed: SEEDS[0] };
};

const LINE_SIDES: Readonly<Record<Side, LineSide>> = { top: 'top', right: 'right', bottom: 'bottom', left: 'left' };

/** The two corners a side touches. */
const CORNERS_OF: Readonly<Record<Side, ReadonlyArray<Corner>>> = {
  top: ['top-left', 'top-right'],
  right: ['top-right', 'bottom-right'],
  bottom: ['bottom-left', 'bottom-right'],
  left: ['top-left', 'bottom-left'],
};

type SideLine = { readonly kind: 'none' } | { readonly kind: 'line'; readonly width: number; readonly color: string } | { readonly kind: 'other' };

/** A side has no line (width 0, `none`/`hidden`, or no style), a drawable line, or something else. */
const sideLine = (border: BorderState, side: Side): SideLine => {
  const { width, style, color } = border.sides[side];
  if (style.kind === 'unset' || (style.kind === 'keyword' && (style.keyword === 'none' || style.keyword === 'hidden'))) return { kind: 'none' };
  if (width.kind === 'px' && width.px === 0) return { kind: 'none' };
  const px = pxWidth(width);
  const css = literal(color);
  return solid(style) && px !== undefined && px > 0 && css !== undefined ? { kind: 'line', width: px, color: css } : { kind: 'other' };
};

/**
 * A one-sided line request: exactly one side has a solid, literal-coloured line, the others have
 * none, and the two corners on that side are square (a rounded end cannot be drawn by a strip).
 */
export const stripRequestFor = (border: BorderState, options: ResolvedOptions): StripRequest | undefined => {
  if (border.unsupported || border.hasBorderImage) return undefined;
  const lines = SIDES.map((side) => ({ side, line: sideLine(border, side) }));
  if (lines.some(({ line }) => line.kind === 'other')) return undefined;
  const drawn = lines.filter(({ line }) => line.kind === 'line');
  const [only] = drawn;
  if (drawn.length !== 1 || !only || only.line.kind !== 'line') return undefined;
  const square = CORNERS_OF[only.side].every((corner) => {
    const radius = border.radius[corner];
    return radius.kind === 'unset' || (radius.kind === 'px' && radius.px === 0);
  });
  if (!square) return undefined;
  return { kind: 'strip', side: LINE_SIDES[only.side], width: only.line.width, color: only.line.color, rough: options.rough, seed: SEEDS[0] };
};

/** A drawing for the border: four sides (9-slice) or one side (strip). */
export const drawRequestFor = (border: BorderState, options: ResolvedOptions): DrawRequest | undefined =>
  requestFor(border, options) ?? stripRequestFor(border, options);

const isCurrent = (color: Declared<Color>): boolean => color.kind !== 'unset' && isCurrentColor(color);
const known: Color = { kind: 'literal', css: '#000' };

/** The fill the state asks for (`--sketch-fill: rough | marker`), if any. */
const fillMode = (border: BorderState): FillInput['kind'] | undefined =>
  border.fill.kind === 'mode' && (border.fill.mode === 'rough' || border.fill.mode === 'marker') ? border.fill.mode : undefined;

/**
 * A drawing with its fill (spec "채움", M6a). Without a rough/marker fill, a background colour
 * or with a background image, it is the border drawing alone and the original background stays.
 * A fill goes with a four-sided border or no border; with anything else (a one-sided line,
 * dashes, a large radius) nothing is drawn and the original CSS shows.
 */
export const paintRequestFor = (border: BorderState, options: ResolvedOptions): DrawRequest | undefined => {
  const mode = fillMode(border);
  const color = border.background.color.kind === 'literal' ? border.background.color.css : undefined;
  // A fill in currentColor cannot be baked into the SVG: nothing is drawn, and the caller reports it.
  if (mode && !border.background.image && isCurrent(border.background.color)) return undefined;
  if (!mode || border.background.image || color === undefined) return drawRequestFor(border, options);
  if (border.unsupported || border.hasBorderImage) return undefined;
  const fill: FillInput = { kind: mode, color };
  const box = requestFor(border, options);
  if (box) return { ...box, fill };
  if (!SIDES.every((side) => sideLine(border, side).kind === 'none')) return undefined;
  const radius = uniformRadius(border);
  if (radius === undefined || radius > MAX_RADIUS) return undefined;
  return { kind: 'nine-slice', width: 0, radius, color: 'transparent', rough: options.rough, seed: SEEDS[0], fill };
};


/** Whether the border (or its fill) could be drawn if its `currentColor` parts had a known colour. */
export const blockedByCurrentColor = (border: BorderState, options: ResolvedOptions): boolean => {
  const sides = SIDES.map((side) => border.sides[side]);
  const fillCurrent = fillMode(border) !== undefined && !border.background.image && isCurrent(border.background.color);
  if (!sides.some((side) => isCurrent(side.color)) && !fillCurrent) return false;
  const resolved: BorderState = {
    ...border,
    sides: Object.fromEntries(
      SIDES.map((side) => {
        const state = border.sides[side];
        return [side, { ...state, color: isCurrent(state.color) ? known : state.color }];
      }),
    ) as BorderState['sides'],
    background: { ...border.background, color: isCurrent(border.background.color) ? known : border.background.color },
  };
  const request = paintRequestFor(resolved, options);
  return request !== undefined && (fillCurrent ? request.kind === 'nine-slice' && request.fill !== undefined : true);
};

/** A hatch fill (M6b): its colour. Drawn as a background, apart from the border drawing. */
export type HatchPaint = { readonly color: string };

const asksForHatch = (border: BorderState): boolean => border.fill.kind === 'mode' && border.fill.mode === 'hatch';

/** The hatch the state asks for: `--sketch-fill: hatch`, a literal background colour and no background image. */
export const hatchFor = (border: BorderState): HatchPaint | undefined =>
  asksForHatch(border) && !border.background.image && border.background.color.kind === 'literal' ? { color: border.background.color.css } : undefined;

/** The state asks for a hatch whose colour is currentColor. */
export const hatchInCurrentColor = (border: BorderState): boolean =>
  asksForHatch(border) && !border.background.image && isCurrent(border.background.color);

/** No side has a line: nothing to draw or show for the border itself. */
export const hasNoLine = (border: BorderState): boolean => SIDES.every((side) => sideLine(border, side).kind === 'none');

/** The state asks for a drawn fill whose colour is currentColor. */
export const fillInCurrentColor = (border: BorderState): boolean =>
  fillMode(border) !== undefined && !border.background.image && isCurrent(border.background.color);

/** The background colour as CSS, to show the original background again. */
export const backgroundOf = (border: BorderState): string => {
  const color = border.background.color;
  if (color.kind === 'unset' || color.kind === 'transparent') return 'transparent';
  return color.css;
};

export const allTransparent = (border: BorderState): boolean => SIDES.every((side) => border.sides[side].color.kind === 'transparent');

/** The border's colours as CSS (`top right bottom left`, shortened when equal), for showing a plain border. */
export const colorsOf = (border: BorderState): string => {
  const css = SIDES.map((side) => {
    const color = border.sides[side].color;
    if (color.kind === 'unset') return 'currentcolor';
    if (color.kind === 'transparent') return 'transparent';
    return color.css;
  });
  return allSame(css, String) ?? css.join(' ');
};

// From a resolved border state to a drawing request (spec "그리는 테두리와 그대로 두는 테두리"). Pure.
import type { LineSide, NineSliceInput, StripInput } from '../draw/stroke';
import type { ResolvedOptions } from '../options';
import type { BorderState, Declared } from '../read/collect';
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

/** Whether the border could be drawn if its `currentColor` sides had a known colour. */
export const blockedByCurrentColor = (border: BorderState, options: ResolvedOptions): boolean => {
  const sides = SIDES.map((side) => border.sides[side]);
  if (!sides.some((side) => side.color.kind !== 'unset' && isCurrentColor(side.color))) return false;
  const known: BorderState = {
    ...border,
    sides: Object.fromEntries(
      SIDES.map((side) => {
        const state = border.sides[side];
        const color = state.color.kind !== 'unset' && isCurrentColor(state.color) ? { kind: 'literal' as const, css: '#000' } : state.color;
        return [side, { ...state, color }];
      }),
    ) as BorderState['sides'],
  };
  return drawRequestFor(known, options) !== undefined;
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

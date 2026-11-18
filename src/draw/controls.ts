// Form control drawings for `@sketchify base` (spec "Form controls and @sketchify base", M7a). Pure.
// Ported from prototypes/showcase/gen.mjs checkbox(), radio() and chevron(). Each is drawn on an
// 18×18 (16×14 for the arrow) canvas and scaled to the control with `background-size: 100% 100%`.
import rough from 'roughjs';
import type { Rough } from '../options';
import { type Flip, dataUri, flipTransform, round1, svgDocument, tidyPath } from './svg';

const generator = rough.generator();

/** The control canvas (px of the SVG, not of the element). */
const BOX = 18;

/** Outline width on the canvas; 1.6 of 18 is about 1.2px on a 13px checkbox. */
const OUTLINE = 1.6;

/** Rough.js draws each line twice, so one pass is thinner to keep the visible weight (as for borders). */
const STROKE_SCALE = 0.85;

export type ControlInput = {
  /** Outline colour (literal CSS). */
  readonly ink: string;
  /** Tick and dot colour (literal CSS). */
  readonly accent: string;
  readonly checked: boolean;
  readonly rough: Rough;
  /** Rough.js seed. Must not be 0. */
  readonly seed: number;
};

/** Small controls get less overshoot, or the outline leaves the canvas. */
const calm = (r: Rough): Rough => ({ ...r, maxRandomnessOffset: Math.min(r.maxRandomnessOffset, 1.5) });

const stroked = (drawable: ReturnType<typeof generator.line>, color: string, width: number, transform = ''): string => {
  const paths = generator
    .toPaths(drawable)
    .map((path) => `<path d='${tidyPath(path.d)}'/>`)
    .join('');
  return `<g${transform} fill='none' stroke='${color}' stroke-width='${round1(width * STROKE_SCALE)}' stroke-linecap='round' stroke-linejoin='round'>${paths}</g>`;
};

const options = (color: string, width: number, r: Rough, seed: number) => ({
  stroke: color,
  strokeWidth: width,
  seed,
  roughness: r.roughness,
  bowing: r.bowing,
  maxRandomnessOffset: r.maxRandomnessOffset,
});

/**
 * A checkbox: a rough square in `ink`, and when checked a tick in `accent`. A flip mirrors the
 * square only; a mirrored tick would read as a different mark.
 */
export const drawCheckbox = (input: ControlInput, flip: Flip = 'none'): { readonly svg: string; readonly url: string } => {
  const m = OUTLINE / 2 + 1.5;
  const box = generator.rectangle(m, m, BOX - 2 * m, BOX - 2 * m, options(input.ink, OUTLINE, calm(input.rough), input.seed));
  const tickRough = { ...input.rough, roughness: input.rough.roughness * 0.7 };
  const tick = input.checked
    ? stroked(
        generator.linearPath(
          [
            [4.2, 9.2],
            [7.8, 13],
            [14.2, 4.2],
          ],
          options(input.accent, 2.4, tickRough, input.seed + 1),
        ),
        input.accent,
        2.4 / STROKE_SCALE,
      )
    : '';
  const svg = svgDocument(BOX, BOX, `${stroked(box, input.ink, OUTLINE, flipTransform(flip, BOX))}${tick}`);
  return { svg, url: dataUri(svg) };
};

/**
 * Radio sizes on the canvas (M7b): the dot is small and calm, so it sits well inside the circle
 * with white around it. A circle this small comes apart into loops at the border's roughness, so
 * it gets under half of it (0.6 at `normal`) and at most 0.8 of overshoot: still two hand-drawn
 * strokes, but one round ring (chosen from a side-by-side comparison).
 */
export const RADIO = { ring: BOX - OUTLINE - 3, dot: 6, ringRoughness: 0.46, ringOffset: 0.8, dotRoughness: 0.3 } as const;

/** A radio: a rough circle in `ink`, and when checked a filled dot in `accent`. A flip mirrors the circle only. */
export const drawRadio = (input: ControlInput, flip: Flip = 'none'): { readonly svg: string; readonly url: string } => {
  const ringRough = {
    ...input.rough,
    roughness: input.rough.roughness * RADIO.ringRoughness,
    maxRandomnessOffset: Math.min(input.rough.maxRandomnessOffset, RADIO.ringOffset),
  };
  const ring = generator.circle(BOX / 2, BOX / 2, RADIO.ring, options(input.ink, OUTLINE, ringRough, input.seed));
  const dot = input.checked
    ? generator
        .toPaths(
          generator.circle(BOX / 2, BOX / 2, RADIO.dot, {
            stroke: 'none',
            fill: input.accent,
            fillStyle: 'solid',
            seed: input.seed + 1,
            roughness: input.rough.roughness * RADIO.dotRoughness,
            maxRandomnessOffset: 0.5,
          }),
        )
        .filter((path) => path.fill && path.fill !== 'none')
        .map((path) => `<path d='${tidyPath(path.d)}' fill='${input.accent}' stroke='none'/>`)
        .join('')
    : '';
  const svg = svgDocument(BOX, BOX, `${stroked(ring, input.ink, OUTLINE, flipTransform(flip, BOX))}${dot}`);
  return { svg, url: dataUri(svg) };
};

/** The select arrow's canvas (px of the SVG). */
export const CHEVRON = { width: 16, height: 14 } as const;

/** A select arrow: a rough chevron in `ink`. */
export const drawChevron = (input: { readonly color: string; readonly rough: Rough; readonly seed: number }): { readonly svg: string; readonly url: string } => {
  const r = { ...input.rough, roughness: input.rough.roughness * 0.6 };
  const chevron = generator.linearPath(
    [
      [3, 5],
      [8, 10.5],
      [13, 5],
    ],
    options(input.color, 1.8, r, input.seed),
  );
  const svg = svgDocument(CHEVRON.width, CHEVRON.height, stroked(chevron, input.color, 1.8 / STROKE_SCALE));
  return { svg, url: dataUri(svg) };
};

/** How far a checkbox's or radio's focus ring drawing reaches past the 13px control (px). */
export const CHOICE_RING_OUTSET = 5;

/**
 * The focus ring of a 13px checkbox (a rough square) or radio (a rough circle): 2px outside it,
 * drawn on a canvas that covers the control plus `CHOICE_RING_OUTSET` on each side.
 */
export const drawChoiceRing = (input: { readonly shape: 'box' | 'circle'; readonly color: string; readonly rough: Rough; readonly seed: number }): { readonly svg: string; readonly url: string } => {
  const control = 13;
  const size = control + 2 * CHOICE_RING_OUTSET;
  const reach = 2 + 1.5 / 2;
  const at = CHOICE_RING_OUTSET - reach;
  const side = control + 2 * reach;
  const o = options(input.color, 1.5, calm(input.rough), input.seed);
  const ring = input.shape === 'box' ? generator.rectangle(at, at, side, side, o) : generator.circle(size / 2, size / 2, side, o);
  const svg = svgDocument(size, size, stroked(ring, input.color, 1.5));
  return { svg, url: dataUri(svg) };
};

/** The textarea resize grip's canvas (px of the SVG, scaled to the browser's grip). */
export const RESIZER = 15;

/** A textarea resize grip (M7b): two short rough diagonals in `ink`, in the bottom right corner. */
export const drawResizer = (input: { readonly color: string; readonly rough: Rough; readonly seed: number }): { readonly svg: string; readonly url: string } => {
  const r = { ...input.rough, roughness: input.rough.roughness * 0.5, maxRandomnessOffset: 0.6 };
  const lines = [
    generator.line(4, 13, 13, 4, options(input.color, 1.4, r, input.seed)),
    generator.line(8.5, 13, 13, 8.5, options(input.color, 1.4, r, input.seed + 1)),
  ];
  const svg = svgDocument(RESIZER, RESIZER, lines.map((line) => stroked(line, input.color, 1.4)).join(''));
  return { svg, url: dataUri(svg) };
};

import type { Plugin, PluginCreator, Result, Root, Rule } from 'postcss';
import { drawingName } from './draw/hash';
import { drawFocusNineSlice, drawNineSlice, drawStrip, geometryFor, nineSlicePlacement, stripGeometry, underlinePlacement } from './draw/stroke';
import { FLIPS, type Flip } from './draw/svg';
import { type BorderImage, type HatchLook, type Look, type Slot, createInserter, emitInline, removeControl } from './emit/emit';
import { drawHatchTile } from './draw/hatch';
import { type NamedDrawing, emitVariants } from './emit/variants';
import { scopeOf } from './gather/colors';
import { type DrawRequest, type Emission, SEEDS, anchorOf, gather } from './gather/gather';
import { UNDERLINE_WIDTH } from './gather/request';
import { type BaseColors, type ResolvedOptions, baseOf, hatchOf, resolveOptions, type SketchifyOptions } from './options';
import { type BaseDrawings, type ThemeDrawings, baseCss, expandBase, findBase, inBase, markLinkLines } from './emit/base';
import { CHOICE_RING_OUTSET, drawCheckbox, drawChevron, drawChoiceRing, drawRadio, drawResizer } from './draw/controls';
import { collect } from './read/collect';
import { variableDefs } from './read/variables';
import { type Diagnostic, isError, position } from './report/diagnostics';

export type { BaseColors, HatchOptions, HatchPreset, RoughnessPreset, SketchifyOptions } from './options';

const formatDiagnostic = (diagnostic: Diagnostic): string => {
  const at = position(diagnostic.node);
  return at ? `${at} ${diagnostic.message}` : diagnostic.message;
};

/**
 * Fails the build once with every error, or reports warnings. The error points at the first
 * problem (file:line:column); with several, each one is listed with its own line:column.
 */
const report = (root: Root, result: Result, diagnostics: ReadonlyArray<Diagnostic>): void => {
  const errors = diagnostics.filter(isError);
  const [first] = errors;
  if (first) {
    const message = errors.length === 1 ? first.message : [`오류 ${errors.length}개`, ...errors.map(formatDiagnostic)].join('\n');
    throw (first.node ?? root).error(message, { plugin: 'postcss-sketchify' });
  }
  diagnostics.forEach((diagnostic) => result.warn(diagnostic.message, diagnostic.node ? { node: diagnostic.node } : {}));
};

/** The base's control drawings for one set of colours: every neighbour slot, unchecked and checked. */
const themeDrawings = (colors: BaseColors, rough: ResolvedOptions['rough'], nameOf: (url: string) => string): ThemeDrawings => {
  const slots = (draw: (seed: number, flip: Flip) => string): ReadonlyArray<Slot> =>
    SEEDS.flatMap((seed, s) => FLIPS.map((flip, f) => ({ seed: s, flip: f, drawing: nameOf(draw(seed, flip)) })));
  const control = (checked: boolean) => (seed: number) => ({ ink: colors.ink, accent: colors.accent, checked, rough, seed });
  return {
    arrow: drawChevron({ color: colors.ink, rough, seed: SEEDS[0] }).url,
    checkbox: slots((seed, flip) => drawCheckbox(control(false)(seed), flip).url),
    checkboxChecked: slots((seed, flip) => drawCheckbox(control(true)(seed), flip).url),
    radio: slots((seed, flip) => drawRadio(control(false)(seed), flip).url),
    radioChecked: slots((seed, flip) => drawRadio(control(true)(seed), flip).url),
    fieldFocus: slots((seed, flip) => drawFocusNineSlice(focusedField(colors.accent, rough, seed), flip).url),
    checkboxRing: nameOf(drawChoiceRing({ shape: 'box', color: colors.accent, rough, seed: SEEDS[0] }).url),
    radioRing: nameOf(drawChoiceRing({ shape: 'circle', color: colors.accent, rough, seed: SEEDS[0] }).url),
    buttonFocus: slots((seed, flip) => drawFocusNineSlice(focusedButton(colors.accent, rough, seed), flip).url),
    // The link underline is M6d's: the one-sided line's drawing at the bottom.
    link: nameOf(drawStrip({ side: 'bottom', width: UNDERLINE_WIDTH, color: colors.accent, rough, seed: SEEDS[0] }).url),
    resizer: drawResizer({ color: colors.ink, rough, seed: SEEDS[0] }).url,
  };
};

/** A base button's border (1px, radius 6) in the accent colour, as drawn when focused. */
const focusedButton = (color: string, rough: ResolvedOptions['rough'], seed: number) => ({ width: 1, radius: 6, color, rough, seed });

/** A base field's border (1px, radius 4) in the accent colour, as drawn when focused. */
const focusedField = (color: string, rough: ResolvedOptions['rough'], seed: number) => ({ width: 1, radius: 4, color, rough, seed });

const focusPlacements = (rough: ResolvedOptions['rough']) => ({
  field: drawFocusNineSlice(focusedField('#000', rough, SEEDS[0])).placement,
  choiceOutset: CHOICE_RING_OUTSET,
  button: drawFocusNineSlice(focusedButton('#000', rough, SEEDS[0])).placement,
  link: underlinePlacement(UNDERLINE_WIDTH),
});

const baseDrawings = (options: ResolvedOptions, nameOf: (url: string) => string): BaseDrawings => {
  const colors = baseOf(options);
  return {
    light: themeDrawings(colors, options.rough, nameOf),
    ...(colors.dark ? { dark: themeDrawings(colors.dark, options.rough, nameOf) } : {}),
  };
};

/** One hatch tile per colour (neighbours differ by the tile's shift, not by seed). */
const HATCH_SEED = 7;

const sketchify = (options: SketchifyOptions = {}): Plugin => ({
  postcssPlugin: 'postcss-sketchify',
  Once: (root, { result }) => {
    const resolved = resolveOptions(options);
    report(root, result, resolved.diagnostics);
    const named = new Map<string, string>();
    const nameOf = (url: string): string => {
      const name = drawingName(url);
      const existing = named.get(name);
      if (existing !== undefined && existing !== url) {
        throw root.error(`postcss-sketchify: two drawings got the same name ${name}. Please report this.`, { plugin: 'postcss-sketchify' });
      }
      named.set(name, url);
      return name;
    };

    // `@sketchify base` (M7a) first: its outlines are then drawn like any other border.
    const base = findBase(root);
    report(root, result, base.diagnostics);
    if (base.value) expandBase(base.value, baseCss(baseOf(resolved.value), baseDrawings(resolved.value, nameOf), focusPlacements(resolved.value.rough)));

    const facts = collect(root);
    const emissions = gather(facts.value, scopeOf(variableDefs(root)), resolved.value);
    report(root, result, [...facts.diagnostics, ...emissions.diagnostics]);

    const drawingUrl = (request: DrawRequest, flip: Flip): string => {
      switch (request.kind) {
        case 'nine-slice':
          return drawNineSlice(request, flip).url;
        case 'strip':
          return drawStrip(request, flip).url;
        case 'underline':
          // The one-sided line's drawing, at the bottom (M6d).
          return drawStrip({ side: 'bottom', width: request.width, color: request.color, rough: request.rough, seed: request.seed }, flip).url;
        default: {
          const unreachable: never = request;
          return unreachable;
        }
      }
    };
    const placementOf = (request: DrawRequest) => {
      switch (request.kind) {
        case 'nine-slice':
          return nineSlicePlacement(geometryFor(request), request.fill !== undefined);
        case 'strip':
          return stripGeometry(request.width, request.side).placement;
        case 'underline':
          return underlinePlacement(request.width);
        default: {
          const unreachable: never = request;
          return unreachable;
        }
      }
    };

    // Each drawing is made once per file and stored once, under a name taken from its content.
    const drawings = new Map<string, string>();
    const draw = (request: DrawRequest, flip: Flip): string => {
      const key = JSON.stringify([request, flip]);
      const cached = drawings.get(key);
      if (cached) return cached;
      const drawing = drawingUrl(request, flip);
      drawings.set(key, drawing);
      return drawing;
    };

    const imageFor = (request: DrawRequest, mix: boolean): BorderImage => {
      const placement = placementOf(request);
      if (!mix) return { kind: 'fixed', placement, drawing: nameOf(draw(request, 'none')) };
      const slots = SEEDS.flatMap((seed, s) =>
        FLIPS.map((flip, f) => ({ seed: s, flip: f, drawing: nameOf(draw({ ...request, seed }, flip)) })),
      );
      return { kind: 'mixed', placement, slots };
    };

    const filled = (request: DrawRequest): boolean => request.kind === 'nine-slice' && request.fill !== undefined;
    // A drawn underline (M6d) turns the browser's off.
    const hideOf = (request: DrawRequest) => (request.kind === 'underline' ? { underline: { kind: 'hide' as const } } : {});
    const exactOf = (request: DrawRequest) => (request.kind === 'nine-slice' && request.fill?.kind === 'hatch' ? { exact: true } : {});
    const hatch = hatchOf(resolved.value);
    const tileFor = (color: string | undefined): HatchLook => {
      if (color === undefined) return { kind: 'none' };
      const tile = drawHatchTile(color, hatch, HATCH_SEED);
      return { kind: 'tile', tile: nameOf(tile.url), size: tile.size };
    };
    const extras = (outcome: Emission['outcome']) => ({
      ...(outcome.background === undefined ? {} : { background: outcome.background }),
      ...(outcome.hatch ? { hatch: tileFor(outcome.hatch.color) } : {}),
      ...(outcome.underline ? { underline: outcome.underline } : {}),
    });
    // With a base in the file (M7a), a page rule that draws a border may draw a form field's: there
    // the base's focus ring does not show, so the browser's outline must stay.
    const keepOutline = (rule: Rule) => (base.value !== undefined && !inBase(rule) ? { keepOutline: true } : {});
    const lookOf = (outcome: Emission['outcome'], mix: boolean, rule?: Rule): Look => {
      switch (outcome.kind) {
        case 'draw':
          return {
            kind: 'image',
            image: imageFor(outcome.request, mix),
            filled: filled(outcome.request),
            ...exactOf(outcome.request),
            ...extras(outcome),
            ...hideOf(outcome.request),
            ...(rule ? keepOutline(rule) : {}),
          };
        case 'plain':
          return { kind: 'plain', colors: outcome.colors, ...extras(outcome) };
        case 'paint':
          return { kind: 'paint', ...extras(outcome) };
        default: {
          const unreachable: never = outcome;
          return unreachable;
        }
      }
    };
    const paints = (outcome: Emission['outcome']): boolean =>
      outcome.background !== undefined ||
      outcome.hatch !== undefined ||
      outcome.underline !== undefined ||
      (outcome.kind === 'draw' && outcome.request.kind === 'underline') ||
      (outcome.kind === 'draw' && filled(outcome.request));
    const insert = createInserter();
    emissions.value.forEach((emission) => {
      const { facts: rule, outcome, important, mix } = emission;
      const anchor = anchorOf(rule, paints(outcome));
      if (emission.placement === 'inline') {
        if (anchor) emitInline(anchor, lookOf(outcome, mix, rule.rule), important);
      } else {
        insert(rule.rule, emission.conditions, emission.selector, lookOf(outcome, mix, rule.rule), important, true);
      }
      // Conditions (dark mode, …) whose variables change this drawing: right after it.
      if (outcome.kind === 'draw') {
        outcome.variants.forEach((variant) => {
          const look: Look = variant.request
            ? { kind: 'image', image: imageFor(variant.request, mix), filled: filled(variant.request), ...exactOf(variant.request), ...hideOf(variant.request) }
            : { kind: 'none' };
          insert(rule.rule, [...emission.conditions, ...variant.conditions], emission.selector, look, important, false);
        });
      }
      // …and whose variables change the hatch colour: only the tile changes.
      outcome.hatch?.variants.forEach((variant) => {
        insert(rule.rule, [...emission.conditions, ...variant.conditions], emission.selector, { kind: 'paint', hatch: tileFor(variant.color) }, important, false);
      });
    });
    // With a base (M7b): page rules that set a link's `text-decoration` turn the base underline off there.
    if (base.value) markLinkLines(facts.value.map((f) => f.rule));
    facts.value.forEach(removeControl);
    const stored: ReadonlyArray<NamedDrawing> = [...named].map(([name, url]) => ({ name, url }));
    emitVariants(
      root,
      stored,
      base.value !== undefined || emissions.value.some((emission) => emission.mix && emission.outcome.kind === 'draw'),
      emissions.value.some((emission) => emission.outcome.hatch !== undefined),
    );
  },
});

sketchify.postcss = true as const;

// Compile-time check that the export satisfies PostCSS's plugin contract.
const _creator: PluginCreator<SketchifyOptions> = sketchify;

export default sketchify;

import type { Plugin, PluginCreator, Result, Root } from 'postcss';
import { drawingName } from './draw/hash';
import { drawNineSlice, drawStrip, nineSliceGeometry, nineSlicePlacement, stripGeometry } from './draw/stroke';
import { FLIPS, type Flip } from './draw/svg';
import { type BorderImage, type Look, createInserter, emitInline, removeControl } from './emit/emit';
import { type NamedDrawing, emitVariants } from './emit/variants';
import { scopeOf } from './gather/colors';
import { type DrawRequest, type Emission, SEEDS, anchorOf, gather } from './gather/gather';
import { resolveOptions, type SketchifyOptions } from './options';
import { collect } from './read/collect';
import { variableDefs } from './read/variables';
import { type Diagnostic, isError, position } from './report/diagnostics';

export type { RoughnessPreset, SketchifyOptions } from './options';

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

const sketchify = (options: SketchifyOptions = {}): Plugin => ({
  postcssPlugin: 'postcss-sketchify',
  Once: (root, { result }) => {
    const resolved = resolveOptions(options);
    report(root, result, resolved.diagnostics);
    const facts = collect(root);
    const emissions = gather(facts.value, scopeOf(variableDefs(root)), resolved.value);
    report(root, result, [...facts.diagnostics, ...emissions.diagnostics]);

    // Each drawing is made once per file and stored once, under a name taken from its content.
    const drawings = new Map<string, string>();
    const draw = (request: DrawRequest, flip: Flip): string => {
      const key = JSON.stringify([request, flip]);
      const cached = drawings.get(key);
      if (cached) return cached;
      const drawing = request.kind === 'nine-slice' ? drawNineSlice(request, flip).url : drawStrip(request, flip).url;
      drawings.set(key, drawing);
      return drawing;
    };
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

    const imageFor = (request: DrawRequest, mix: boolean): BorderImage => {
      const placement =
        request.kind === 'nine-slice'
          ? nineSlicePlacement(nineSliceGeometry(request.width, request.radius))
          : stripGeometry(request.width, request.side).placement;
      if (!mix) return { kind: 'fixed', placement, drawing: nameOf(draw(request, 'none')) };
      const slots = SEEDS.flatMap((seed, s) =>
        FLIPS.map((flip, f) => ({ seed: s, flip: f, drawing: nameOf(draw({ ...request, seed }, flip)) })),
      );
      return { kind: 'mixed', placement, slots };
    };

    const lookOf = (outcome: Emission['outcome'], mix: boolean): Look =>
      outcome.kind === 'draw' ? { kind: 'image', image: imageFor(outcome.request, mix) } : { kind: 'plain', colors: outcome.colors };
    const insert = createInserter();
    emissions.value.forEach((emission) => {
      const { facts: rule, outcome, important, mix } = emission;
      const anchor = anchorOf(rule);
      if (emission.placement === 'inline') {
        if (anchor) emitInline(anchor, lookOf(outcome, mix), important);
      } else {
        insert(rule.rule, emission.conditions, emission.selector, lookOf(outcome, mix), important, true);
      }
      // Conditions (dark mode, …) whose variables change this drawing: right after it.
      if (outcome.kind === 'draw') {
        outcome.variants.forEach((variant) => {
          const look: Look = variant.request ? { kind: 'image', image: imageFor(variant.request, mix) } : { kind: 'none' };
          insert(rule.rule, [...emission.conditions, ...variant.conditions], emission.selector, look, important, false);
        });
      }
    });
    facts.value.forEach(removeControl);
    const stored: ReadonlyArray<NamedDrawing> = [...named].map(([name, url]) => ({ name, url }));
    emitVariants(root, stored, emissions.value.some((emission) => emission.mix && emission.outcome.kind === 'draw'));
  },
});

sketchify.postcss = true as const;

// Compile-time check that the export satisfies PostCSS's plugin contract.
const _creator: PluginCreator<SketchifyOptions> = sketchify;

export default sketchify;

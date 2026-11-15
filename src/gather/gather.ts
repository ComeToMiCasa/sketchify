// From rules to what to write (spec "여러 규칙에 걸친 테두리"). Pure.
//
// Each rule draws what the original CSS shows for an element it matches alone (with its parent
// rules). Elements that several rules match together (a modifier and a state, a modifier in a
// media query) get a combination rule when the drawings already written would show something
// else than the original CSS.
import type { Declaration } from 'postcss';
import type { ResolvedOptions } from '../options';
import { type RuleFacts, isBackgroundProp, isBorderLineProp, isBorderProp, isSizeProp, isUnderlineProp, parseFillMode } from '../read/collect';
import { parseSizeHint } from '../read/values';
import { isInlineByType, selectorText } from '../read/selectors';
import type { Condition } from '../read/variables';
import type { Diagnostic, Result } from '../report/diagnostics';
import {
  type Element,
  type Evaluated,
  type Family,
  type Item,
  type Outcome,
  appliesTo,
  conditionsOf,
  elementKey,
  elementOf,
  elementOfItem,
  evaluate,
  familiesOf,
  isSelfContained,
  itemsOf,
  parentsOf,
} from './cascade';
import { type Scope, ambiguousSelectorError, classThemeError, familyTooLargeError, invalidFillError, invalidSizeError, invalidSketchError, parentlessError } from './colors';
import { type Candidate, combinations, needsRule, winner } from './combos';

export { type ConditionVariant, type DrawRequest, type NineSliceRequest, SEEDS, requestFor } from './request';

/** Members a parent rule may have before combinations get too many (2^n). */
export const MAX_MEMBERS = 16;

/** Something to write: a drawing or a plain border, in a rule or as a new rule after one. */
export type Emission = {
  /** `inline`: in the rule itself. `after`: a new rule with `selector`, after the rule. */
  readonly placement: 'inline' | 'after';
  readonly facts: RuleFacts;
  readonly selector: string;
  /** The element's conditions; the emitter wraps the ones not already around the rule. */
  readonly conditions: ReadonlyArray<Condition>;
  readonly outcome: Exclude<Outcome, { readonly kind: 'leave' }>;
  readonly important: boolean;
  /** Picks among neighbour variants (not for pseudo-elements, see M2). */
  readonly mix: boolean;
};

const withoutBackground = (outcome: Exclude<Outcome, { readonly kind: 'leave' }>): Outcome => {
  const { background: _background, ...rest } = outcome;
  return rest;
};

/** Without the underline's `off`/`native` (nothing to undo where no drawn underline reaches). */
const withoutOff = (outcome: Outcome): Outcome => {
  if (outcome.kind === 'leave' || outcome.underline === undefined) return outcome;
  const { underline: _underline, ...rest } = outcome;
  return rest;
};

/** Where new declarations go in a rule: after its last border declaration (or variable, or size for an exact hatch). */
export const anchorOf = (facts: RuleFacts, paints = false): Declaration | undefined =>
  // A drawn fill (or a restored background) must come after the background declarations too:
  // a later `background` shorthand would set the colour again.
  // An underline (M6d) also comes after the rule's own `text-decoration`, which it turns off.
  (paints
    ? facts.decls.filter((d) => isBorderLineProp(d.prop.toLowerCase()) || isBackgroundProp(d.prop) || /^text-decoration/i.test(d.prop)).at(-1)
    : undefined) ??
  facts.lastBorderDecl ??
  facts.decls.filter((d) => isBorderProp(d.prop)).at(-1) ??
  facts.decls.filter((d) => d.prop.startsWith('--')).at(-1) ??
  facts.decls.filter((d) => isSizeProp(d.prop)).at(-1) ??
  facts.decls.filter((d) => isUnderlineProp(d.prop)).at(-1);

/** The rule's selector as written, or resolved in full when the rule is nested (CSS nesting). */
const ruleSelector = (facts: RuleFacts): string =>
  facts.rule.parent?.type === 'rule' ? facts.entries.map(selectorText).join(', ') : facts.rule.selector;

const hasShorthand = (facts: RuleFacts): boolean => facts.decls.some((d) => /^border(-(top|right|bottom|left))?$/i.test(d.prop));

const itemKey = (item: Item): string => `${item.facts.order}:${item.index}`;

const latest = (items: ReadonlyArray<Item>): Item | undefined =>
  items.reduce<Item | undefined>((best, item) => (!best || item.facts.order > best.facts.order || (item.facts.order === best.facts.order && item.index > best.index) ? item : best), undefined);

/** Errors for partial rules that cannot get the rest of their border from a parent in their selector. */
const partialErrors = (items: ReadonlyArray<Item>, complete: ReadonlyArray<Item>): ReadonlyArray<Diagnostic> => {
  const errors = items
    .filter((item) => item.facts.partial)
    .flatMap((item): ReadonlyArray<Diagnostic> => {
      const at = item.facts.lastBorderDecl;
      if (!at) return [];
      if (item.entry.ambiguous) return [ambiguousSelectorError(at)];
      return parentsOf(item, complete).length === 0 ? [parentlessError(at, selectorText(item.entry))] : [];
    });
  return errors.filter((e, i) => errors.findIndex((o) => o.node === e.node && o.message === e.message) === i);
};

/** Variables the family's borders read that a rule outside the family changes (class themes). */
const themeErrors = (family: Family, scope: Scope, evaluated: ReadonlyArray<Evaluated>): ReadonlyArray<Diagnostic> => {
  const rules = new Set([family.base, ...family.members].map((item) => item.facts.rule));
  const reported = new Set<string>();
  return evaluated.flatMap((e) =>
    e.reads.flatMap(({ decl, names }) =>
      names.flatMap((name) => {
        const def = scope.scoped.find((d) => d.name === name && !rules.has(d.rule));
        if (!def || reported.has(name)) return [];
        reported.add(name);
        return [classThemeError(decl, def)];
      }),
    ),
  );
};

type Single = { readonly item: Item; readonly evaluated: Evaluated };

export const gather = (facts: ReadonlyArray<RuleFacts>, scope: Scope, options: ResolvedOptions): Result<ReadonlyArray<Emission>> => {
  const sketchErrors = facts.flatMap((f) => [
    ...(f.sketch.kind === 'invalid' ? [invalidSketchError(f.sketch.decl)] : []),
    ...f.decls
      .filter((d) => d.prop.toLowerCase() === '--sketch-fill')
      .flatMap((d): ReadonlyArray<Diagnostic> => {
        const mode = parseFillMode(d.value);
        return mode.kind === 'invalid' ? [invalidFillError(d)] : [];
      }),
    ...f.decls.filter((d) => d.prop.toLowerCase() === '--sketch-size' && parseSizeHint(d.value).kind === 'invalid').map(invalidSizeError),
  ]);
  const items = itemsOf(facts);
  const complete = items.filter((item) => isSelfContained(item.facts));
  const families = familiesOf(items, scope);
  const tooLarge = families.filter((f) => f.members.length > MAX_MEMBERS);
  const usable = families.filter((f) => f.members.length <= MAX_MEMBERS);
  // A family that only underlines (M6d) and is too large keeps the browser's underlines: an `a`
  // rule easily gathers many `… a` rules, and an underline is not worth failing the build for.
  const reported = tooLarge.filter((f) => isSelfContained(f.base.facts));
  const structural = [
    ...sketchErrors,
    ...partialErrors(items, complete),
    ...reported.flatMap((f) => (f.base.facts.lastBorderDecl ? [familyTooLargeError(f.base.facts.lastBorderDecl, f.members.length, MAX_MEMBERS)] : [])),
  ];

  const applicableTo = (element: Element): ReadonlyArray<Item> => items.filter((item) => appliesTo(item, element));
  const evaluateElement = (element: Element, anchor: Item): Result<Evaluated> =>
    evaluate(applicableTo(element), scope, options, anchorOf(anchor.facts), isInlineByType(element.entry));

  // Each rule (selector) on its own, with its parents.
  const singleItems = [...new Map(usable.flatMap((f) => [f.base, ...f.members]).map((item) => [itemKey(item), item])).values()];
  const singleResults = singleItems.map((item) => ({ item, result: evaluateElement(elementOfItem(item), item) }));
  const singles: ReadonlyArray<Single> = singleResults.map(({ item, result }) => ({ item, evaluated: result.value }));
  const singleErrors = singleResults.flatMap((r) => r.result.diagnostics);

  const draws = singles.filter((s) => s.evaluated.outcome.kind === 'draw');
  const drawingReaches = (element: Element, except?: Item): boolean =>
    draws.some((s) => s.item !== except && appliesTo(s.item, element));
  // Rules whose own drawing paints the background (rough, marker or hatch) and so hides it.
  const fills = singles.filter(({ evaluated: { outcome } }) =>
    (outcome.kind === 'draw' && outcome.request.kind === 'nine-slice' && outcome.request.fill !== undefined) ||
    ((outcome.kind === 'draw' || outcome.kind === 'plain' || outcome.kind === 'paint') && outcome.hatch !== undefined),
  );
  const fillReaches = (element: Element, except?: Item): boolean => fills.some((s) => s.item !== except && appliesTo(s.item, element));
  // Rules whose drawn underline (M6d) turns the browser's off, which another element may need back.
  const lines = singles.filter(({ evaluated: { outcome } }) => outcome.kind === 'draw' && outcome.request.kind === 'underline');
  const underlineReaches = (element: Element, except?: Item): boolean => lines.some((s) => s.item !== except && appliesTo(s.item, element));

  /**
   * What to write for an outcome: a plain border is written only where a drawing reaches the
   * element (to undo it); elsewhere only its background part (hatch, restored colour) is.
   */
  const toWritten = (desired: Outcome, reaches: boolean, fillReaches: boolean, lineReaches: boolean): Emission['outcome'] | undefined => {
    // The original background needs showing again only where another rule's drawn fill hid it.
    const restored = fillReaches || desired.kind === 'leave' ? desired : withoutBackground(desired);
    const outcome = lineReaches ? restored : withoutOff(restored);
    switch (outcome.kind) {
      case 'leave':
        return undefined;
      case 'draw':
      case 'paint':
        return outcome;
      case 'plain': {
        if (reaches) return outcome;
        const paint = {
          ...(outcome.background === undefined ? {} : { background: outcome.background }),
          ...(outcome.hatch ? { hatch: outcome.hatch } : {}),
          ...(outcome.underline ? { underline: outcome.underline } : {}),
        };
        return Object.keys(paint).length > 0 ? { kind: 'paint', ...paint } : undefined;
      }
      default: {
        const unreachable: never = outcome;
        return unreachable;
      }
    }
  };

  const singleLooks = singles.flatMap(({ item, evaluated }): ReadonlyArray<{ readonly item: Item; readonly look: Candidate['look'] }> => {
    const element = elementOfItem(item);
    const written = toWritten(evaluated.outcome, drawingReaches(element, item), fillReaches(element, item), underlineReaches(element, item));
    if (written) return [{ item, look: written }];
    return hasShorthand(item.facts) ? [{ item, look: { kind: 'reset' } }] : [];
  });
  const singleCandidates: ReadonlyArray<Candidate> = singleLooks.map(({ item, look }) => ({
    element: elementOfItem(item),
    look,
    important: item.facts.border.important,
    specificity: item.entry.specificity,
    order: [item.facts.order, 0],
  }));

  // Combinations, family by family, smallest first. Each one that is needed becomes a candidate
  // for the larger ones after it.
  const seen = new Set(singleItems.map((item) => elementKey(elementOfItem(item))));
  type Combo = { readonly element: Element; readonly anchor: Item; readonly evaluated: Evaluated; readonly seq: number };
  const state = usable.reduce<{ readonly candidates: ReadonlyArray<Candidate>; readonly combos: ReadonlyArray<Combo>; readonly errors: ReadonlyArray<Diagnostic> }>(
    (acc, family) =>
      combinations(family.members).reduce((inner, members) => {
        const group = [family.base, ...members];
        const element = elementOf(group);
        const anchor = latest(group);
        if (!element || !anchor) return inner;
        const key = elementKey(element);
        if (seen.has(key)) return inner;
        seen.add(key);
        const result = evaluateElement(element, anchor);
        const needed = needsRule(result.value.outcome, winner(inner.candidates, element), drawingReaches(element));
        if (!needed || result.value.outcome.kind === 'leave') return { ...inner, errors: [...inner.errors, ...result.diagnostics] };
        const seq = inner.combos.length + 1;
        const candidate: Candidate = {
          element,
          look: result.value.outcome,
          important: result.value.important,
          specificity: element.entry.specificity,
          order: [anchor.facts.order, seq],
        };
        return {
          candidates: [...inner.candidates, candidate],
          combos: [...inner.combos, { element, anchor, evaluated: result.value, seq }],
          errors: [...inner.errors, ...result.diagnostics],
        };
      }, acc),
    { candidates: singleCandidates, combos: [], errors: [] },
  );

  const themes = usable.flatMap((family) => {
    const members = new Set([family.base, ...family.members]);
    const own = singles.filter((s) => members.has(s.item)).map((s) => s.evaluated);
    const combos = state.combos.filter((c) => members.has(c.anchor)).map((c) => c.evaluated);
    return themeErrors(family, scope, [...own, ...combos]);
  });

  const diagnostics = dedupe([...structural, ...singleErrors, ...state.errors, ...themes]);
  if (diagnostics.length > 0) return { value: [], diagnostics };

  // Rules: in the rule itself when all its selectors look the same, else one rule per selector.
  const looks = new Map(singleLooks.map(({ item, look }) => [itemKey(item), look]));
  const ruleEmissions = facts.flatMap((f): ReadonlyArray<Emission> => {
    const own = singles.flatMap((s) => {
      const look = looks.get(itemKey(s.item));
      return s.item.facts === f && look && look.kind !== 'reset' ? [{ item: s.item, outcome: look }] : [];
    });
    if (own.length === 0) return [];
    const keys = new Set(own.map((s) => JSON.stringify(s.outcome)));
    const whole = keys.size === 1 && own.length === f.entries.length;
    return own.flatMap(({ item, outcome }): ReadonlyArray<Emission> => {
      if (whole && item !== own[0]?.item) return [];
      return [
        {
          placement: whole ? 'inline' : 'after',
          facts: f,
          selector: whole ? ruleSelector(f) : selectorText(item.entry),
          conditions: conditionsOf(f),
          outcome,
          important: f.border.important,
          mix: whole ? !f.pseudoElement : item.entry.pseudoElement === '',
        },
      ];
    });
  });

  const comboEmissions = [...state.combos]
    .sort((a, b) => a.anchor.facts.order - b.anchor.facts.order || a.seq - b.seq)
    .flatMap(({ element, anchor, evaluated }): ReadonlyArray<Emission> => {
      const outcome = toWritten(evaluated.outcome, drawingReaches(element), fillReaches(element), underlineReaches(element));
      return outcome
        ? [
            {
              placement: 'after',
              facts: anchor.facts,
              selector: selectorText(element.entry),
              conditions: element.conditions,
              outcome,
              important: evaluated.important,
              mix: element.entry.pseudoElement === '',
            },
          ]
        : [];
    });

  return { value: [...ruleEmissions, ...comboEmissions], diagnostics: [] };
};

const dedupe = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlyArray<Diagnostic> =>
  diagnostics.filter((d, i) => diagnostics.findIndex((o) => o.node === d.node && o.message === d.message) === i);

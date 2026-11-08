// From rules to what to write (spec "여러 규칙에 걸친 테두리"). Pure.
//
// Each rule draws what the original CSS shows for an element it matches alone (with its parent
// rules). Elements that several rules match together (a modifier and a state, a modifier in a
// media query) get a combination rule when the drawings already written would show something
// else than the original CSS.
import type { Declaration } from 'postcss';
import type { ResolvedOptions } from '../options';
import { type RuleFacts, isBorderProp } from '../read/collect';
import { selectorText } from '../read/selectors';
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
  outcomeKey,
  parentsOf,
} from './cascade';
import { type Scope, ambiguousSelectorError, classThemeError, familyTooLargeError, invalidSketchError, parentlessError } from './colors';
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

/** Where new declarations go in a rule: after its last border declaration (or variable). */
export const anchorOf = (facts: RuleFacts): Declaration | undefined =>
  facts.lastBorderDecl ??
  facts.decls.filter((d) => isBorderProp(d.prop)).at(-1) ??
  facts.decls.filter((d) => d.prop.startsWith('--')).at(-1);

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
  const sketchErrors = facts.flatMap((f) => (f.sketch.kind === 'invalid' ? [invalidSketchError(f.sketch.decl)] : []));
  const items = itemsOf(facts);
  const complete = items.filter((item) => isSelfContained(item.facts));
  const families = familiesOf(items, scope);
  const tooLarge = families.filter((f) => f.members.length > MAX_MEMBERS);
  const usable = families.filter((f) => f.members.length <= MAX_MEMBERS);
  const structural = [
    ...sketchErrors,
    ...partialErrors(items, complete),
    ...tooLarge.flatMap((f) => (f.base.facts.lastBorderDecl ? [familyTooLargeError(f.base.facts.lastBorderDecl, f.members.length, MAX_MEMBERS)] : [])),
  ];

  const applicableTo = (element: Element): ReadonlyArray<Item> => items.filter((item) => appliesTo(item, element));
  const evaluateElement = (element: Element, anchor: Item): Result<Evaluated> =>
    evaluate(applicableTo(element), scope, options, anchorOf(anchor.facts));

  // Each rule (selector) on its own, with its parents.
  const singleItems = [...new Map(usable.flatMap((f) => [f.base, ...f.members]).map((item) => [itemKey(item), item])).values()];
  const singleResults = singleItems.map((item) => ({ item, result: evaluateElement(elementOfItem(item), item) }));
  const singles: ReadonlyArray<Single> = singleResults.map(({ item, result }) => ({ item, evaluated: result.value }));
  const singleErrors = singleResults.flatMap((r) => r.result.diagnostics);

  const draws = singles.filter((s) => s.evaluated.outcome.kind === 'draw');
  const drawingReaches = (element: Element, except?: Item): boolean =>
    draws.some((s) => s.item !== except && appliesTo(s.item, element));

  const singleLooks = singles.flatMap(({ item, evaluated }): ReadonlyArray<{ readonly item: Item; readonly look: Candidate['look'] }> => {
    const { outcome } = evaluated;
    if (outcome.kind === 'draw') return [{ item, look: outcome }];
    if (outcome.kind === 'plain' && drawingReaches(elementOfItem(item), item)) return [{ item, look: outcome }];
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
    const own = singles.filter((s) => s.item.facts === f && looks.get(itemKey(s.item))?.kind !== 'reset' && looks.has(itemKey(s.item)));
    if (own.length === 0) return [];
    const keys = new Set(own.map((s) => outcomeKey(s.evaluated.outcome)));
    const whole = keys.size === 1 && own.length === f.entries.length;
    return own.flatMap(({ item, evaluated }): ReadonlyArray<Emission> => {
      const { outcome } = evaluated;
      if (outcome.kind === 'leave') return [];
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
    .flatMap(({ element, anchor, evaluated }): ReadonlyArray<Emission> =>
      evaluated.outcome.kind === 'leave'
        ? []
        : [
            {
              placement: 'after',
              facts: anchor.facts,
              selector: selectorText(element.entry),
              conditions: element.conditions,
              outcome: evaluated.outcome,
              important: evaluated.important,
              mix: element.entry.pseudoElement === '',
            },
          ],
    );

  return { value: [...ruleEmissions, ...comboEmissions], diagnostics: [] };
};

const dedupe = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlyArray<Diagnostic> =>
  diagnostics.filter((d, i) => diagnostics.findIndex((o) => o.node === d.node && o.message === d.message) === i);

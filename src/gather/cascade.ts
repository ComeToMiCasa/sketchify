// The cascade across rules (spec "여러 규칙에 걸친 테두리"). Pure.
//
// The principle: draw what the original CSS would show. An "element" is a combination of
// selectors that can match one element together (a parent rule, its modifiers, states and
// same-selector rules in `@media`). For each element, every rule that surely applies is put
// through the CSS cascade (importance, specificity, source order); the result is the drawing.
import type { Declaration } from 'postcss';
import type { ResolvedOptions } from '../options';
import { type BorderState, type RuleFacts, borderOf, isBorderProp } from '../read/collect';
import { type SelectorEntry, type Specificity, compareSpecificity, contains, unionEntries } from '../read/selectors';
import { SIDES, usesVar } from '../read/values';
import { type Condition, isSketchControl } from '../read/variables';
import type { Diagnostic, Result } from '../report/diagnostics';
import { type Scope, conditionUndrawableError, currentColorError, lookupFor, missingVarError, substitute } from './colors';
import { type ConditionVariant, type DrawRequest, allTransparent, blockedByCurrentColor, colorsOf, drawRequestFor } from './request';

/** One complex selector of one rule. A rule with a selector list gives one item per selector. */
export type Item = {
  readonly facts: RuleFacts;
  readonly entry: SelectorEntry;
  /** Index in the rule's selector list. */
  readonly index: number;
};

export const itemsOf = (facts: ReadonlyArray<RuleFacts>): ReadonlyArray<Item> =>
  facts.filter((f) => f.sketch.kind === 'none').flatMap((f) => f.entries.map((entry, index) => ({ facts: f, entry, index })));

const conditionKey = (c: Condition): string => `@${c.name.toLowerCase()} ${c.params}`;

/** The at-rules that decide whether a rule applies: all but `@layer`. */
export const conditionsOf = (facts: RuleFacts): ReadonlyArray<Condition> => facts.atRules.filter((c) => !/^layer$/i.test(c.name));

export const conditionsWithin = (inner: ReadonlyArray<Condition>, outer: ReadonlyArray<Condition>): boolean =>
  inner.every((c) => outer.some((o) => conditionKey(o) === conditionKey(c)));

/** What a combination of items matches: one selector and the conditions under which it applies. */
export type Element = { readonly entry: SelectorEntry; readonly conditions: ReadonlyArray<Condition> };

export const elementKey = (element: Element): string =>
  JSON.stringify([element.entry.context, [...element.entry.compound].sort(), element.entry.pseudoElement, element.conditions.map(conditionKey).sort()]);

export const elementOfItem = (item: Item): Element => ({ entry: item.entry, conditions: conditionsOf(item.facts) });

export const elementOf = (items: ReadonlyArray<Item>): Element | undefined => {
  const entry = unionEntries(items.map((item) => item.entry));
  if (!entry) return undefined;
  const conditions = items.flatMap((item) => conditionsOf(item.facts));
  const unique = conditions.filter((c, i) => conditions.findIndex((o) => conditionKey(o) === conditionKey(c)) === i);
  return { entry, conditions: unique };
};

/** Whether the item's rule surely applies to every element the element describes. */
export const appliesTo = (item: Item, element: Element): boolean =>
  contains(element.entry, item.entry) && conditionsWithin(conditionsOf(item.facts), element.conditions);

/** Every side has width, style and colour, so the rule draws a border on its own. */
export const isComplete = (facts: RuleFacts): boolean =>
  !facts.border.unsupported && SIDES.every((side) => Object.values(facts.border.sides[side]).every((part: { readonly kind: string }) => part.kind !== 'unset'));

/**
 * The rule describes its border on its own: no side is half set, and at least one side is fully
 * set (four sides, or a one-sided line like `border-bottom: 1px solid`). Such a rule can be a parent.
 */
export const isSelfContained = (facts: RuleFacts): boolean =>
  !facts.partial &&
  !facts.border.unsupported &&
  SIDES.some((side) => Object.values(facts.border.sides[side]).every((part: { readonly kind: string }) => part.kind !== 'unset'));

// --- The cascade -------------------------------------------------------------

type Weighted = {
  readonly decl: Declaration;
  readonly important: boolean;
  readonly specificity: Specificity;
  readonly order: number;
  readonly index: number;
};

const precedence = (a: Weighted, b: Weighted): number =>
  Number(a.important) - Number(b.important) || compareSpecificity(a.specificity, b.specificity) || a.order - b.order || a.index - b.index;

/** The applicable rules' declarations, lowest precedence first (so the last one wins). */
const cascadeOrder = (applicable: ReadonlyArray<Item>): ReadonlyArray<Weighted> => {
  // A rule that applies through several selectors of its list counts with the most specific one.
  const byRule = new Map<RuleFacts, Specificity>();
  applicable.forEach((item) => {
    const best = byRule.get(item.facts);
    if (!best || compareSpecificity(item.entry.specificity, best) > 0) byRule.set(item.facts, item.entry.specificity);
  });
  return [...byRule]
    .flatMap(([facts, specificity]) =>
      facts.decls.map((decl, index) => ({ decl, important: decl.important === true, specificity, order: facts.order, index })),
    )
    .sort(precedence);
};

export type Computed = {
  readonly border: BorderState;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  /** Variables each border declaration reads (for the class-theme check). */
  readonly reads: ReadonlyArray<{ readonly decl: Declaration; readonly names: ReadonlyArray<string> }>;
  /** A winning border declaration is `!important`. */
  readonly important: boolean;
};

/** The element's border after the cascade, with `var()` resolved in one environment. */
export const computeBorder = (applicable: ReadonlyArray<Item>, env: ReadonlyMap<string, string>): Computed => {
  const ordered = cascadeOrder(applicable);
  const custom = new Map(
    ordered.filter((w) => w.decl.prop.startsWith('--') && !isSketchControl(w.decl.prop)).map((w) => [w.decl.prop, w.decl.value.trim()] as const),
  );
  const lookup = lookupFor(custom, env);
  const steps = ordered
    .filter((w) => isBorderProp(w.decl.prop))
    .map((w) => {
      const plain = { prop: w.decl.prop, value: w.decl.value, important: w.important };
      if (!usesVar(w.decl.value)) return { decl: plain, diagnostics: [], read: undefined };
      const result = substitute(w.decl.value, lookup);
      const read = { decl: w.decl, names: result.names };
      return result.kind === 'ok'
        ? { decl: { ...plain, value: result.value }, diagnostics: [], read }
        : { decl: plain, diagnostics: [missingVarError(w.decl, result.name, result.cycle)], read };
    });
  const border = borderOf(steps.map((step) => step.decl));
  return {
    border,
    diagnostics: steps.flatMap((step) => step.diagnostics),
    reads: steps.flatMap((step) => (step.read ? [step.read] : [])),
    important: border.important,
  };
};

/** What the element should look like. */
export type Outcome =
  /** A hand-drawn border, with variants for conditions that change its variables. */
  | { readonly kind: 'draw'; readonly request: DrawRequest; readonly variants: ReadonlyArray<ConditionVariant> }
  /** A border the drawing cannot express (dashed, none, mixed colours): shown as the original CSS would. */
  | { readonly kind: 'plain'; readonly colors: string }
  /** Left alone: the rules use `border-image` themselves or logical properties. */
  | { readonly kind: 'leave' };

export const outcomeKey = (outcome: Outcome): string => JSON.stringify(outcome);

export type Evaluated = {
  readonly outcome: Outcome;
  readonly important: boolean;
  readonly reads: Computed['reads'];
};

/** The cascade's result for an element, in the file's values and in each condition's. */
export const evaluate = (
  applicable: ReadonlyArray<Item>,
  scope: Scope,
  options: ResolvedOptions,
  anchor: Declaration | undefined,
): Result<Evaluated> => {
  const base = computeBorder(applicable, scope.base);
  const leave = { outcome: { kind: 'leave' } as const, important: base.important, reads: base.reads };
  if (base.diagnostics.length > 0) return { value: leave, diagnostics: base.diagnostics };
  if (base.border.hasBorderImage || base.border.unsupported) return { value: leave, diagnostics: [] };

  const request = drawRequestFor(base.border, options);
  if (!request) {
    if (blockedByCurrentColor(base.border, options)) return { value: leave, diagnostics: [currentColorError(anchor)] };
    return { value: { outcome: { kind: 'plain', colors: colorsOf(base.border) }, important: base.important, reads: base.reads }, diagnostics: [] };
  }

  const usesVariables = base.reads.length > 0;
  const conditional = usesVariables ? scope.conditional.map((c) => ({ conditions: c.conditions, computed: computeBorder(applicable, c.env) })) : [];
  const outcomes = conditional.map(({ conditions, computed }): Result<ReadonlyArray<ConditionVariant>> => {
    if (computed.diagnostics.length > 0) return { value: [], diagnostics: computed.diagnostics };
    const variant = drawRequestFor(computed.border, options);
    if (variant) return { value: JSON.stringify(variant) === JSON.stringify(request) ? [] : [{ conditions, request: variant }], diagnostics: [] };
    if (allTransparent(computed.border)) return { value: [{ conditions, request: undefined }], diagnostics: [] };
    const error = blockedByCurrentColor(computed.border, options) ? currentColorError(anchor) : conditionUndrawableError(anchor, conditions);
    return { value: [], diagnostics: [error] };
  });
  const diagnostics = outcomes.flatMap((o) => o.diagnostics);
  const reads = [...base.reads, ...conditional.flatMap((c) => c.computed.reads)];
  if (diagnostics.length > 0) return { value: { ...leave, reads }, diagnostics };
  return {
    value: { outcome: { kind: 'draw', request, variants: outcomes.flatMap((o) => o.value) }, important: base.important, reads },
    diagnostics: [],
  };
};

// --- Families ---------------------------------------------------------------

/** A parent rule (complete border, no complete rule above it) and the rules that build on it. */
export type Family = {
  readonly base: Item;
  /** Modifiers, states and condition rules whose selector contains the base, in source order. */
  readonly members: ReadonlyArray<Item>;
};

/** Variable names a value reads, without resolving them. */
const varNames = (value: string): ReadonlyArray<string> => [...value.matchAll(/var\(\s*(--[\w-]+)/gi)].map((m) => m[1] ?? '');

/** Complete rules that surely apply wherever the item applies. */
export const parentsOf = (item: Item, complete: ReadonlyArray<Item>): ReadonlyArray<Item> =>
  complete.filter((p) => p.facts !== item.facts && appliesTo(p, elementOfItem(item)));

/**
 * Groups items under their parent rules. Members are the items whose selector contains the
 * base's and that change the border: border declarations, or variables the border reads.
 */
export const familiesOf = (items: ReadonlyArray<Item>, scope: Scope): ReadonlyArray<Family> => {
  const complete = items.filter((item) => isSelfContained(item.facts));
  const bases = complete.filter((item) => parentsOf(item, complete).length === 0);
  return bases.map((base) => {
    const around = items.filter((item) => item.facts !== base.facts && appliesTo(base, elementOfItem(item)));
    const borderItems = [base, ...around.filter((item) => item.facts.decls.some((d) => isBorderProp(d.prop)))];
    // Variables the border reads, following variables inside variables (root values and members' own).
    const definitions = (name: string): ReadonlyArray<string> => [
      ...[scope.base, ...scope.conditional.map((c) => c.env)].flatMap((env) => (env.has(name) ? [env.get(name) ?? ''] : [])),
      ...[base, ...around].flatMap((item) => item.facts.decls.filter((d) => d.prop === name).map((d) => d.value)),
    ];
    const start = borderItems.flatMap((item) => item.facts.decls.filter((d) => isBorderProp(d.prop)).flatMap((d) => varNames(d.value)));
    const used = closure(start, (name) => definitions(name).flatMap(varNames));
    const members = around.filter(
      (item) => item.facts.decls.some((d) => isBorderProp(d.prop)) || item.facts.decls.some((d) => used.has(d.prop)),
    );
    return { base, members };
  });
};

const closure = (start: ReadonlyArray<string>, next: (name: string) => ReadonlyArray<string>): ReadonlySet<string> => {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const name = queue.pop() ?? '';
    if (!seen.has(name)) {
      seen.add(name);
      queue.push(...next(name));
    }
  }
  return seen;
};

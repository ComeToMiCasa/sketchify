// The cascade across rules (spec "여러 규칙에 걸친 테두리"). Pure.
//
// The principle: draw what the original CSS would show. An "element" is a combination of
// selectors that can match one element together (a parent rule, its modifiers, states and
// same-selector rules in `@media`). For each element, every rule that surely applies is put
// through the CSS cascade (importance, specificity, source order); the result is the drawing.
import type { Declaration } from 'postcss';
import type { ResolvedOptions } from '../options';
import { type BorderState, type RuleFacts, borderOf, isBackgroundProp, isBorderProp, isSizeProp, isUnderlineProp, paintsFill } from '../read/collect';
import { type SelectorEntry, type Specificity, compareSpecificity, contains, unionEntries } from '../read/selectors';
import { SIDES, usesVar } from '../read/values';
import { type Condition, isSketchControl } from '../read/variables';
import type { Diagnostic, Result } from '../report/diagnostics';
import { type Scope, conditionUndrawableError, currentColorError, currentFillColorError, lookupFor, missingVarError, substitute } from './colors';
import {
  type ConditionVariant,
  type DrawRequest,
  allTransparent,
  asksForUnderline,
  backgroundOf,
  blockedByCurrentColor,
  colorsOf,
  drawingFor,
  fillBlockedByImage,
  fillInCurrentColor,
  hatchFor,
  hatchInCurrentColor,
  type PlainReason,
  underlineColorUnknown,
  whyPlain,
} from './request';

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
  (asksForFill(facts) || SIDES.some((side) => Object.values(facts.border.sides[side]).every((part: { readonly kind: string }) => part.kind !== 'unset')));

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
  /** The winning background colour as the CSS wrote it (`var(--fill)`), or the resolved colour. */
  readonly backgroundAsWritten: string;
};

/**
 * Declarations the drawing reads: the border, the background and `--sketch-fill` for fills (M6),
 * and the size for an exact hatch (M6c).
 */
export const isPaintProp = (prop: string): boolean =>
  isBorderProp(prop) || isBackgroundProp(prop) || prop.toLowerCase() === '--sketch-fill' || isSizeProp(prop);

/** The rule asks for a drawn fill (`--sketch-fill: rough | marker | hatch`). */
export const asksForFill = (facts: RuleFacts): boolean => paintsFill(facts.border.fill);

/** The rule asks for a hatch (`--sketch-fill: hatch`). */
const asksForHatch = (facts: RuleFacts): boolean => facts.border.fill.kind === 'mode' && facts.border.fill.mode === 'hatch';

/** Some rule here asks for an underline (M6d), so the text colour, decoration and display matter. */
const underlined = (applicable: ReadonlyArray<Item>): boolean => applicable.some((item) => asksForUnderline(item.facts.border));

/** The element's border after the cascade, with `var()` resolved in one environment. */
export const computeBorder = (applicable: ReadonlyArray<Item>, env: ReadonlyMap<string, string>): Computed => {
  const ordered = cascadeOrder(applicable);
  // The text colour and decoration are read only where an underline is drawn: elsewhere their
  // variables would count as read by the border (class-theme checks, condition variants).
  const reads = underlined(applicable) ? (prop: string): boolean => isPaintProp(prop) || isUnderlineProp(prop) : isPaintProp;
  const custom = new Map(
    ordered.filter((w) => w.decl.prop.startsWith('--') && !isSketchControl(w.decl.prop)).map((w) => [w.decl.prop, w.decl.value.trim()] as const),
  );
  const lookup = lookupFor(custom, env);
  const steps = ordered
    .filter((w) => reads(w.decl.prop))
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
  // The background colour as written (with its `var()`), to show it again where needed.
  const written = borderOf(ordered.filter((w) => isBackgroundProp(w.decl.prop)).map((w) => ({ prop: w.decl.prop, value: w.decl.value, important: w.important })));
  const backgroundAsWritten = written.background.color.kind === 'unknown' && usesVar(written.background.color.css) ? written.background.color.css : backgroundOf(border);
  return {
    border,
    backgroundAsWritten,
    diagnostics: steps.flatMap((step) => step.diagnostics),
    reads: steps.flatMap((step) => (step.read ? [step.read] : [])),
    important: border.important,
  };
};

/** A hatch fill (M6b): its colour, and other colours (or none) under conditions such as dark mode. */
export type HatchOutcome = {
  readonly color: string;
  readonly variants: ReadonlyArray<{ readonly conditions: ReadonlyArray<Condition>; readonly color: string | undefined }>;
};

/**
 * The browser underline where a drawn one (M6d) reaches the element but does not show there:
 * `off` when the element has no underline (a hover that turns it off) and writes back its own
 * `text-decoration-line`; `native` when it has one that cannot be drawn (an inherited colour,
 * dotted, a border of its own), so the browser's underline comes back.
 */
export type UnderlineOutcome =
  /** `line`: the element's own `text-decoration-line` to write back (`none`, `line-through`), if known. */
  | { readonly kind: 'off'; readonly line?: string }
  | { readonly kind: 'native' };

/** The state's `text-decoration-line` as CSS, if known (unset is `none`). */
const lineOf = (border: BorderState): { readonly line?: string } => {
  const line = border.text.line;
  if (line.kind === 'unset') return { line: 'none' };
  return line.kind === 'lines' ? { line: line.lines.join(' ') || 'none' } : {};
};

/** What the element should look like. */
export type Outcome =
  /**
   * A hand-drawn border, with variants for conditions that change its variables. `background`:
   * the original background colour to show again, where a rule's drawn fill (with its
   * `background-color: transparent`) reaches an element that does not get a fill.
   */
  | {
      readonly kind: 'draw';
      readonly request: DrawRequest;
      readonly variants: ReadonlyArray<ConditionVariant>;
      readonly background?: string;
      readonly hatch?: HatchOutcome;
      readonly underline?: UnderlineOutcome;
    }
  /** A border the drawing cannot express (dashed, none, mixed colours): shown as the original CSS would. */
  | { readonly kind: 'plain'; readonly colors: string; readonly background?: string; readonly hatch?: HatchOutcome; readonly underline?: UnderlineOutcome }
  /** Nothing to do for the border (no drawing reaches the element); only its background (hatch, underline). */
  | { readonly kind: 'paint'; readonly background?: string; readonly hatch?: HatchOutcome; readonly underline?: UnderlineOutcome }
  /** Left alone: the rules use `border-image` themselves or logical properties. */
  | { readonly kind: 'leave' };

export const outcomeKey = (outcome: Outcome): string => JSON.stringify(outcome);

/** Things worth a warning about an element's result (M8), apart from why its border is plain. */
export type Note = 'fill-image' | 'underline-color';

export type Evaluated = {
  readonly outcome: Outcome;
  readonly important: boolean;
  readonly reads: Computed['reads'];
  /** Why the border is shown as plain CSS, when it has lines that are not drawn (M8). */
  readonly reason?: PlainReason;
  readonly notes?: ReadonlyArray<Note>;
};

/** The cascade's result for an element, in the file's values and in each condition's. */
export const evaluate = (
  applicable: ReadonlyArray<Item>,
  scope: Scope,
  options: ResolvedOptions,
  anchor: Declaration | undefined,
  inlineByType = false,
): Result<Evaluated> => {
  const base = computeBorder(applicable, scope.base);
  const leave = { outcome: { kind: 'leave' } as const, important: base.important, reads: base.reads };
  if (base.diagnostics.length > 0) return { value: leave, diagnostics: base.diagnostics };
  if (base.border.hasBorderImage || base.border.unsupported) return { value: leave, diagnostics: [] };

  if (hatchInCurrentColor(base.border)) return { value: leave, diagnostics: [currentFillColorError(anchor)] };
  const request = drawingFor(base.border, options, inlineByType);
  const hatch = hatchFor(base.border, options);
  // A rule here draws a fill and hides its background; if this element gets none, show it again.
  const filled = (request?.kind === 'nine-slice' && request.fill !== undefined) || hatch !== undefined;
  const background = !filled && applicable.some((item) => asksForFill(item.facts)) ? { background: base.backgroundAsWritten } : {};
  const usesVariables = base.reads.length > 0;
  const conditional = usesVariables ? scope.conditional.map((c) => ({ conditions: c.conditions, computed: computeBorder(applicable, c.env) })) : [];
  const hatchPart = hatch
    ? {
        hatch: {
          color: hatch.color,
          variants: conditional.flatMap(({ conditions, computed }) => {
            const color = hatchFor(computed.border, options)?.color;
            return color === hatch.color ? [] : [{ conditions, color }];
          }),
        },
      }
    : {};
  const notes: ReadonlyArray<Note> = [
    ...(fillBlockedByImage(base.border) ? (['fill-image'] as const) : []),
    ...(underlineColorUnknown(base.border, inlineByType, options) ? (['underline-color'] as const) : []),
  ];
  const noted = notes.length > 0 ? { notes } : {};
  const underlinePart =
    request?.kind !== 'underline' && underlined(applicable)
      ? { underline: asksForUnderline(base.border) ? { kind: 'native' as const } : { kind: 'off' as const, ...lineOf(base.border) } }
      : {};
  if (!request) {
    if (blockedByCurrentColor(base.border, options)) {
      const error = fillInCurrentColor(base.border) ? currentFillColorError(anchor) : currentColorError(anchor);
      return { value: leave, diagnostics: [error] };
    }
    return {
      value: {
        outcome: { kind: 'plain', colors: colorsOf(base.border), ...background, ...hatchPart, ...underlinePart },
        important: base.important,
        reads: base.reads,
        ...noted,
        ...(whyPlain(base.border, options) ? { reason: whyPlain(base.border, options) } : {}),
      },
      diagnostics: [],
    };
  }

  const outcomes = conditional.map(({ conditions, computed }): Result<ReadonlyArray<ConditionVariant>> => {
    if (computed.diagnostics.length > 0) return { value: [], diagnostics: computed.diagnostics };
    const variant = drawingFor(computed.border, options, inlineByType);
    // An exact hatch must stay one under the condition: the repeated one would not be written there.
    if (variant && exact(request) !== exact(variant)) return { value: [], diagnostics: [conditionUndrawableError(anchor, conditions)] };
    if (variant) return { value: JSON.stringify(variant) === JSON.stringify(request) ? [] : [{ conditions, request: variant }], diagnostics: [] };
    if (allTransparent(computed.border)) return { value: [{ conditions, request: undefined }], diagnostics: [] };
    const error = blockedByCurrentColor(computed.border, options) ? currentColorError(anchor) : conditionUndrawableError(anchor, conditions);
    return { value: [], diagnostics: [error] };
  });
  const diagnostics = outcomes.flatMap((o) => o.diagnostics);
  const reads = [...base.reads, ...conditional.flatMap((c) => c.computed.reads)];
  if (diagnostics.length > 0) return { value: { ...leave, reads }, diagnostics };
  return {
    value: { outcome: { kind: 'draw', request, variants: outcomes.flatMap((o) => o.value), ...background, ...hatchPart, ...underlinePart }, important: base.important, reads, ...noted },
    diagnostics: [],
  };
};

const exact = (request: DrawRequest): boolean => request.kind === 'nine-slice' && request.fill?.kind === 'hatch';

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
  // A rule that asks for an underline (M6d) is a parent too, as long as its border is not half set.
  const complete = items.filter((item) => isSelfContained(item.facts) || (!item.facts.partial && asksForUnderline(item.facts.border)));
  const bases = complete.filter((item) => parentsOf(item, complete).length === 0);
  return bases.map((base) => {
    const around = items.filter((item) => item.facts !== base.facts && appliesTo(base, elementOfItem(item)));
    // Background rules matter only where a rule of the family draws a fill (M6a); size rules only
    // where it draws a hatch, which is exact when the size is known (M6c).
    const fills = [base, ...around].some((item) => asksForFill(item.facts));
    const hatches = [base, ...around].some((item) => asksForHatch(item.facts));
    // Underline families (M6d): the decoration, text colour and display.
    const underlines = [base, ...around].some((item) => asksForUnderline(item.facts.border));
    const paints = (prop: string): boolean =>
      isBorderProp(prop) ||
      (fills && (isBackgroundProp(prop) || prop.toLowerCase() === '--sketch-fill')) ||
      (hatches && isSizeProp(prop)) ||
      (underlines && isUnderlineProp(prop));
    const borderItems = [base, ...around.filter((item) => item.facts.decls.some((d) => paints(d.prop)))];
    // Variables the border reads, following variables inside variables (root values and members' own).
    const definitions = (name: string): ReadonlyArray<string> => [
      ...[scope.base, ...scope.conditional.map((c) => c.env)].flatMap((env) => (env.has(name) ? [env.get(name) ?? ''] : [])),
      ...[base, ...around].flatMap((item) => item.facts.decls.filter((d) => d.prop === name).map((d) => d.value)),
    ];
    const start = borderItems.flatMap((item) => item.facts.decls.filter((d) => paints(d.prop)).flatMap((d) => varNames(d.value)));
    const used = closure(start, (name) => definitions(name).flatMap(varNames));
    const members = around.filter(
      (item) => item.facts.decls.some((d) => paints(d.prop)) || item.facts.decls.some((d) => used.has(d.prop)),
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

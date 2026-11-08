// Which drawing an element shows, and when a combination rule is needed. Pure.
import { type Specificity, compareSpecificity, contains } from '../read/selectors';
import { type Element, type Outcome, conditionsWithin, outcomeKey } from './cascade';

/** A `border-image` the output will have for some element: a drawing, a plain override, or a reset. */
export type Candidate = {
  /** Where it applies. */
  readonly element: Element;
  /** `reset`: an original `border` shorthand that clears `border-image` and is not redrawn. */
  readonly look: Exclude<Outcome, { readonly kind: 'leave' }> | { readonly kind: 'reset' };
  readonly important: boolean;
  readonly specificity: Specificity;
  /** Source position: the rule's order, then the order of rules inserted after it. */
  readonly order: readonly [number, number];
};

const beats = (a: Candidate, b: Candidate): boolean =>
  (Number(a.important) - Number(b.important) ||
    compareSpecificity(a.specificity, b.specificity) ||
    a.order[0] - b.order[0] ||
    a.order[1] - b.order[1]) > 0;

const appliesTo = (candidate: Candidate, element: Element): boolean =>
  contains(element.entry, candidate.element.entry) && conditionsWithin(candidate.element.conditions, element.conditions);

/** The candidate whose `border-image` wins on the element, by importance, specificity and order. */
export const winner = (candidates: ReadonlyArray<Candidate>, element: Element): Candidate | undefined =>
  candidates.filter((c) => appliesTo(c, element)).reduce<Candidate | undefined>((best, c) => (!best || beats(c, best) ? c : best), undefined);

/**
 * Whether the element needs its own rule: what it would show differs from what the original
 * CSS gives. A plain border shows correctly without help only when no drawing (and so no
 * `border-color: transparent`) reaches the element.
 */
export const needsRule = (desired: Outcome, shown: Candidate | undefined, drawingReaches: boolean): boolean => {
  switch (desired.kind) {
    case 'leave':
      return false;
    case 'draw':
      return shown?.look.kind !== 'draw' || outcomeKey(shown.look) !== outcomeKey(desired);
    case 'plain':
      if (shown?.look.kind === 'plain') return shown.look.colors !== desired.colors;
      return shown?.look.kind === 'draw' || drawingReaches;
    default: {
      const unreachable: never = desired;
      return unreachable;
    }
  }
};

/** All subsets of at least two items, smallest first, each in source order. */
export const combinations = <T>(items: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> => {
  const all = items.reduce<ReadonlyArray<ReadonlyArray<T>>>((sets, item) => [...sets, ...sets.map((set) => [...set, item])], [[]]);
  return all.filter((set) => set.length >= 2).sort((a, b) => a.length - b.length);
};

// Selector analysis for the cascade (spec "여러 규칙에 걸친 테두리"). Pure: selector text in,
// plain data out. postcss-selector-parser only ever gets text here (see eslint.config.js).
import parser from 'postcss-selector-parser';

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements] */
export type Specificity = readonly [number, number, number];

/** One complex selector of a rule's selector list. */
export type SelectorEntry = {
  /** Everything before the subject compound, with its combinator (`.toolbar `), or ''. */
  readonly context: string;
  /** Simple selectors of the subject compound, type selector first, without the pseudo-element. */
  readonly compound: ReadonlyArray<string>;
  /** `::before` etc. (legacy one-colon forms normalised), or ''. */
  readonly pseudoElement: string;
  readonly specificity: Specificity;
  /** The subject compound has `:is()`/`:where()` with more than one candidate. */
  readonly ambiguous: boolean;
};

const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([':before', ':after', ':first-line', ':first-letter']);
const LIST_PSEUDOS: ReadonlySet<string> = new Set([':is', ':where', ':matches', ':-webkit-any', ':-moz-any']);
const MAX_ARG_PSEUDOS: ReadonlySet<string> = new Set([':is', ':matches', ':-webkit-any', ':-moz-any', ':not', ':has']);

const isPseudoElement = (node: parser.Pseudo): boolean =>
  node.value.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(node.value.toLowerCase());

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const ZERO: Specificity = [0, 0, 0];

export const compareSpecificity = (a: Specificity, b: Specificity): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const maxSpecificity = (list: ReadonlyArray<Specificity>): Specificity =>
  list.reduce<Specificity>((best, s) => (compareSpecificity(s, best) > 0 ? s : best), ZERO);

const nodeSpecificity = (node: parser.Node): Specificity => {
  if (node.type === 'id') return [1, 0, 0];
  if (node.type === 'class' || node.type === 'attribute') return [0, 1, 0];
  if (node.type === 'tag') return [0, 0, 1];
  if (node.type !== 'pseudo') return ZERO;
  if (isPseudoElement(node)) return [0, 0, 1];
  const name = node.value.toLowerCase();
  if (name === ':where') return ZERO;
  return MAX_ARG_PSEUDOS.has(name) ? maxSpecificity(node.nodes.map(selectorSpecificity)) : [0, 1, 0];
};

const selectorSpecificity = (selector: parser.Selector): Specificity =>
  selector.nodes.reduce<Specificity>((sum, node) => add(sum, nodeSpecificity(node)), ZERO);

/** Normalised text of a simple selector, for comparing compounds. */
const simpleText = (node: parser.Node): string => {
  const text = String(node).trim();
  if (node.type === 'tag') return text.toLowerCase();
  if (node.type === 'pseudo') return node.value.toLowerCase() + text.slice(node.value.length);
  return text;
};

const contextText = (nodes: ReadonlyArray<parser.Node>): string =>
  nodes
    .map((node) => {
      if (node.type !== 'combinator') return simpleText(node);
      const value = node.value.trim();
      return value === '' ? ' ' : ` ${value} `;
    })
    .join('');

const entryOf = (selector: parser.Selector): SelectorEntry => {
  const nodes = selector.nodes.filter((node) => node.type !== 'comment');
  const last = nodes.map((node) => node.type).lastIndexOf('combinator');
  const subject = nodes.slice(last + 1);
  const pseudoElements = subject.filter((node): node is parser.Pseudo => node.type === 'pseudo' && isPseudoElement(node));
  const simple = subject.filter((node) => !pseudoElements.includes(node as parser.Pseudo));
  const types = simple.filter((node) => node.type === 'tag').map(simpleText);
  const others = simple.filter((node) => node.type !== 'tag' && node.type !== 'universal').map(simpleText);
  const pseudo = pseudoElements[0];
  return {
    context: contextText(nodes.slice(0, last + 1)),
    compound: [...new Set([...types, ...others])],
    pseudoElement: pseudo ? `::${pseudo.value.replace(/^:+/, '').toLowerCase()}` : '',
    specificity: selectorSpecificity(selector),
    ambiguous: simple.some((node) => node.type === 'pseudo' && LIST_PSEUDOS.has(node.value.toLowerCase()) && node.nodes.length > 1),
  };
};

/** The complex selectors of a selector list, or [] if the text cannot be parsed. */
export const parseSelectorList = (text: string): ReadonlyArray<SelectorEntry> => {
  try {
    return parser().astSync(String(text)).nodes.map(entryOf);
  } catch {
    return [];
  }
};

/** Whether every element `outer` matches is also matched by `inner` (inner's compound is in outer's). */
export const contains = (outer: SelectorEntry, inner: SelectorEntry): boolean =>
  inner.pseudoElement === outer.pseudoElement &&
  (inner.context === '' || inner.context === outer.context) &&
  inner.compound.every((simple) => outer.compound.includes(simple));

const typeOf = (entry: SelectorEntry): string | undefined => entry.compound.find((simple) => /^[a-z]/i.test(simple));

/** Elements that are inline by default (spec "밑줄", M6d): an underline drawn as a background follows their lines. */
const INLINE_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'b', 'cite', 'code', 'dfn', 'em', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
]);

/** The selector's subject is an element that is inline by default (and not a pseudo-element). */
export const isInlineByType = (entry: SelectorEntry): boolean => {
  const type = typeOf(entry);
  return entry.pseudoElement === '' && type !== undefined && INLINE_ELEMENTS.has(type);
};

export const selectorText = (entry: SelectorEntry): string => `${entry.context}${entry.compound.join('') || '*'}${entry.pseudoElement}`;

/**
 * The selector for an element that all entries match: their compounds joined. Undefined when
 * no single selector can say it (different contexts, different type selectors or pseudo-elements).
 */
export const unionEntries = (entries: ReadonlyArray<SelectorEntry>): SelectorEntry | undefined => {
  const contexts = [...new Set(entries.map((e) => e.context).filter((c) => c !== ''))];
  const pseudos = [...new Set(entries.map((e) => e.pseudoElement))];
  const types = [...new Set(entries.map(typeOf).filter((t): t is string => t !== undefined))];
  if (contexts.length > 1 || pseudos.length > 1 || types.length > 1) return undefined;
  const compound = [...new Set([...types, ...entries.flatMap((e) => e.compound.filter((s) => s !== typeOf(e)))])];
  const draft: SelectorEntry = { context: contexts[0] ?? '', compound, pseudoElement: pseudos[0] ?? '', specificity: ZERO, ambiguous: false };
  const [parsed] = parseSelectorList(selectorText(draft));
  return parsed ? { ...draft, specificity: parsed.specificity } : undefined;
};

/**
 * Resolves a nested rule's selectors against its parent rule's (CSS nesting): `&` is replaced
 * by each parent selector; without `&` the child is a descendant of the parent.
 */
export const resolveNested = (parents: ReadonlyArray<string>, child: string): ReadonlyArray<string> => {
  const children = splitList(child);
  return parents.length === 0
    ? children
    : parents.flatMap((parent) => children.map((c) => (c.includes('&') ? c.replace(/&/g, parent) : `${parent} ${c}`)));
};

/** A selector list split at its top-level commas. */
export const splitList = (text: string): ReadonlyArray<string> => {
  try {
    return parser().astSync(String(text)).nodes.map((selector) => String(selector).trim());
  } catch {
    return [text.trim()];
  }
};

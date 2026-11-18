// Resolves `var()` in border declarations (spec "Colour resolution"). Pure.
//
// Values come from `:root`/`html` rules in the file, and from the drawn rule itself, which
// wins (an element's own value beats the inherited one). Root rules inside `@media` or
// `@supports` make a condition: the file's values with that block's on top, resolved on
// their own. A variable that another rule (a class theme, a modifier) also changes cannot be
// known at build time.
import valueParser from 'postcss-value-parser';
import type { Declaration } from 'postcss';
import { position, type Diagnostic } from '../report/diagnostics';
import type { Condition, VariableDef } from '../read/variables';

/** Variable name → value, for one condition. */
export type Env = ReadonlyMap<string, string>;

export type Scope = {
  /** Values that always apply. */
  readonly base: Env;
  /** Each condition that changes some value, in source order, with base values underneath. */
  readonly conditional: ReadonlyArray<{ readonly conditions: ReadonlyArray<Condition>; readonly env: Env }>;
  /** Definitions outside root rules, for the class-theme check. */
  readonly scoped: ReadonlyArray<VariableDef>;
};

const conditionKey = (conditions: ReadonlyArray<Condition>): string =>
  JSON.stringify(conditions.map((c) => [c.name.toLowerCase(), c.params]));

const envOf = (defs: ReadonlyArray<VariableDef>, under: Env = new Map()): Env =>
  new Map([...under, ...defs.map((def) => [def.name, def.value] as const)]);

export const scopeOf = (defs: ReadonlyArray<VariableDef>): Scope => {
  const rootDefs = defs.filter((def) => def.root);
  const base = envOf(rootDefs.filter((def) => def.conditions.length === 0));
  const keys = [...new Set(rootDefs.filter((def) => def.conditions.length > 0).map((def) => conditionKey(def.conditions)))];
  const conditional = keys.map((key) => {
    const group = rootDefs.filter((def) => def.conditions.length > 0 && conditionKey(def.conditions) === key);
    return { conditions: group[0]?.conditions ?? [], env: envOf(group, base) };
  });
  return { base, conditional, scoped: defs.filter((def) => !def.root) };
};

export type Substitution =
  | { readonly kind: 'ok'; readonly value: string; readonly names: ReadonlyArray<string> }
  | { readonly kind: 'missing'; readonly name: string; readonly cycle: boolean; readonly names: ReadonlyArray<string> };

/**
 * Replaces every `var()` in a value, using fallbacks and variables inside variables.
 * `names` lists every variable the value reads, including ones that fell back.
 */
export const substitute = (value: string, lookup: (name: string) => string | undefined): Substitution => {
  // Local bookkeeping for the walk below; nothing here leaves the function.
  const names: string[] = [];
  const found: { failure?: { readonly name: string; readonly cycle: boolean } } = {};

  const resolve = (text: string, stack: ReadonlyArray<string>): string =>
    valueParser.stringify(valueParser(text).nodes, (node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return undefined;
      const comma = node.nodes.findIndex((child) => child.type === 'div' && child.value === ',');
      const name = valueParser.stringify(comma === -1 ? node.nodes : node.nodes.slice(0, comma)).trim();
      const fallback = comma === -1 ? undefined : valueParser.stringify(node.nodes.slice(comma + 1)).trim();
      names.push(name);
      if (stack.includes(name)) {
        found.failure ??= { name, cycle: true };
        return '';
      }
      const defined = lookup(name);
      if (defined !== undefined) return resolve(defined, [...stack, name]);
      if (fallback !== undefined) return resolve(fallback, stack);
      found.failure ??= { name, cycle: false };
      return '';
    });

  const resolved = resolve(value, []);
  const unique = [...new Set(names)];
  return found.failure ? { kind: 'missing', ...found.failure, names: unique } : { kind: 'ok', value: resolved, names: unique };
};

/** A variable lookup for one rule: its own definitions first, then the condition's values. */
export const lookupFor = (own: Env, env: Env) => (name: string): string | undefined => own.get(name) ?? env.get(name);

// --- Messages ---------------------------------------------------------------

const OFF = 'To leave this rule out of the conversion, add `--sketch: off` to it.';

export const currentColorError = (decl: Declaration | undefined): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    'The border colour is not known at build time: currentColor. A sketched border fixes its colour in the drawing (SVG), so the colour must be known. ' +
    'Leaving the colour out, as in `border: 1px solid`, also means currentColor. ' +
    `Fix: write the colour (e.g. \`border: 1px solid #1d2433\`). ${OFF}`,
});

export const missingVarError = (decl: Declaration, name: string, cycle: boolean): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: cycle
    ? `\`${name}\` refers to itself (a cycle), so it has no value. Fix the variable definitions. ${OFF}`
    : `The value of \`var(${name})\` was not found. A variable used in a border must be defined in a \`:root\` or \`html\` rule of the same file, or in this rule. ` +
      `If it is defined in another file, combine the files first (e.g. with postcss-import). ${OFF}`,
});

export const classThemeError = (decl: Declaration, def: VariableDef): Diagnostic => {
  const at = position(def.decl);
  return {
    severity: 'error',
    node: decl,
    message:
      `\`${def.name}\` is changed in \`${def.rule.selector}\`${at ? ` (${at})` : ''}. A value changed by a class cannot be known at build time, so it cannot go into the border drawing. ` +
      `Fix: for a theme, use a media query instead (e.g. \`@media (prefers-color-scheme: dark) { :root { ${def.name}: … } }\`); each condition then gets its own drawing. ` +
      `If the value belongs to this rule only, define it in this rule and do not change it elsewhere. ${OFF}`,
  };
};

export const conditionUndrawableError = (decl: Declaration | undefined, conditions: ReadonlyArray<Condition>): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `Inside \`${conditions.map((c) => `@${c.name} ${c.params}`).join(' ')}\`, the changed variables make a border that cannot be drawn (not solid, or a colour or width not known at build time). ` +
    `Change the variables so that they give the same kind of value under that condition too (px width, solid, a colour). ${OFF}`,
});

export const invalidSketchError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: `\`--sketch\` only accepts \`off\`. Got: \`${decl.value}\`.`,
});

// --- Cascade (M4) -------------------------------------------------------------

export const parentlessError = (decl: Declaration, selector: string): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `\`${selector}\` changes only part of a border (\`${decl.prop}\`), and no rule in its selector gives the rest (width, style, colour, radius). ` +
    'A sketched border puts all of its values into one drawing, so all of them must be known; the parent is not guessed from class names. ' +
    'Fix: (1) include the rule with the complete border in the selector (e.g. `.btn.btn--lg` instead of `.btn--lg`). ' +
    '(2) Write the whole border in this rule (e.g. `border: 2px solid #1d2433`). ' +
    `(3) ${OFF}`,
});

export const ambiguousSelectorError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    '`:is()` or `:where()` has several candidates, so it is unclear which rule gives the rest of the border. ' +
    `Write it as a selector list (e.g. \`:is(.a, .b):hover\` → \`.a:hover, .b:hover\`). ${OFF}`,
});

export const familyTooLargeError = (decl: Declaration, count: number, max: number): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `${count} rules (modifiers, states and conditions) change this rule's border, more than ${max}. That would make 2^${count} combinations, so it is not converted. ` +
    `Split the rule (e.g. a base class per size), or add \`--sketch: off\` to some of the rules.`,
});

// --- Fills (M6a) -------------------------------------------------------------------

export const invalidFillError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: `\`--sketch-fill\` accepts \`solid\`, \`rough\`, \`marker\` or \`hatch\`. Got: \`${decl.value}\`.`,
});

export const invalidSizeError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `\`--sketch-size\` takes the element's border-box size as \`width height\` (e.g. \`240 160\` or \`240px 160px\`), or one \`width\` for a square. ` +
    `The values must be px greater than 0. Got: \`${decl.value}\`.`,
});

export const currentFillColorError = (decl: Declaration | undefined): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    'The fill colour is not known at build time: currentColor. `--sketch-fill: rough` and `marker` fix the background colour in the drawing (SVG), so the colour must be known. ' +
    `Fix: write the background colour (e.g. \`background-color: #ffe38a\`), or remove \`--sketch-fill\` to keep the original background. ${OFF}`,
});

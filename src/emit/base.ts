// `@sketchify base;` (spec "Form controls and @sketchify base", M7a): sketched default styles for form
// controls and `hr`, in place of the browser's. Writes them where the line is, in a cascade
// layer and under `:where()`, so the page's own styles always win. With emit.ts and variants.ts,
// one of the places that change the PostCSS tree.
//
// The outlines (text fields, textarea, select, hr) are plain CSS borders in var() colours: the
// compiler then draws them like any other border, dark mode included (M3). Checkboxes, radios and
// the select arrow are not borders; their drawings come in ready made (see index.ts).
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Node, type Root, type Rule } from 'postcss';
import type { BaseColors, BaseOptions } from '../options';
import type { Diagnostic, Result } from '../report/diagnostics';
import type { ImagePlacement } from '../draw/stroke';
import type { Slot } from './emit';
import { BASE_LAYER } from './layer';
import { PICK, slotVar } from './variants';

/** The layer the base styles go in (see layer.ts). */
export { BASE_LAYER };

/** The base colours as variables (not `--sketch-*`: those are the plugin's controls). */
const INK = '--skb-ink';
const ACCENT = '--skb-accent';

/** Drawings for one colour scheme: the arrow's `url()`, and names of drawing variables (`--sk-…`) per slot. */
export type ThemeDrawings = {
  /** Written as is: a variable here would be resolved with the select's border, before the drawings are stored. */
  readonly arrow: string;
  readonly checkbox: ReadonlyArray<Slot>;
  readonly checkboxChecked: ReadonlyArray<Slot>;
  readonly radio: ReadonlyArray<Slot>;
  readonly radioChecked: ReadonlyArray<Slot>;
  /** A focused field: its border in the accent colour with a ring around it, per slot. */
  readonly fieldFocus: ReadonlyArray<Slot>;
  /** The focus rings of a checkbox and a radio (one drawing each). */
  readonly checkboxRing: string;
  readonly radioRing: string;
  /** A focused button (M7b): its border in the accent colour with a ring, per slot. */
  readonly buttonFocus: ReadonlyArray<Slot>;
  /** The link underline (M7b, one drawing). */
  readonly link: string;
  /** The textarea resize grip's `url()` (M7b), written as is like the arrow. */
  readonly resizer: string;
};

/** Where the drawings go (the same in every colour scheme). */
export type FocusPlacements = {
  readonly field: ImagePlacement;
  readonly choiceOutset: number;
  readonly button: ImagePlacement;
  readonly link: ImagePlacement;
};

/**
 * The base link underline (M7b), read by the link's `border-image`. A page rule that sets the
 * link's `text-decoration` itself sets it to `none` (see `markLinkLines`): its underline is its
 * own (M6d draws it, or the browser does). Not inherited, like `--skb-outline`.
 */
export const LINK_LINE = '--skb-link';

/** Buttons (M7b), one selector each. */
const BUTTONS = ['button', 'input[type=submit]', 'input[type=button]', 'input[type=reset]'];

/**
 * Keeps the browser's focus outline where the base's focus drawing does not show. The base turns
 * the outline off (`outline-style: var(--skb-outline, none)`) because its own ring replaces it;
 * a page rule that draws the field's border itself (and so hides the base ring) sets this to
 * `auto` (see index.ts). Not inherited, so it only counts on the element the rule draws.
 */
export const KEEP_OUTLINE = '--skb-outline';

export type BaseDrawings = { readonly light: ThemeDrawings; readonly dark?: ThemeDrawings };

/** `input` types that are text fields (the rest are buttons, choices, pickers or hidden). */
const NOT_TEXT = ['checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden', 'submit', 'button', 'reset'];
const TEXT_INPUT = `input:not(${NOT_TEXT.map((type) => `[type=${type}]`).join(', ')})`;

/** The text fields, one selector each: a list inside `:where()` could not be a parent rule (M4). */
const FIELDS = [TEXT_INPUT, 'textarea', 'select'];

const DARK = '@media (prefers-color-scheme: dark)';

/** Button backgrounds: the ink at a few percent, so they follow dark mode with it. */
const tint = (percent: number): string => `color-mix(in srgb, var(${INK}) ${percent}%, transparent)`;

const slots = (list: ReadonlyArray<Slot>): string => list.map((slot) => `${slotVar(slot.seed, slot.flip)}: var(${slot.drawing});`).join(' ');

const image = (source: string, p: ImagePlacement): string => `${source} ${p.slice} / ${p.width} / ${p.outset} stretch`;

/** Focus rules are written out whole here: `--sketch: off` keeps the compiler from redrawing them. */
const OFF = '--sketch: off;';
const NO_OUTLINE = `outline-style: var(${KEEP_OUTLINE}, none);`;

const colorVars = (colors: BaseColors): string => `${INK}: ${colors.ink}; ${ACCENT}: ${colors.accent};`;

/** The control rules that change with the colour scheme: the drawings each state picks among. */
const controlRules = (d: ThemeDrawings): ReadonlyArray<string> => [
  `:where(select) { background-image: ${d.arrow}; }`,
  `:where(input[type=checkbox]) { ${slots(d.checkbox)} }`,
  `:where(input[type=checkbox]:checked) { ${slots(d.checkboxChecked)} }`,
  `:where(input[type=radio]) { ${slots(d.radio)} }`,
  `:where(input[type=radio]:checked) { ${slots(d.radioChecked)} }`,
  ...FIELDS.map((field) => `:where(${field}):focus-visible { ${OFF} ${slots(d.fieldFocus)} }`),
  `:where(input[type=checkbox]):focus-visible { ${OFF} border-image-source: var(${d.checkboxRing}); }`,
  `:where(input[type=radio]):focus-visible { ${OFF} border-image-source: var(${d.radioRing}); }`,
  ...BUTTONS.map((button) => `:where(${button}):focus-visible { ${OFF} ${slots(d.buttonFocus)} }`),
  `:where(a:any-link) { ${OFF} ${LINK_LINE}: var(${d.link}); }`,
  `:where(textarea)::-webkit-resizer { background: ${d.resizer} no-repeat center / 100% 100%; }`,
];

/**
 * The base styles as CSS. Sizes stay within a few px of the browsers' defaults (spec: base is not
 * held to the same layout promise): 13px choices with Chrome's margins; text fields and select
 * get padding between Chrome's (2px border + 1px 2px) and Safari's (2px border + 2px 5px), since a
 * styled border drops the native field's padding.
 * Nothing touches `outline`: the browser's focus ring still shows.
 */
export const baseCss = (colors: BaseOptions, drawings: BaseDrawings, focus: FocusPlacements): string => {
  const dark = colors.dark && drawings.dark ? [`${DARK} { :root { ${colorVars(colors.dark)} } }`, ...controlRules(drawings.dark).map((rule) => `${DARK} { ${rule} }`)] : [];
  const choice = (type: string, margin: string): string =>
    `:where(input[type=${type}]) { appearance: none; -webkit-appearance: none; width: 13px; height: 13px; margin: ${margin}; ` +
    `background-image: var(${PICK}); background-repeat: no-repeat; background-size: 100% 100%; }`;
  const rules = [
    `:root { ${colorVars(colors)} }`,
    ...FIELDS.flatMap((field) => [
      `:where(${field}) { border: 1px solid var(${INK}); border-radius: 4px;${field === TEXT_INPUT ? ' padding: 2px 4px;' : ''} }`,
      // Focus: the accent border and a ring around it replace the browser's outline.
      `:where(${field}):focus-visible { ${OFF} ${NO_OUTLINE} border-color: transparent; border-image: ${image(`var(${PICK})`, focus.field)}; }`,
    ]),
    ...['checkbox', 'radio'].map(
      (type) => `:where(input[type=${type}]):focus-visible { ${OFF} ${NO_OUTLINE} border-image: none 0 fill / 0 / ${focus.choiceOutset}px stretch; }`,
    ),
    // Buttons: a drawn ink border (outer size as the browser's 2px border + 1px 6px padding), a
    // light background that darkens on hover and press, and the focus ring of the fields.
    ...BUTTONS.flatMap((button) => [
      `:where(${button}) { appearance: none; -webkit-appearance: none; border: 1px solid var(${INK}); border-radius: 6px; padding: 2px 7px; background-color: ${tint(6)}; }`,
      `:where(${button}):hover { background-color: ${tint(10)}; }`,
      `:where(${button}):active { background-color: ${tint(16)}; }`,
      `:where(${button}):focus-visible { ${OFF} ${NO_OUTLINE} border-color: transparent; border-image: ${image(`var(${PICK})`, focus.button)}; }`,
    ]),
    // Links: the accent colour and a drawn underline below the text (as M6d draws one), in place of the browser's.
    `:where(a:any-link) { ${OFF} color: var(${ACCENT}); text-decoration-line: none; border-image: ${image(`var(${LINK_LINE})`, focus.link)}; }`,
    `:where(select) { appearance: none; -webkit-appearance: none; padding: 2px 28px 2px 4px; background-repeat: no-repeat; background-position: right 8px center; background-size: 12px 10px; }`,
    choice('checkbox', '3px 3px 3px 4px'),
    choice('radio', '3px 3px 0 5px'),
    ...controlRules(drawings.light),
    `:where(hr) { border: 0; border-top: 1px solid var(${INK}); }`,
    ...dark,
  ];
  // Registered outside the layer: not inherited, with no initial value (so `var()` falls back to `none`).
  const property = [KEEP_OUTLINE, LINK_LINE].map((name) => `@property ${name} { syntax: '*'; inherits: false; }\n`).join('');
  return `${property}@layer ${BASE_LAYER} {\n${rules.map((rule) => `  ${rule}`).join('\n')}\n}\n`;
};

/** The `@sketchify base` line, if any. Two of them, or an unknown `@sketchify …`, are errors. */
const sketchifyRules = (container: Container): ReadonlyArray<AtRule> =>
  (container.nodes ?? []).flatMap((node: ChildNode): ReadonlyArray<AtRule> => {
    if (node.type === 'atrule') return /^sketchify$/i.test(node.name) ? [node] : sketchifyRules(node);
    return node.type === 'rule' ? sketchifyRules(node) : [];
  });

export const findBase = (root: Root): Result<AtRule | undefined> => {
  const found = sketchifyRules(root);
  const unknown = found.filter((rule) => rule.params.trim() !== 'base');
  const bases = found.filter((rule) => rule.params.trim() === 'base');
  const diagnostics: ReadonlyArray<Diagnostic> = [
    ...unknown.map((rule) => ({ severity: 'error' as const, node: rule, message: `Unknown \`@sketchify ${rule.params.trim()}\`. The only form is \`@sketchify base;\`.` })),
    ...bases.slice(1).map((rule) => ({ severity: 'error' as const, node: rule, message: '`@sketchify base;` can appear only once in a file.' })),
  ];
  return { value: bases[0], diagnostics };
};

/** Puts the base styles where the `@sketchify base` line was. */
export const expandBase = (line: AtRule, css: string): void => {
  line.replaceWith(postcss.parse(css).nodes);
};

/** Whether a rule sits in the base layer (the base's own rules, not the page's). */
export const inBase = (node: Node): boolean => {
  const parent = node.parent as Node | undefined;
  if (!parent || parent.type === 'root') return false;
  return (parent.type === 'atrule' && /^layer$/i.test((parent as AtRule).name) && (parent as AtRule).params.trim() === BASE_LAYER) || inBase(parent);
};

/**
 * With a base in the file, a page rule that sets `text-decoration` itself turns the base link
 * underline off on the elements it styles (`--skb-link: none`): `.nav a { text-decoration: none }`,
 * a dotted link, or one whose solid underline M6d draws (or leaves to the browser).
 */
export const markLinkLines = (rules: ReadonlyArray<Rule>): void => {
  rules
    .filter((rule) => !inBase(rule))
    .forEach((rule) => {
      const last = (rule.nodes ?? []).filter((node): node is Declaration => node.type === 'decl' && /^text-decoration(-line)?$/i.test(node.prop)).at(-1);
      if (last) last.after(postcss.decl({ prop: LINK_LINE, value: 'none', important: last.important === true }));
    });
};

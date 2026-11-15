// Reads each rule's border declarations, in order, into one state per rule.
// Only reads the PostCSS tree; emit/ is the only place that changes it.
import type { ChildNode, Container, Declaration, Root, Rule } from 'postcss';
import type { Result } from '../report/diagnostics';
import { type SelectorEntry, parseSelectorList, resolveNested } from './selectors';
import type { Condition } from './variables';
import {
  type Color,
  type Corner,
  type Radius,
  SIDES,
  type Side,
  type Style,
  type Width,
  type Background,
  type BoxSizing,
  type DecorationLine,
  type Display,
  type SizeHint,
  parseBackgroundShorthand,
  parseBoxSizing,
  parseDecorationLine,
  parseDecorationStyle,
  parseDecorationThickness,
  parseDisplay,
  parseTextDecoration,
  parseLength,
  parsePadding,
  parseSizeHint,
  paintsImage,
  parseBorderRadius,
  parseBorderShorthand,
  parseBoxValue,
  parseColor,
  parseCornerRadius,
  parseStyle,
  parseWidth,
} from './values';

/** A border part this rule declares, or `unset` when the rule says nothing about it. */
export type Declared<T> = { readonly kind: 'unset' } | T;

export type SideState = {
  readonly width: Declared<Width>;
  readonly style: Declared<Style>;
  readonly color: Declared<Color>;
};

export type BorderState = {
  readonly sides: Readonly<Record<Side, SideState>>;
  readonly radius: Readonly<Record<Corner, Declared<Radius>>>;
  /** A declaration this version cannot place on physical sides (logical properties). */
  readonly unsupported: boolean;
  /** The rule already sets `border-image` or one of its longhands. */
  readonly hasBorderImage: boolean;
  /** Any border declaration is `!important`. */
  readonly important: boolean;
  /** The background as far as fills care (M6): its colour and whether it has an image. */
  readonly background: { readonly color: Declared<Color>; readonly image: boolean; readonly important: boolean };
  /** `--sketch-fill`, or `unset` (solid: the original background stays). */
  readonly fill: Declared<FillMode>;
  /** What the element's size depends on (M6c exact hatch). */
  readonly size: SizeState;
  /** The text decoration and what it depends on (M6d underlines). */
  readonly text: TextState;
};

/** `text-decoration` parts, the text colour and `display` (spec "한 변 border, hr, 밑줄"). */
export type TextState = {
  readonly line: Declared<DecorationLine>;
  readonly style: Declared<Style>;
  readonly decorationColor: Declared<Color>;
  /** px; undefined is the default (`auto`, unset, other units). */
  readonly thickness: number | undefined;
  readonly color: Declared<Color>;
  readonly display: Declared<Display>;
};

/** The declarations that give an element's border-box size (spec "크기 처리"). */
export type SizeState = {
  readonly width: Declared<Width>;
  readonly height: Declared<Width>;
  readonly padding: Readonly<Record<Side, Declared<Width>>>;
  readonly boxSizing: Declared<BoxSizing>;
  /** `--sketch-size`. */
  readonly hint: Declared<SizeHint>;
};

/** `--sketch-fill` (spec "채움"). `invalid` keeps the text for the error message. */
export type FillMode =
  | { readonly kind: 'mode'; readonly mode: 'solid' | 'rough' | 'marker' | 'hatch' }
  | { readonly kind: 'invalid'; readonly css: string };

const FILL_MODES: ReadonlySet<string> = new Set(['solid', 'rough', 'marker', 'hatch']);

export const parseFillMode = (value: string): FillMode => {
  const mode = value.trim().toLowerCase();
  return FILL_MODES.has(mode) ? { kind: 'mode', mode: mode as 'solid' | 'rough' | 'marker' | 'hatch' } : { kind: 'invalid', css: value.trim() };
};

/** A fill mode other than the original background (rough or marker; hatch from M6b). */
export const paintsFill = (fill: Declared<FillMode>): boolean => fill.kind === 'mode' && fill.mode !== 'solid';

export type RuleFacts = {
  readonly rule: Rule;
  readonly border: BorderState;
  /** The last width/style/colour declaration; new declarations go after it. */
  readonly lastBorderDecl: Declaration | undefined;
  /** The selector (or one in its list) targets a pseudo-element such as `::before`. */
  readonly pseudoElement: boolean;
  /** The rule's declarations in order, for re-reading border values once `var()` is resolved. */
  readonly decls: ReadonlyArray<Declaration>;
  /** The `--sketch` control declaration, if any. */
  readonly sketch: SketchControl;
  /** The complex selectors of the rule, nesting resolved (CSS nesting `&`). */
  readonly entries: ReadonlyArray<SelectorEntry>;
  /** Position in source order among all style rules. */
  readonly order: number;
  /** At-rules around the rule, outermost first, including `@layer`. */
  readonly atRules: ReadonlyArray<Condition>;
  /**
   * The rule sets only some of a side's width, style and colour (`border-color: red`), so it
   * needs the rest from another rule. A side shorthand (`border-bottom: 1px solid red`) is not
   * partial; neither is a rule that only changes the radius.
   */
  readonly partial: boolean;
};

/** `--sketch: off` leaves the rule alone; any other value is a mistake. */
export type SketchControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'off'; readonly decl: Declaration }
  | { readonly kind: 'invalid'; readonly decl: Declaration };

const UNSET = { kind: 'unset' } as const;
const EMPTY_SIDE: SideState = { width: UNSET, style: UNSET, color: UNSET };

export const EMPTY_BORDER: BorderState = {
  sides: { top: EMPTY_SIDE, right: EMPTY_SIDE, bottom: EMPTY_SIDE, left: EMPTY_SIDE },
  radius: { 'top-left': UNSET, 'top-right': UNSET, 'bottom-right': UNSET, 'bottom-left': UNSET },
  unsupported: false,
  hasBorderImage: false,
  important: false,
  background: { color: UNSET, image: false, important: false },
  fill: UNSET,
  size: {
    width: UNSET,
    height: UNSET,
    padding: { top: UNSET, right: UNSET, bottom: UNSET, left: UNSET },
    boxSizing: UNSET,
    hint: UNSET,
  },
  text: { line: UNSET, style: UNSET, decorationColor: UNSET, thickness: undefined, color: UNSET, display: UNSET },
};

type Part = keyof SideState;

const setSides = (state: BorderState, sides: ReadonlyArray<Side>, patch: (side: Side) => Partial<SideState>): BorderState => ({
  ...state,
  sides: Object.fromEntries(
    SIDES.map((side) => [side, sides.includes(side) ? { ...state.sides[side], ...patch(side) } : state.sides[side]]),
  ) as Record<Side, SideState>,
});

const setPartPerSide = <T>(state: BorderState, part: Part, values: Readonly<Record<Side, T>> | undefined): BorderState =>
  values ? setSides(state, SIDES, (side) => ({ [part]: values[side] })) : { ...state, unsupported: true };

const UNKNOWN_COLOR = (css: string): Color => ({ kind: 'unknown', css });

const SIDE_PROP = /^border-(top|right|bottom|left)$/;
const SIDE_PART_PROP = /^border-(top|right|bottom|left)-(width|style|color)$/;
const CORNER_PROP = /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/;
const LOGICAL_PROP = /^border-(block|inline)(-|$)|^border-(start|end)-(start|end)-radius$/;

const PADDING_SIDE = /^padding-(top|right|bottom|left)$/;
/** Logical sizes and paddings: their physical side depends on the writing mode, so the size is unknown. */
const LOGICAL_SIZE = /^(inline-size|block-size|padding-(block|inline)(-start|-end)?)$/;

/** Declarations that change an element's border-box size, as the exact hatch reads it (M6c). */
export const isSizeProp = (prop: string): boolean => {
  const p = prop.toLowerCase();
  return p === 'width' || p === 'height' || p === 'padding' || PADDING_SIDE.test(p) || p === 'box-sizing' || p === '--sketch-size' || LOGICAL_SIZE.test(p);
};

const UNKNOWN_LENGTH: Width = { kind: 'unknown' };

const applySize = (state: BorderState, prop: string, value: string): BorderState => {
  const size = state.size;
  const set = (patch: Partial<SizeState>): BorderState => ({ ...state, size: { ...size, ...patch } });
  if (prop === 'width') return set({ width: parseLength(value) });
  if (prop === 'height') return set({ height: parseLength(value) });
  if (prop === 'padding') return set({ padding: parsePadding(value) });
  if (prop === 'box-sizing') return set({ boxSizing: parseBoxSizing(value) });
  if (prop === '--sketch-size') return set({ hint: parseSizeHint(value) });
  const side = PADDING_SIDE.exec(prop)?.[1];
  if (side) return set({ padding: { ...size.padding, [side]: parseLength(value) } });
  if (prop === 'inline-size' || prop === 'block-size') return set({ width: UNKNOWN_LENGTH, height: UNKNOWN_LENGTH });
  return set({ padding: { top: UNKNOWN_LENGTH, right: UNKNOWN_LENGTH, bottom: UNKNOWN_LENGTH, left: UNKNOWN_LENGTH } });
};

/** Declarations an underline reads (M6d): the decoration, the text colour and `display`. */
export const isUnderlineProp = (prop: string): boolean => {
  const p = prop.toLowerCase();
  return p === 'text-decoration' || /^text-decoration-(line|style|color|thickness)$/.test(p) || p === 'color' || p === 'display';
};

const isDecorationProp = (prop: string): boolean => prop === 'text-decoration' || prop.startsWith('text-decoration-');

const applyText = (state: BorderState, prop: string, value: string): BorderState => {
  const text = state.text;
  const set = (patch: Partial<TextState>): BorderState => ({ ...state, text: { ...text, ...patch } });
  switch (prop) {
    case 'text-decoration': {
      const parts = parseTextDecoration(value);
      return set({ line: parts.line, style: parts.style, decorationColor: parts.color, thickness: parts.thickness });
    }
    case 'text-decoration-line':
      return set({ line: parseDecorationLine(value) });
    case 'text-decoration-style':
      return set({ style: parseDecorationStyle(value) });
    case 'text-decoration-color':
      return set({ decorationColor: parseColor(value) });
    case 'text-decoration-thickness':
      return set({ thickness: parseDecorationThickness(value) });
    case 'color':
      return set({ color: parseColor(value) });
    default:
      return set({ display: parseDisplay(value) });
  }
};

/** Background declarations a fill reads (M6). */
export const isBackgroundProp = (prop: string): boolean => /^background(-color|-image)?$/i.test(prop);

/** Whether a declaration feeds the border state: width, style, colour, radius or `border-image`. */
export const isBorderProp = (prop: string): boolean => {
  const p = prop.toLowerCase();
  return isBorderLineProp(p) || p === 'border-radius' || CORNER_PROP.test(p) || LOGICAL_PROP.test(p) || p.startsWith('border-image');
};

/** Whether a declaration changes the border's width, style or colour (the parts the drawing replaces). */
export const isBorderLineProp = (prop: string): boolean =>
  prop === 'border' ||
  prop === 'border-width' ||
  prop === 'border-style' ||
  prop === 'border-color' ||
  SIDE_PROP.test(prop) ||
  SIDE_PART_PROP.test(prop) ||
  /^border-(block|inline)(-|$)/.test(prop);

const applyBackground = (state: BorderState, prop: string, value: string, important: boolean): BorderState => {
  const background = { ...state.background, important: state.background.important || important };
  if (prop === 'background-image') return { ...state, background: { ...background, image: paintsImage(value) } };
  if (prop === 'background-color') return { ...state, background: { ...background, color: parseColor(value) } };
  const parsed: Background = parseBackgroundShorthand(value);
  return { ...state, background: { ...background, color: parsed.color ?? UNSET, image: parsed.image } };
};

/** Applies one declaration to the state. Later declarations win, as in CSS. */
export const applyDeclaration = (state: BorderState, prop: string, value: string, important: boolean): BorderState => {
  const p = prop.toLowerCase();
  const marked = isBorderLineProp(p) || p === 'border-radius' || CORNER_PROP.test(p) ? { ...state, important: state.important || important } : state;

  if (p === '--sketch-fill') return { ...state, fill: parseFillMode(value) };
  if (isSizeProp(p)) return applySize(state, p, value);
  if (isUnderlineProp(p)) return applyText(isDecorationProp(p) ? { ...state, important: state.important || important } : state, p, value);
  if (isBackgroundProp(p)) return applyBackground(state, p, value, important);
  if (p.startsWith('border-image')) return { ...marked, hasBorderImage: true };
  if (LOGICAL_PROP.test(p)) return { ...marked, unsupported: true };
  if (p === 'border') {
    const parts = parseBorderShorthand(value);
    return setSides(marked, SIDES, () => parts);
  }
  const sideMatch = SIDE_PROP.exec(p);
  if (sideMatch?.[1]) {
    const parts = parseBorderShorthand(value);
    return setSides(marked, [sideMatch[1] as Side], () => parts);
  }
  if (p === 'border-width') return setPartPerSide(marked, 'width', parseBoxValue<Width>(value, parseWidth, { kind: 'unknown' }));
  if (p === 'border-style') return setPartPerSide(marked, 'style', parseBoxValue<Style>(value, parseStyle, { kind: 'unknown' }));
  if (p === 'border-color') return setPartPerSide(marked, 'color', parseBoxValue<Color>(value, parseColor, UNKNOWN_COLOR(value)));
  const partMatch = SIDE_PART_PROP.exec(p);
  if (partMatch?.[1] && partMatch[2]) {
    const side = partMatch[1] as Side;
    const part = partMatch[2] as Part;
    const parsed = part === 'width' ? parseWidth(value.trim()) : part === 'style' ? parseStyle(value.trim()) : parseColor(value);
    return setSides(marked, [side], () => ({ [part]: parsed }));
  }
  if (p === 'border-radius') return { ...marked, radius: parseBorderRadius(value) };
  const cornerMatch = CORNER_PROP.exec(p);
  if (cornerMatch?.[1]) {
    const corner = cornerMatch[1] as Corner;
    return { ...marked, radius: { ...marked.radius, [corner]: parseCornerRadius(value) } };
  }
  return state;
};

/** Where a style rule sits: its resolved selectors and the at-rules around it. */
type Placed = { readonly rule: Rule; readonly selectors: ReadonlyArray<string>; readonly atRules: ReadonlyArray<Condition> };

/** Style rules in source order, including nested ones, skipping `@keyframes` blocks. */
const rulesIn = (container: Container, parents: ReadonlyArray<string> = [], atRules: ReadonlyArray<Condition> = []): ReadonlyArray<Placed> =>
  (container.nodes ?? []).flatMap((node: ChildNode): ReadonlyArray<Placed> => {
    if (node.type === 'rule') {
      const selectors = resolveNested(parents, node.selector);
      return [{ rule: node, selectors, atRules }, ...rulesIn(node, selectors, atRules)];
    }
    if (node.type === 'atrule') {
      return /keyframes$/i.test(node.name) ? [] : rulesIn(node, parents, [...atRules, { name: node.name, params: node.params }]);
    }
    return [];
  });

const declarationsOf = (rule: Rule): ReadonlyArray<Declaration> =>
  (rule.nodes ?? []).filter((node): node is Declaration => node.type === 'decl');

// `::name`, or the four pseudo-elements CSS2 wrote with one colon.
const PSEUDO_ELEMENT = /::|:(?:before|after|first-line|first-letter)(?![\w-])/i;

/** Whether a selector targets a pseudo-element. A plain text check; full selector analysis comes in M4. */
export const targetsPseudoElement = (selector: string): boolean => PSEUDO_ELEMENT.test(selector);

/** Folds declarations (prop, value, importance) into a border state, in order. */
export const borderOf = (decls: ReadonlyArray<{ readonly prop: string; readonly value: string; readonly important: boolean }>): BorderState =>
  decls.reduce<BorderState>((state, decl) => applyDeclaration(state, decl.prop, decl.value, decl.important), EMPTY_BORDER);

const sketchControlOf = (decls: ReadonlyArray<Declaration>): SketchControl => {
  const decl = decls.filter((d) => d.prop.toLowerCase() === '--sketch').at(-1);
  if (!decl) return { kind: 'none' };
  return decl.value.trim().toLowerCase() === 'off' ? { kind: 'off', decl } : { kind: 'invalid', decl };
};

/** Whether some side is touched but not fully set (width, style and colour). */
export const isPartial = (border: BorderState): boolean =>
  !border.unsupported &&
  SIDES.some((side) => {
    const parts = Object.values(border.sides[side]) as ReadonlyArray<{ readonly kind: string }>;
    return parts.some((part) => part.kind !== 'unset') && parts.some((part) => part.kind === 'unset');
  });

export const factsOfRule = (rule: Rule, placed: Omit<Placed, 'rule'> = { selectors: [rule.selector], atRules: [] }, order = 0): RuleFacts => {
  const decls = declarationsOf(rule);
  const border = borderOf(decls.map((decl) => ({ prop: decl.prop, value: decl.value, important: decl.important === true })));
  const lastBorderDecl = decls.filter((decl) => isBorderLineProp(decl.prop.toLowerCase())).at(-1);
  return {
    rule,
    border,
    lastBorderDecl,
    pseudoElement: targetsPseudoElement(rule.selector),
    decls,
    sketch: sketchControlOf(decls),
    entries: placed.selectors.flatMap((selector) => parseSelectorList(selector)),
    order,
    atRules: placed.atRules,
    partial: isPartial(border),
  };
};

/** Whether the rule matters to borders: border, background or size declarations, variables (which borders may read) or `--sketch`. */
const mattersToBorders = (facts: RuleFacts): boolean =>
  facts.sketch.kind !== 'none' ||
  facts.decls.some(
    (decl) => isBorderProp(decl.prop) || isBackgroundProp(decl.prop) || isSizeProp(decl.prop) || isUnderlineProp(decl.prop) || decl.prop.startsWith('--'),
  );

/** Facts for every style rule that matters to borders, in source order. `@keyframes` are skipped. */
export const collect = (root: Root): Result<ReadonlyArray<RuleFacts>> => ({
  value: rulesIn(root)
    .map((placed, order) => factsOfRule(placed.rule, placed, order))
    .filter(mattersToBorders),
  diagnostics: [],
});

// Parses border-related declaration values. Pure: strings in, plain data out.
import valueParser from 'postcss-value-parser';
import { NAMED_COLORS } from './named-colors';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: ReadonlyArray<Side> = ['top', 'right', 'bottom', 'left'];

export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
export const CORNERS: ReadonlyArray<Corner> = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/** `unknown`: cannot be known from this value alone (var(), em, global keywords, …). */
export type Width = { readonly kind: 'px'; readonly px: number } | { readonly kind: 'unknown' };
export type Style = { readonly kind: 'keyword'; readonly keyword: string } | { readonly kind: 'unknown' };
export type Color =
  | { readonly kind: 'literal'; readonly css: string }
  | { readonly kind: 'transparent' }
  | { readonly kind: 'unknown'; readonly css: string };
export type Radius = { readonly kind: 'px'; readonly px: number } | { readonly kind: 'unknown' };

/** The three parts of a `border` / `border-<side>` shorthand, with omitted parts at their initial values. */
export type BorderParts = { readonly width: Width; readonly style: Style; readonly color: Color };

const UNKNOWN = { kind: 'unknown' } as const;

const STYLES: ReadonlySet<string> = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset',
]);
const WIDTH_KEYWORDS: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5 };
const GLOBAL_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color',
]);

/** Space-separated top-level parts of a value, or undefined if it has commas or slashes. */
export const splitValue = (value: string): ReadonlyArray<valueParser.Node> | undefined => {
  const nodes = valueParser(value).nodes.filter((node) => node.type !== 'space' && node.type !== 'comment');
  return nodes.some((node) => node.type === 'div') ? undefined : nodes;
};

const hasVar = (value: string): boolean => /\bvar\(/i.test(value) || /\benv\(/i.test(value);

const isGlobal = (value: string): boolean => GLOBAL_KEYWORDS.has(value.trim().toLowerCase());

/** A length in px. Unitless 0 counts as 0px; other units are unknown at build time. */
const lengthPx = (word: string): number | undefined => {
  const dimension = valueParser.unit(word);
  if (!dimension) return undefined;
  const number = Number(dimension.number);
  if (!Number.isFinite(number) || number < 0) return undefined;
  const unit = dimension.unit.toLowerCase();
  if (unit === 'px') return number;
  if (unit === '' && number === 0) return 0;
  return undefined;
};

const isLength = (word: string): boolean => {
  const dimension = valueParser.unit(word);
  return dimension !== false && (dimension.unit !== '' || Number(dimension.number) === 0);
};

export const parseWidth = (word: string): Width => {
  const lower = word.toLowerCase();
  const keyword = WIDTH_KEYWORDS[lower];
  if (keyword !== undefined) return { kind: 'px', px: keyword };
  const px = lengthPx(lower);
  return px === undefined ? UNKNOWN : { kind: 'px', px };
};

const nodeColor = (node: valueParser.Node): Color => {
  const css = valueParser.stringify(node);
  if (node.type === 'word') {
    const lower = node.value.toLowerCase();
    if (lower === 'transparent') return { kind: 'transparent' };
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(node.value)) return { kind: 'literal', css: lower };
    if (NAMED_COLORS.has(lower)) return { kind: 'literal', css: lower };
    return { kind: 'unknown', css };
  }
  if (node.type === 'function' && COLOR_FUNCTIONS.has(node.value.toLowerCase()) && !hasVar(css)) {
    // Inner keywords such as `from currentColor` (relative colours) are not literal.
    if (/currentcolor/i.test(css)) return { kind: 'unknown', css };
    return { kind: 'literal', css: css.replace(/\s+/g, ' ') };
  }
  return { kind: 'unknown', css };
};

export const parseColor = (value: string): Color => {
  if (hasVar(value) || isGlobal(value)) return { kind: 'unknown', css: value };
  const nodes = valueParser(value).nodes.filter((node) => node.type !== 'space' && node.type !== 'comment');
  const [only] = nodes;
  return nodes.length === 1 && only ? nodeColor(only) : { kind: 'unknown', css: value };
};

/** `currentColor`, written or left by a `border` shorthand without a colour. Not known at build time. */
export const isCurrentColor = (color: Color): boolean => color.kind === 'unknown' && color.css.trim().toLowerCase() === 'currentcolor';

/** Whether a value uses `var()`. */
export const usesVar = (value: string): boolean => /\bvar\(/i.test(value);

export const parseStyle = (word: string): Style => {
  const lower = word.toLowerCase();
  return STYLES.has(lower) ? { kind: 'keyword', keyword: lower } : UNKNOWN;
};

const ALL_UNKNOWN = (value: string): BorderParts => ({ width: UNKNOWN, style: UNKNOWN, color: { kind: 'unknown', css: value } });

/**
 * `border` and `border-<side>` shorthands. Omitted parts take their initial values:
 * width `medium` (3px), style `none`, colour `currentcolor` (not literal).
 */
export const parseBorderShorthand = (value: string): BorderParts => {
  if (hasVar(value) || isGlobal(value)) return ALL_UNKNOWN(value);
  const nodes = splitValue(value);
  if (!nodes || nodes.length === 0 || nodes.length > 3) return ALL_UNKNOWN(value);
  const initial: BorderParts = {
    width: { kind: 'px', px: WIDTH_KEYWORDS['medium'] ?? 3 },
    style: { kind: 'keyword', keyword: 'none' },
    color: { kind: 'unknown', css: 'currentcolor' },
  };
  return nodes.reduce<BorderParts>((parts, node) => {
    const text = valueParser.stringify(node);
    const lower = text.toLowerCase();
    if (node.type === 'word' && STYLES.has(lower)) return { ...parts, style: { kind: 'keyword', keyword: lower } };
    if (node.type === 'word' && (lower in WIDTH_KEYWORDS || isLength(lower))) return { ...parts, width: parseWidth(lower) };
    return { ...parts, color: nodeColor(node) };
  }, initial);
};

/** Expands 1–4 box values (top, right, bottom, left) to the four sides. */
export const expandBox = <T>(values: ReadonlyArray<T>): Readonly<Record<Side, T>> | undefined => {
  const [a, b = a, c = a, d = b] = values;
  if (values.length < 1 || values.length > 4 || a === undefined || b === undefined || c === undefined || d === undefined) {
    return undefined;
  }
  return { top: a, right: b, bottom: c, left: d };
};

/** `border-width` / `border-style` / `border-color` values per side, or undefined if not parseable. */
export const parseBoxValue = <T>(value: string, parse: (word: string) => T, unknown: T): Readonly<Record<Side, T>> | undefined => {
  if (hasVar(value) || isGlobal(value)) return { top: unknown, right: unknown, bottom: unknown, left: unknown };
  const nodes = splitValue(value);
  return nodes ? expandBox(nodes.map((node) => parse(valueParser.stringify(node)))) : undefined;
};

/** A single corner's radius value: one length, or two equal lengths. Different pairs are elliptical. */
const cornerRadius = (parts: ReadonlyArray<string>): Radius => {
  const [h, v = h] = parts;
  if (parts.length < 1 || parts.length > 2 || h === undefined || v === undefined) return UNKNOWN;
  const hp = lengthPx(h);
  const vp = lengthPx(v);
  return hp !== undefined && hp === vp ? { kind: 'px', px: hp } : UNKNOWN;
};

export const parseCornerRadius = (value: string): Radius => {
  if (hasVar(value) || isGlobal(value)) return UNKNOWN;
  const nodes = splitValue(value);
  return nodes ? cornerRadius(nodes.map((node) => valueParser.stringify(node))) : UNKNOWN;
};

/** `border-radius` per corner. Elliptical (`/`), %, and other units are unknown. */
export const parseBorderRadius = (value: string): Readonly<Record<Corner, Radius>> => {
  const unknownAll = { 'top-left': UNKNOWN, 'top-right': UNKNOWN, 'bottom-right': UNKNOWN, 'bottom-left': UNKNOWN };
  if (hasVar(value) || isGlobal(value)) return unknownAll;
  const nodes = splitValue(value);
  const box = nodes ? expandBox(nodes.map((node) => cornerRadius([valueParser.stringify(node)]))) : undefined;
  return box
    ? { 'top-left': box.top, 'top-right': box.right, 'bottom-right': box.bottom, 'bottom-left': box.left }
    : unknownAll;
};

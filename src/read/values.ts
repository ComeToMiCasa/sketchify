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

// --- Backgrounds (M6 fills) -------------------------------------------------------

/** What a background declaration says: its colour, and whether it paints an image or gradient. */
export type Background = { readonly color: Color | undefined; readonly image: boolean };

/** Any image layer: `url()`, gradients, `image-set()`, `element()`, `cross-fade()`, `paint()`. */
const IMAGE_FUNCTION = /\b(url|[a-z-]*gradient|image-set|element|cross-fade|paint|image)\(/i;

/**
 * The `background` shorthand. The colour can only be in the last layer; an omitted colour is
 * `transparent` (its initial value). Other layers or parts that paint an image set `image`.
 */
export const parseBackgroundShorthand = (value: string): Background => {
  if (isGlobal(value)) return { color: { kind: 'unknown', css: value }, image: false };
  const image = IMAGE_FUNCTION.test(value);
  if (hasVar(value)) return { color: { kind: 'unknown', css: value }, image };
  const layers = value.split(',');
  const last = layers.at(-1) ?? '';
  const nodes = valueParser(last).nodes.filter((node) => node.type !== 'space' && node.type !== 'comment' && node.type !== 'div');
  // Words that are not colours (positions, repeat, …) are skipped; currentColor is kept (not known at build time).
  const colors = nodes.map(nodeColor).filter((color) => color.kind !== 'unknown' || isCurrentColor(color));
  return { color: colors.at(-1) ?? { kind: 'transparent' }, image };
};

/** `background-image`: anything but `none` paints an image. */
export const paintsImage = (value: string): boolean => value.trim().toLowerCase() !== 'none';

// --- Underlines (M6d) ---------------------------------------------------------------

/** `text-decoration-line`: the lines (`none` is no line), or anything unknown (`var()`, global keywords). */
export type DecorationLine = { readonly kind: 'lines'; readonly lines: ReadonlyArray<string> } | { readonly kind: 'unknown' };

/** The parts of `text-decoration` that decide the underline. Omitted parts take their initial values. */
export type Decoration = {
  readonly line: DecorationLine;
  readonly style: Style;
  readonly color: Color;
  /** px, or undefined for `auto`, `from-font` and other units. */
  readonly thickness: number | undefined;
};

const DECORATION_LINES: ReadonlySet<string> = new Set(['none', 'underline', 'overline', 'line-through', 'blink', 'spelling-error', 'grammar-error']);
const DECORATION_STYLES: ReadonlySet<string> = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);

export const parseDecorationLine = (value: string): DecorationLine => {
  if (hasVar(value) || isGlobal(value)) return UNKNOWN;
  const words = (splitValue(value) ?? []).map((node) => valueParser.stringify(node).toLowerCase());
  if (words.length === 0 || !words.every((word) => DECORATION_LINES.has(word))) return UNKNOWN;
  return { kind: 'lines', lines: words.filter((word) => word !== 'none') };
};

export const parseDecorationStyle = (value: string): Style => {
  const lower = value.trim().toLowerCase();
  return DECORATION_STYLES.has(lower) ? { kind: 'keyword', keyword: lower } : UNKNOWN;
};

export const parseDecorationThickness = (value: string): number | undefined => {
  if (hasVar(value) || isGlobal(value)) return undefined;
  const px = lengthPx(value.trim().toLowerCase());
  return px !== undefined && px > 0 ? px : undefined;
};

/** The `text-decoration` shorthand: lines, style, colour and thickness in any order. */
export const parseTextDecoration = (value: string): Decoration => {
  const unknown: Decoration = { line: UNKNOWN, style: UNKNOWN, color: { kind: 'unknown', css: value }, thickness: undefined };
  if (hasVar(value) || isGlobal(value)) return unknown;
  const nodes = splitValue(value);
  if (!nodes || nodes.length === 0) return unknown;
  const initial: Decoration = { line: { kind: 'lines', lines: [] }, style: { kind: 'keyword', keyword: 'solid' }, color: { kind: 'unknown', css: 'currentcolor' }, thickness: undefined };
  return nodes.reduce<Decoration>((parts, node) => {
    const lower = valueParser.stringify(node).toLowerCase();
    if (node.type === 'word' && DECORATION_LINES.has(lower)) {
      const lines = parts.line.kind === 'lines' ? parts.line.lines : [];
      return { ...parts, line: { kind: 'lines', lines: lower === 'none' ? lines : [...lines, lower] } };
    }
    if (node.type === 'word' && DECORATION_STYLES.has(lower)) return { ...parts, style: { kind: 'keyword', keyword: lower } };
    if (node.type === 'word' && (lower === 'auto' || lower === 'from-font')) return { ...parts, thickness: undefined };
    if (node.type === 'word' && isLength(lower)) return { ...parts, thickness: parseDecorationThickness(lower) };
    return { ...parts, color: nodeColor(node) };
  }, initial);
};

/** A `display` keyword, lower-cased (`inline`, `block`, `inline flex`), or unknown. */
export type Display = { readonly kind: 'keyword'; readonly keyword: string } | { readonly kind: 'unknown' };

export const parseDisplay = (value: string): Display => {
  if (hasVar(value) || isGlobal(value)) return UNKNOWN;
  const words = (splitValue(value) ?? []).map((node) => valueParser.stringify(node).toLowerCase());
  return words.length === 0 ? UNKNOWN : { kind: 'keyword', keyword: words.join(' ') };
};

// --- Sizes (M6c exact hatch) -------------------------------------------------------

/** A `width`, `height` or `padding` value: px, or anything else (`auto`, `%`, `em`, `calc()`). */
export const parseLength = (value: string): Width => {
  if (hasVar(value) || isGlobal(value)) return UNKNOWN;
  const px = lengthPx(value.trim().toLowerCase());
  return px === undefined ? UNKNOWN : { kind: 'px', px };
};

/** `padding` per side (1–4 values). */
export const parsePadding = (value: string): Readonly<Record<Side, Width>> =>
  parseBoxValue<Width>(value, parseLength, UNKNOWN) ?? { top: UNKNOWN, right: UNKNOWN, bottom: UNKNOWN, left: UNKNOWN };

export type BoxSizing = { readonly kind: 'keyword'; readonly keyword: 'border-box' | 'content-box' } | { readonly kind: 'unknown' };

/** `box-sizing`; `inherit` and other keywords are unknown at build time. */
export const parseBoxSizing = (value: string): BoxSizing => {
  const lower = value.trim().toLowerCase();
  return lower === 'border-box' || lower === 'content-box' ? { kind: 'keyword', keyword: lower } : UNKNOWN;
};

/** `--sketch-size: W H` (or `W` for a square): the border-box size in px, unitless or `px`. */
export type SizeHint = { readonly kind: 'size'; readonly width: number; readonly height: number } | { readonly kind: 'invalid'; readonly css: string };

const hintNumber = (word: string): number | undefined => {
  const dimension = valueParser.unit(word);
  if (!dimension) return undefined;
  const unit = dimension.unit.toLowerCase();
  const number = Number(dimension.number);
  return (unit === '' || unit === 'px') && Number.isFinite(number) && number > 0 ? number : undefined;
};

export const parseSizeHint = (value: string): SizeHint => {
  const invalid: SizeHint = { kind: 'invalid', css: value.trim() };
  const nodes = splitValue(value);
  if (!nodes || nodes.length < 1 || nodes.length > 2 || nodes.some((node) => node.type !== 'word')) return invalid;
  const numbers = nodes.map((node) => hintNumber(node.value));
  const width = numbers[0];
  const height = numbers.length === 2 ? numbers[1] : width;
  return width === undefined || height === undefined ? invalid : { kind: 'size', width, height };
};

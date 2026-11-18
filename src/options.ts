import { parseColor } from './read/values';
import { WARNING_KINDS, type WarningKind, isWarningKind } from './report/warnings';
import type { Result } from './report/diagnostics';

export type RoughnessPreset = 'subtle' | 'normal' | 'messy';

/** Options accepted by the plugin. Global only; per-rule overrides are out of scope (spec "Options"). */
export type SketchifyOptions = {
  /** A preset name or a Rough.js roughness number (0 or more). Default `normal`. */
  readonly roughness?: RoughnessPreset | number;
  /**
   * Hatch fill (`--sketch-fill: hatch`, spec "Options"): a preset name, or numbers (px without a
   * unit) on top of a preset (`{ preset: 'bold', gap: 10 }`; `normal` when no preset is named).
   */
  readonly hatch?: HatchPreset | (Partial<HatchOptions> & { readonly preset?: HatchPreset });
  /**
   * Colours of `@sketchify base` (spec "Form controls and @sketchify base"): outlines in `ink`, ticks, dots
   * and focus in `accent`; `dark` replaces them under `prefers-color-scheme: dark`. Literal colours.
   */
  readonly base?: Partial<BaseColors> & { readonly dark?: Partial<BaseColors> };
  /** Warning kinds to leave out (spec "Limits and errors", M8), such as `['style', 'clip']`. */
  readonly quiet?: ReadonlyArray<WarningKind>;
  /** The CSS size budget (M8): a warning when the added size (gzip, KB) is over it. `false` turns it off. */
  readonly budget?: { readonly gzip: number } | false;
};

/** The two colours of the base drawings. */
export type BaseColors = { readonly ink: string; readonly accent: string };

export type BaseOptions = BaseColors & { readonly dark?: BaseColors };

export const BASE_DEFAULTS: BaseColors = { ink: '#1d2433', accent: '#2563eb' };

export type HatchPreset = 'fine' | 'normal' | 'bold';

/** Hatch options (spec "Options" table). */
export type HatchOptions = {
  /** Distance between strokes along the horizontal (px). */
  readonly gap: number;
  /** Median stroke weight (px). */
  readonly weight: number;
  /** How much each stroke's weight differs, ± (px). */
  readonly weightJitter: number;
  /** How much the weight changes along one stroke, ± as a fraction (0.16 = ±16%). */
  readonly pressure: number;
  /** Length over which the pressure swells and thins once (px). Bigger means a bigger tile. */
  readonly pressureLength: number;
  /** The strokes' gentle bow (px). */
  readonly bow: number;
  /** Stroke ends on elements of known size (M6c). */
  readonly ends: 'taper' | 'square';
  /** How far strokes may run past the border on elements of known size (px, M6c). */
  readonly over: number;
};

/** The default hatch: the `normal` preset, a marker (thick, nearly even strokes). */
export const HATCH_DEFAULTS: HatchOptions = {
  gap: 16,
  weight: 6,
  weightJitter: 0.15,
  pressure: 0.04,
  pressureLength: 136,
  bow: 0.5,
  ends: 'square',
  over: 4,
};

/**
 * Hatch weight presets. `fine` is a pen (thin strokes whose weight varies with pressure); `normal`
 * and `bold` are markers (thick strokes of nearly even weight, about half ink, half gap). Tune with
 * the slider page (`npm run tune:hatch`); test/browser/hatch-presets.spec.ts measures the drawn
 * weight and gap against this table.
 */
export const HATCH_PRESETS: Readonly<Record<HatchPreset, HatchOptions>> = {
  fine: { ...HATCH_DEFAULTS, weight: 1.9, weightJitter: 0.25, gap: 6, pressure: 0.16 },
  normal: HATCH_DEFAULTS,
  bold: { ...HATCH_DEFAULTS, weight: 9, weightJitter: 0.2, gap: 24 },
};

const HATCH_PRESET_NAMES: ReadonlyArray<HatchPreset> = ['fine', 'normal', 'bold'];

const isHatchPreset = (value: unknown): value is HatchPreset =>
  typeof value === 'string' && (HATCH_PRESET_NAMES as ReadonlyArray<string>).includes(value);

/** Rough.js parameters for one roughness level. `maxRandomnessOffset` is the "overshoot" in the spec. */
export type Rough = {
  readonly roughness: number;
  readonly bowing: number;
  readonly maxRandomnessOffset: number;
};

export type ResolvedOptions = {
  readonly rough: Rough;
  /** Present only when the user set hatch options; use `hatchOf` for the full set with defaults. */
  readonly hatch?: HatchOptions;
  /** Present only when the user set base colours; use `baseOf` for the full set with defaults. */
  readonly base?: BaseOptions;
  /** Warning kinds left out (M8). */
  readonly quiet?: ReadonlyArray<WarningKind>;
  /** The added gzip size (KB) over which a warning is given, or `false` for none (M8). Default `BUDGET_GZIP_KB`. */
  readonly budget?: number | false;
};

/** The default budget: added gzip KB per file (spec "Size budget"). Calibrated in M8: pages add 2–11KB, Water.css 6.8KB, the many-combination design-system page 22.9KB. */
export const BUDGET_GZIP_KB = 30;

export const budgetOf = (options: ResolvedOptions): number | false => (options.budget === undefined ? BUDGET_GZIP_KB : options.budget);

export const hatchOf = (options: ResolvedOptions): HatchOptions => options.hatch ?? HATCH_DEFAULTS;

export const baseOf = (options: ResolvedOptions): BaseOptions => options.base ?? BASE_DEFAULTS;

export const PRESETS: Readonly<Record<RoughnessPreset, Rough>> = {
  subtle: { roughness: 0.6, bowing: 0.6, maxRandomnessOffset: 1.2 },
  normal: { roughness: 1.3, bowing: 1.2, maxRandomnessOffset: 2 },
  messy: { roughness: 2.4, bowing: 2.2, maxRandomnessOffset: 3 },
};

const PRESET_NAMES: ReadonlyArray<RoughnessPreset> = ['subtle', 'normal', 'messy'];

const isPreset = (value: unknown): value is RoughnessPreset =>
  typeof value === 'string' && (PRESET_NAMES as ReadonlyArray<string>).includes(value);

/**
 * Bowing and overshoot for a roughness number, by linear interpolation between the presets.
 * The preset roughness values give exactly the preset; outside 0.6–2.4 the end segment's
 * slope continues, and nothing goes below 0.
 */
export const roughFromNumber = (roughness: number): Rough => {
  const exact = PRESET_NAMES.map((name) => PRESETS[name]).find((preset) => preset.roughness === roughness);
  if (exact) return exact;
  const [from, to] = roughness <= PRESETS.normal.roughness ? [PRESETS.subtle, PRESETS.normal] : [PRESETS.normal, PRESETS.messy];
  const t = (roughness - from.roughness) / (to.roughness - from.roughness);
  const lerp = (a: number, b: number): number => Math.max(0, a + (b - a) * t);
  return {
    roughness,
    bowing: lerp(from.bowing, to.bowing),
    maxRandomnessOffset: lerp(from.maxRandomnessOffset, to.maxRandomnessOffset),
  };
};

type Diagnostics = Result<unknown>['diagnostics'];

const optionError = (message: string): Diagnostics => [{ severity: 'error', message }];

const resolveRoughness = (roughness: unknown): Result<Rough> => {
  if (roughness === undefined) return { value: PRESETS.normal, diagnostics: [] };
  if (isPreset(roughness)) return { value: PRESETS[roughness], diagnostics: [] };
  if (typeof roughness === 'number' && Number.isFinite(roughness) && roughness >= 0) return { value: roughFromNumber(roughness), diagnostics: [] };
  return {
    value: PRESETS.normal,
    diagnostics: optionError(`roughness must be 'subtle', 'normal', 'messy' or a number from 0. Got: ${JSON.stringify(roughness)}`),
  };
};

type NumberRule = { readonly name: Exclude<keyof HatchOptions, 'ends'>; readonly ok: (n: number, all: HatchOptions) => boolean; readonly range: string };

const HATCH_NUMBERS: ReadonlyArray<NumberRule> = [
  { name: 'gap', ok: (n) => n >= 2, range: 'at least 2' },
  { name: 'weight', ok: (n) => n > 0, range: 'greater than 0' },
  { name: 'weightJitter', ok: (n) => n >= 0, range: 'at least 0' },
  { name: 'pressure', ok: (n) => n >= 0 && n <= 0.9, range: 'from 0 to 0.9 (a ratio: 0.16 = ±16%)' },
  { name: 'pressureLength', ok: (n, all) => n > all.gap, range: 'greater than gap' },
  { name: 'bow', ok: (n) => n >= 0, range: 'at least 0' },
  { name: 'over', ok: (n) => n >= 0, range: 'at least 0' },
];

const PRESET_LIST = HATCH_PRESET_NAMES.map((name) => `'${name}'`).join(', ');

const resolveHatch = (hatch: unknown): Result<HatchOptions | undefined> => {
  if (hatch === undefined) return { value: undefined, diagnostics: [] };
  if (isHatchPreset(hatch)) return { value: HATCH_PRESETS[hatch], diagnostics: [] };
  if (typeof hatch !== 'object' || hatch === null) {
    return { value: undefined, diagnostics: optionError(`hatch must be a preset name (${PRESET_LIST}) or an object. Got: ${JSON.stringify(hatch)}`) };
  }
  const { preset, ...given } = hatch as Readonly<Record<string, unknown>>;
  if (preset !== undefined && !isHatchPreset(preset)) {
    return { value: undefined, diagnostics: optionError(`hatch.preset must be one of ${PRESET_LIST}. Got: ${JSON.stringify(preset)}`) };
  }
  const unknownKeys = Object.keys(given).filter((key) => !(key in HATCH_DEFAULTS));
  const merged = { ...(preset === undefined ? HATCH_DEFAULTS : HATCH_PRESETS[preset]), ...given } as HatchOptions;
  const numberErrors = HATCH_NUMBERS.flatMap(({ name, ok, range }) => {
    const value: unknown = merged[name];
    return typeof value === 'number' && Number.isFinite(value) && ok(value, merged)
      ? []
      : optionError(`hatch.${name} must be a number ${range} (px, without a unit). Got: ${JSON.stringify(value)}`);
  });
  const endsErrors = merged.ends === 'taper' || merged.ends === 'square' ? [] : optionError(`hatch.ends must be 'taper' or 'square'. Got: ${JSON.stringify(merged.ends)}`);
  const keyErrors = unknownKeys.flatMap((key) => optionError(`Unknown hatch option: ${key}. Known options: preset, ${Object.keys(HATCH_DEFAULTS).join(', ')}`));
  const diagnostics = [...keyErrors, ...numberErrors, ...endsErrors];
  return { value: diagnostics.length > 0 ? undefined : merged, diagnostics };
};

const COLOR_KEYS: ReadonlyArray<keyof BaseColors> = ['ink', 'accent'];

/** One set of base colours: known keys, literal colours (they are baked into the drawings). */
const resolveColors = (given: unknown, path: string, fallback: BaseColors): Result<BaseColors> => {
  if (typeof given !== 'object' || given === null) {
    return { value: fallback, diagnostics: optionError(`${path} must be an object. Got: ${JSON.stringify(given)}`) };
  }
  const entries = given as Readonly<Record<string, unknown>>;
  const keyErrors = Object.keys(entries)
    .filter((key) => !(COLOR_KEYS as ReadonlyArray<string>).includes(key) && !(path === 'base' && key === 'dark'))
    .flatMap((key) => optionError(`Unknown ${path} option: ${key}. Known options: ink, accent${path === 'base' ? ', dark' : ''}`));
  const colors = COLOR_KEYS.map((key) => {
    const value = entries[key] ?? fallback[key];
    const parsed = typeof value === 'string' ? parseColor(value) : undefined;
    return parsed?.kind === 'literal'
      ? { key, css: parsed.css, diagnostics: [] }
      : { key, css: fallback[key], diagnostics: optionError(`${path}.${key} must be a colour known at build time (#hex, rgb() and so on; not var() or currentColor). Got: ${JSON.stringify(value)}`) };
  });
  const value = Object.fromEntries(colors.map((c) => [c.key, c.css])) as BaseColors;
  return { value, diagnostics: [...keyErrors, ...colors.flatMap((c) => c.diagnostics)] };
};

const resolveBase = (base: unknown): Result<BaseOptions | undefined> => {
  if (base === undefined) return { value: undefined, diagnostics: [] };
  const light = resolveColors(base, 'base', BASE_DEFAULTS);
  const darkGiven = typeof base === 'object' && base !== null ? (base as Readonly<Record<string, unknown>>)['dark'] : undefined;
  const dark = darkGiven === undefined ? undefined : resolveColors(darkGiven, 'base.dark', light.value);
  const diagnostics = [...light.diagnostics, ...(dark?.diagnostics ?? [])];
  return { value: diagnostics.length > 0 ? undefined : { ...light.value, ...(dark ? { dark: dark.value } : {}) }, diagnostics };
};

const resolveQuiet = (quiet: unknown): Result<ReadonlyArray<WarningKind> | undefined> => {
  if (quiet === undefined) return { value: undefined, diagnostics: [] };
  const list = Array.isArray(quiet) ? (quiet as ReadonlyArray<unknown>) : undefined;
  const wrong = list ? list.filter((kind) => !isWarningKind(kind)) : [quiet];
  if (!list || wrong.length > 0) {
    return { value: undefined, diagnostics: optionError(`quiet must be an array of warning names (${WARNING_KINDS.join(', ')}). Got: ${JSON.stringify(list ? wrong : quiet)}`) };
  }
  return { value: list.filter(isWarningKind), diagnostics: [] };
};

const resolveBudget = (budget: unknown): Result<number | false | undefined> => {
  if (budget === undefined || budget === false) return { value: budget, diagnostics: [] };
  const gzip = typeof budget === 'object' && budget !== null ? (budget as Readonly<Record<string, unknown>>)['gzip'] : undefined;
  if (typeof gzip === 'number' && Number.isFinite(gzip) && gzip > 0 && Object.keys(budget as object).length === 1) return { value: gzip, diagnostics: [] };
  return { value: undefined, diagnostics: optionError(`budget must be { gzip: KB greater than 0 } or false. Got: ${JSON.stringify(budget)}`) };
};

/** Validates user options (they may come from plain JS) and fills in defaults. */
export const resolveOptions = (options: unknown): Result<ResolvedOptions> => {
  const fallback: ResolvedOptions = { rough: PRESETS.normal };
  if (options === undefined || options === null) return { value: fallback, diagnostics: [] };
  if (typeof options !== 'object') {
    return { value: fallback, diagnostics: [{ severity: 'error', message: `Options must be an object. Got: ${String(options)}` }] };
  }
  const given = options as Readonly<Record<string, unknown>>;
  const rough = resolveRoughness(given['roughness']);
  const hatch = resolveHatch(given['hatch']);
  const base = resolveBase(given['base']);
  const quiet = resolveQuiet(given['quiet']);
  const budget = resolveBudget(given['budget']);
  return {
    value: {
      rough: rough.value,
      ...(hatch.value ? { hatch: hatch.value } : {}),
      ...(base.value ? { base: base.value } : {}),
      ...(quiet.value ? { quiet: quiet.value } : {}),
      ...(budget.value === undefined ? {} : { budget: budget.value }),
    },
    diagnostics: [...rough.diagnostics, ...hatch.diagnostics, ...base.diagnostics, ...quiet.diagnostics, ...budget.diagnostics],
  };
};

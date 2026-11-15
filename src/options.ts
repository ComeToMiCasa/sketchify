import type { Result } from './report/diagnostics';

export type RoughnessPreset = 'subtle' | 'normal' | 'messy';

/** Options accepted by the plugin. Global only; per-rule overrides are out of scope (spec "옵션"). */
export type SketchifyOptions = {
  /** A preset name or a Rough.js roughness number (0 or more). Default `normal`. */
  readonly roughness?: RoughnessPreset | number;
  /**
   * Hatch fill (`--sketch-fill: hatch`, spec "옵션"): a preset name, or numbers (px without a
   * unit) on top of a preset (`{ preset: 'bold', gap: 10 }`; `normal` when no preset is named).
   */
  readonly hatch?: HatchPreset | (Partial<HatchOptions> & { readonly preset?: HatchPreset });
};

export type HatchPreset = 'fine' | 'normal' | 'bold';

/** Hatch options (spec "옵션" table). */
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

/** Rough.js parameters for one roughness level. `maxRandomnessOffset` is "삐침" in the spec. */
export type Rough = {
  readonly roughness: number;
  readonly bowing: number;
  readonly maxRandomnessOffset: number;
};

export type ResolvedOptions = {
  readonly rough: Rough;
  /** Present only when the user set hatch options; use `hatchOf` for the full set with defaults. */
  readonly hatch?: HatchOptions;
};

export const hatchOf = (options: ResolvedOptions): HatchOptions => options.hatch ?? HATCH_DEFAULTS;

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
    diagnostics: optionError(`roughness는 'subtle', 'normal', 'messy' 중 하나이거나 0 이상의 숫자여야 합니다. 받은 값: ${JSON.stringify(roughness)}`),
  };
};

type NumberRule = { readonly name: Exclude<keyof HatchOptions, 'ends'>; readonly ok: (n: number, all: HatchOptions) => boolean; readonly range: string };

const HATCH_NUMBERS: ReadonlyArray<NumberRule> = [
  { name: 'gap', ok: (n) => n >= 2, range: '2 이상' },
  { name: 'weight', ok: (n) => n > 0, range: '0보다 큰 수' },
  { name: 'weightJitter', ok: (n) => n >= 0, range: '0 이상' },
  { name: 'pressure', ok: (n) => n >= 0 && n <= 0.9, range: '0~0.9 (비율, 0.16 = ±16%)' },
  { name: 'pressureLength', ok: (n, all) => n > all.gap, range: 'gap보다 큰 수' },
  { name: 'bow', ok: (n) => n >= 0, range: '0 이상' },
  { name: 'over', ok: (n) => n >= 0, range: '0 이상' },
];

const PRESET_LIST = HATCH_PRESET_NAMES.map((name) => `'${name}'`).join(', ');

const resolveHatch = (hatch: unknown): Result<HatchOptions | undefined> => {
  if (hatch === undefined) return { value: undefined, diagnostics: [] };
  if (isHatchPreset(hatch)) return { value: HATCH_PRESETS[hatch], diagnostics: [] };
  if (typeof hatch !== 'object' || hatch === null) {
    return { value: undefined, diagnostics: optionError(`hatch 옵션은 프리셋 이름(${PRESET_LIST})이나 객체여야 합니다. 받은 값: ${JSON.stringify(hatch)}`) };
  }
  const { preset, ...given } = hatch as Readonly<Record<string, unknown>>;
  if (preset !== undefined && !isHatchPreset(preset)) {
    return { value: undefined, diagnostics: optionError(`hatch.preset은 ${PRESET_LIST} 중 하나여야 합니다. 받은 값: ${JSON.stringify(preset)}`) };
  }
  const unknownKeys = Object.keys(given).filter((key) => !(key in HATCH_DEFAULTS));
  const merged = { ...(preset === undefined ? HATCH_DEFAULTS : HATCH_PRESETS[preset]), ...given } as HatchOptions;
  const numberErrors = HATCH_NUMBERS.flatMap(({ name, ok, range }) => {
    const value: unknown = merged[name];
    return typeof value === 'number' && Number.isFinite(value) && ok(value, merged)
      ? []
      : optionError(`hatch.${name}는 ${range}인 숫자(px, 단위 없이)여야 합니다. 받은 값: ${JSON.stringify(value)}`);
  });
  const endsErrors = merged.ends === 'taper' || merged.ends === 'square' ? [] : optionError(`hatch.ends는 'taper' 또는 'square'여야 합니다. 받은 값: ${JSON.stringify(merged.ends)}`);
  const keyErrors = unknownKeys.flatMap((key) => optionError(`알 수 없는 hatch 옵션: ${key}. 쓸 수 있는 옵션: preset, ${Object.keys(HATCH_DEFAULTS).join(', ')}`));
  const diagnostics = [...keyErrors, ...numberErrors, ...endsErrors];
  return { value: diagnostics.length > 0 ? undefined : merged, diagnostics };
};

/** Validates user options (they may come from plain JS) and fills in defaults. */
export const resolveOptions = (options: unknown): Result<ResolvedOptions> => {
  const fallback: ResolvedOptions = { rough: PRESETS.normal };
  if (options === undefined || options === null) return { value: fallback, diagnostics: [] };
  if (typeof options !== 'object') {
    return { value: fallback, diagnostics: [{ severity: 'error', message: `옵션은 객체여야 합니다. 받은 값: ${String(options)}` }] };
  }
  const given = options as Readonly<Record<string, unknown>>;
  const rough = resolveRoughness(given['roughness']);
  const hatch = resolveHatch(given['hatch']);
  return {
    value: hatch.value ? { rough: rough.value, hatch: hatch.value } : { rough: rough.value },
    diagnostics: [...rough.diagnostics, ...hatch.diagnostics],
  };
};

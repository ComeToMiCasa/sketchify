import type { Result } from './report/diagnostics';

export type RoughnessPreset = 'subtle' | 'normal' | 'messy';

/** Options accepted by the plugin. Global only; per-rule overrides are out of scope (spec "옵션"). */
export type SketchifyOptions = {
  /** A preset name or a Rough.js roughness number (0 or more). Default `normal`. */
  readonly roughness?: RoughnessPreset | number;
};

/** Rough.js parameters for one roughness level. `maxRandomnessOffset` is "삐침" in the spec. */
export type Rough = {
  readonly roughness: number;
  readonly bowing: number;
  readonly maxRandomnessOffset: number;
};

export type ResolvedOptions = {
  readonly rough: Rough;
};

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

/** Validates user options (they may come from plain JS) and fills in defaults. */
export const resolveOptions = (options: unknown): Result<ResolvedOptions> => {
  const fallback: ResolvedOptions = { rough: PRESETS.normal };
  if (options === undefined || options === null) return { value: fallback, diagnostics: [] };
  if (typeof options !== 'object') {
    return { value: fallback, diagnostics: [{ severity: 'error', message: `옵션은 객체여야 합니다. 받은 값: ${String(options)}` }] };
  }
  const roughness: unknown = (options as Readonly<Record<string, unknown>>)['roughness'];
  if (roughness === undefined) return { value: fallback, diagnostics: [] };
  if (isPreset(roughness)) return { value: { rough: PRESETS[roughness] }, diagnostics: [] };
  if (typeof roughness === 'number' && Number.isFinite(roughness) && roughness >= 0) {
    return { value: { rough: roughFromNumber(roughness) }, diagnostics: [] };
  }
  return {
    value: fallback,
    diagnostics: [
      {
        severity: 'error',
        message: `roughness는 'subtle', 'normal', 'messy' 중 하나이거나 0 이상의 숫자여야 합니다. 받은 값: ${JSON.stringify(roughness)}`,
      },
    ],
  };
};

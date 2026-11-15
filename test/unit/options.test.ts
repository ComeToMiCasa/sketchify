import { describe, expect, it } from 'vitest';
import { HATCH_DEFAULTS, HATCH_PRESETS, PRESETS, resolveOptions, roughFromNumber } from '../../src/options';
import { hatchTileSize } from '../../src/draw/hatch';

describe('resolveOptions', () => {
  it('defaults to normal', () => {
    expect(resolveOptions(undefined)).toEqual({ value: { rough: PRESETS.normal }, diagnostics: [] });
    expect(resolveOptions({})).toEqual({ value: { rough: PRESETS.normal }, diagnostics: [] });
  });

  it.each(['subtle', 'normal', 'messy'] as const)('accepts the %s preset', (name) => {
    expect(resolveOptions({ roughness: name }).value.rough).toBe(PRESETS[name]);
  });

  it.each(['wild', -0.1, Number.NaN, Number.POSITIVE_INFINITY, '1.3', null])('rejects roughness %s', (roughness) => {
    const result = resolveOptions({ roughness });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('rejects non-object options', () => {
    expect(resolveOptions('messy').diagnostics[0]?.severity).toBe('error');
  });
});

describe('roughFromNumber', () => {
  it('matches the presets at their roughness values', () => {
    expect(roughFromNumber(0.6)).toEqual(PRESETS.subtle);
    expect(roughFromNumber(1.3)).toEqual(PRESETS.normal);
    expect(roughFromNumber(2.4)).toEqual(PRESETS.messy);
  });

  it('interpolates between presets', () => {
    const halfway = roughFromNumber(1.85);
    expect(halfway.bowing).toBeCloseTo(1.7);
    expect(halfway.maxRandomnessOffset).toBeCloseTo(2.5);
  });

  it('extends the end slopes and never goes below 0', () => {
    expect(roughFromNumber(3.5).bowing).toBeCloseTo(3.2);
    const zero = roughFromNumber(0);
    expect(zero.bowing).toBeGreaterThanOrEqual(0);
    expect(zero.maxRandomnessOffset).toBeGreaterThanOrEqual(0);
    expect(roughFromNumber(0).roughness).toBe(0);
  });
});

describe('hatch options', () => {
  it('are left out unless given, and filled with defaults when given', () => {
    expect(resolveOptions({}).value.hatch).toBeUndefined();
    expect(resolveOptions({ hatch: { gap: 8 } })).toEqual({ value: { rough: PRESETS.normal, hatch: { ...HATCH_DEFAULTS, gap: 8 } }, diagnostics: [] });
  });

  it.each([
    [{ gap: 1 }, 'hatch.gap'],
    [{ weight: 0 }, 'hatch.weight'],
    [{ pressure: 16 }, 'hatch.pressure'],
    [{ pressureLength: 4 }, 'hatch.pressureLength'],
    [{ ends: 'round' }, 'hatch.ends'],
    [{ gap: '6px' }, 'hatch.gap'],
    [{ spacing: 6 }, '알 수 없는 hatch 옵션: spacing'],
  ])('rejects %j', (hatch, text) => {
    const result = resolveOptions({ hatch });
    expect(result.diagnostics.map((d) => d.message).join('\n')).toContain(text);
  });
});

describe('hatch presets', () => {
  const names = Object.keys(HATCH_PRESETS) as ReadonlyArray<keyof typeof HATCH_PRESETS>;

  it('normal is the default hatch', () => {
    expect(HATCH_PRESETS.normal).toEqual(HATCH_DEFAULTS);
  });

  it('are ordered from fine to bold, in weight and in gap', () => {
    expect(HATCH_PRESETS.fine.weight).toBeLessThan(HATCH_PRESETS.normal.weight);
    expect(HATCH_PRESETS.normal.weight).toBeLessThan(HATCH_PRESETS.bold.weight);
    expect(HATCH_PRESETS.fine.gap).toBeLessThanOrEqual(HATCH_PRESETS.normal.gap);
    expect(HATCH_PRESETS.normal.gap).toBeLessThanOrEqual(HATCH_PRESETS.bold.gap);
  });

  // These read the table, so tuning a preset's numbers keeps them meaningful.
  describe.each(names)('%s', (name) => {
    const preset = HATCH_PRESETS[name];

    it('is chosen by name', () => {
      expect(resolveOptions({ hatch: name })).toEqual({ value: { rough: PRESETS.normal, hatch: preset }, diagnostics: [] });
    });

    it('passes its own validation (the same rules as numbers given by hand)', () => {
      expect(resolveOptions({ hatch: { ...preset } }).diagnostics).toEqual([]);
    });

    it('is the base for numbers given with it', () => {
      expect(resolveOptions({ hatch: { preset: name, gap: preset.gap + 2 } }).value.hatch).toEqual({ ...preset, gap: preset.gap + 2 });
    });

    it('gives a tile that its gap divides', () => {
      expect(hatchTileSize(preset) % preset.gap).toBe(0);
      expect(hatchTileSize(preset)).toBeGreaterThan(preset.gap);
    });
  });

  it('rejects an unknown preset', () => {
    expect(resolveOptions({ hatch: 'heavy' }).diagnostics[0]?.message).toContain("'fine', 'normal', 'bold'");
    expect(resolveOptions({ hatch: { preset: 'heavy' } }).diagnostics[0]?.message).toContain('hatch.preset');
  });
});

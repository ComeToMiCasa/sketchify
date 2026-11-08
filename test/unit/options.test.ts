import { describe, expect, it } from 'vitest';
import { PRESETS, resolveOptions, roughFromNumber } from '../../src/options';

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

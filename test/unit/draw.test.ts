import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../src/options';
import { drawNineSlice, drawStrip, nineSliceGeometry, stripGeometry } from '../../src/draw/stroke';
import { dataUri, round1, tidyPath } from '../../src/draw/svg';

describe('svg helpers', () => {
  it('rounds to one decimal without -0', () => {
    expect(round1(1.26)).toBe(1.3);
    expect(Object.is(round1(-0.04), 0)).toBe(true);
  });

  it('tidies every number in a path', () => {
    expect(tidyPath('M7.8588 4.1835 C34.634 6.616, -0.04 1e-7')).toBe('M7.9 4.2 C34.6 6.6, 0 0');
  });

  it('escapes % first, then #, <, > and "', () => {
    expect(dataUri(`<svg a="#f" b='50%'>`)).toBe(`url("data:image/svg+xml,%3Csvg a=%22%23f%22 b='50%25'%3E")`);
  });
});

describe('nineSliceGeometry', () => {
  it('keeps the prototype values for usual widths', () => {
    expect(nineSliceGeometry(2, 0)).toEqual({ margin: 6, slice: 14, size: 148, outset: 5 });
    expect(nineSliceGeometry(2, 12)).toEqual({ margin: 4, slice: 16, size: 152, outset: 3 });
    expect(nineSliceGeometry(1, 2)).toEqual({ margin: 4, slice: 8, size: 136, outset: 3.5 });
  });

  it('pushes the margin out for thick lines so the outset stays positive', () => {
    const thick = nineSliceGeometry(12, 6);
    expect(thick.margin).toBe(8);
    expect(thick.outset).toBe(2);
  });
});

describe('drawNineSlice', () => {
  const input = { width: 2, radius: 12, color: '#1d2433', rough: PRESETS.normal, seed: 11 };

  it('is deterministic', () => {
    expect(drawNineSlice(input).svg).toBe(drawNineSlice(input).svg);
  });

  it('bakes the colour and the scaled stroke width into the SVG', () => {
    const { svg, url } = drawNineSlice(input);
    expect(svg).toContain("stroke='#1d2433'");
    expect(svg).toContain("stroke-width='1.7'");
    expect(svg).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='152' height='152'/);
    expect(url.startsWith('url("data:image/svg+xml,%3Csvg')).toBe(true);
  });

  it('changes with seed, roughness and radius', () => {
    const base = drawNineSlice(input).svg;
    expect(drawNineSlice({ ...input, seed: 12 }).svg).not.toBe(base);
    expect(drawNineSlice({ ...input, rough: PRESETS.messy }).svg).not.toBe(base);
    expect(drawNineSlice({ ...input, radius: 0 }).svg).not.toBe(base);
  });
});

describe('stripGeometry', () => {
  it('gives only the line side a width, fixes 16px ends and centres the line on the border', () => {
    expect(stripGeometry(1, 'bottom')).toEqual({
      svgWidth: 152,
      svgHeight: 11,
      across: 11,
      placement: { slice: '0 16 11 16', width: '0 16px 11px 16px', outset: '11px 3px 5px 3px' },
    });
    expect(stripGeometry(4, 'left')).toMatchObject({ svgWidth: 14, svgHeight: 152, placement: { slice: '16 0 16 14', outset: '3px 14px 3px 5px' } });
  });
});

describe('drawStrip', () => {
  const input = { side: 'bottom' as const, width: 2, color: '#1d2433', rough: PRESETS.normal, seed: 11 };

  it('is deterministic, one line, flipped by a transform', () => {
    const { svg } = drawStrip(input);
    expect(drawStrip(input).svg).toBe(svg);
    expect(svg).toMatch(/^<svg [^>]*width='152' height='12'/);
    expect(drawStrip(input, 'x').svg).toContain("transform='matrix(-1 0 0 1 152 0)'");
    expect(drawStrip(input, 'y').svg).toContain("transform='matrix(1 0 0 -1 0 12)'");
  });

  it('draws vertical sides vertically', () => {
    expect(drawStrip({ ...input, side: 'left' }).svg).toMatch(/^<svg [^>]*width='12' height='152'/);
  });
});

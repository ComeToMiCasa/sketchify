import { describe, expect, it } from 'vitest';
import { HATCH_DEFAULTS, HATCH_PRESETS, PRESETS } from '../../src/options';
import { drawHatchTile, hatchTileSize } from '../../src/draw/hatch';
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

describe('drawNineSlice with a fill (M6a)', () => {
  const input = { width: 2, radius: 6, color: '#1d2433', rough: PRESETS.normal, seed: 11 };

  it('draws the fill under the line, deterministically', () => {
    const { svg } = drawNineSlice({ ...input, fill: { kind: 'rough', color: '#ffe38a' } });
    expect(drawNineSlice({ ...input, fill: { kind: 'rough', color: '#ffe38a' } }).svg).toBe(svg);
    expect(svg.indexOf("fill='#ffe38a'")).toBeGreaterThan(0);
    expect(svg.indexOf("fill='#ffe38a'")).toBeLessThan(svg.indexOf("stroke='#1d2433'"));
  });

  it('a marker is translucent and needs more room past the element', () => {
    const marker = drawNineSlice({ ...input, fill: { kind: 'marker', color: '#fff59d' } });
    expect(marker.svg).toContain("fill-opacity='0.55'");
    expect(marker.outset).toBeGreaterThanOrEqual(6);
    expect(drawNineSlice(input).outset).toBeLessThan(6);
  });

  it('draws no line without a border', () => {
    const { svg } = drawNineSlice({ ...input, width: 0, color: 'transparent', fill: { kind: 'rough', color: 'blue' } });
    expect(svg).not.toContain('stroke-width');
    expect(svg).toContain("fill='blue'");
  });
});

describe('hatch tile (M6b)', () => {
  it('is 192px with the defaults (normal, gap 16), for fine (gap 6) and bold (gap 24), and a multiple of the gap', () => {
    expect(hatchTileSize(HATCH_DEFAULTS)).toBe(192); // 2 × 16 × round(136 / (√2 × 16))
    expect(hatchTileSize({ gap: 6, pressureLength: 136 })).toBe(192);
    expect(hatchTileSize({ gap: 24, pressureLength: 136 })).toBe(192);
    expect(hatchTileSize({ gap: 9, pressureLength: 136 })).toBe(198);
    expect(hatchTileSize({ gap: 8, pressureLength: 100 }) % 8).toBe(0);
    expect(hatchTileSize({ gap: 5, pressureLength: 200 }) % 5).toBe(0);
  });

  it('is deterministic and coloured', () => {
    const tile = drawHatchTile('#ffe38a', HATCH_DEFAULTS, 7);
    expect(drawHatchTile('#ffe38a', HATCH_DEFAULTS, 7).svg).toBe(tile.svg);
    expect(tile.svg).toMatch(/^<svg [^>]*width='192' height='192'/);
    expect(tile.svg).toContain("fill='#ffe38a'");
  });

  it('continues across the seams: a stroke leaving one edge enters the opposite edge at the same place', () => {
    const tile = drawHatchTile('#000', HATCH_DEFAULTS, 7);
    const T = tile.size;
    // Ribbon outline points near the right edge, shifted back by T, must also exist near the left edge.
    // Only points inside the tile (0 ≤ y ≤ T) count: the ones past it are never shown.
    const points = [...tile.svg.matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const key = ([x, y]: readonly [number, number]): string => `${x.toFixed(1)},${y.toFixed(1)}`;
    const left = new Set(points.filter(([x]) => x >= -6 && x <= 0).map(key));
    const fromRight = points.filter(([x, y]) => x >= T - 6 && x <= T && y >= 0 && y <= T).map(([x, y]) => key([x - T, y]));
    expect(fromRight.length).toBeGreaterThan(20);
    expect(fromRight.filter((p) => left.has(p)).length / fromRight.length).toBeGreaterThan(0.95);
  });

  // Ink at a point: inside any ribbon outline (each `M…Z` is one stroke).
  const inkAt = (svg: string) => {
    const polygons = [...svg.matchAll(/M([^Z]+)Z/g)].map((m) =>
      (m[1] ?? '').split('L').map((p) => p.trim().split(' ').map(Number) as unknown as readonly [number, number]),
    );
    return (x: number, y: number): boolean =>
      polygons.some((poly) =>
        poly.reduce((inside, [xi, yi], i) => {
          const [xj, yj] = poly[(i + poly.length - 1) % poly.length] ?? [xi, yi];
          return yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi ? !inside : inside;
        }, false),
      );
  };

  it.each([
    ...Object.entries(HATCH_PRESETS).map(([name, options]) => [`preset ${name}`, options] as const),
    ['a thick marker (weight 12, gap 26)', { ...HATCH_DEFAULTS, weight: 12, weightJitter: 1.4, gap: 26 }] as const,
  ])('has the same ink on opposite edges, so the seams show no notches: %s', (_, options) => {
    const tile = drawHatchTile('#000', options, 7);
    const T = tile.size;
    const ink = inkAt(tile.svg);
    const steps = Array.from({ length: T * 4 }, (_, i) => (i + 0.5) / 4);
    // Every 0.25px along the left/right edges, then along the top/bottom edges.
    const differs = (edge: (t: number) => readonly [boolean, boolean]): ReadonlyArray<boolean> =>
      steps.map((t) => {
        const [a, b] = edge(t);
        return a !== b;
      });
    const edges = [differs((t) => [ink(0.01, t), ink(T - 0.01, t)]), differs((t) => [ink(t, 0.01), ink(t, T - 0.01)])];
    // The two compared points are 0.02px apart, so a sample right on a stroke's edge may differ;
    // a notch is a run: two neighbouring samples (0.25px apart) that both differ.
    const runs = edges.map((list) => list.filter((d, i) => d && list[i + 1] === true).length);
    expect(runs, 'samples in a run of differences, per edge pair').toEqual([0, 0]);
    expect(edges.flat().filter(Boolean).length / (2 * steps.length)).toBeLessThan(0.01);
  });
});

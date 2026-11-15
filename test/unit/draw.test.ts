import { describe, expect, it } from 'vitest';
import { HATCH_DEFAULTS, HATCH_PRESETS, PRESETS } from '../../src/options';
import { drawExactHatch, drawHatchTile, exactHatchReach, hatchTileSize } from '../../src/draw/hatch';
import { drawNineSlice, drawStrip, geometryFor, nineSliceGeometry, stripGeometry, underlinePlacement } from '../../src/draw/stroke';
import { FLIPS } from '../../src/draw/svg';
import { drawCheckbox, drawChevron, drawRadio } from '../../src/draw/controls';
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

describe('exact hatch (M6c)', () => {
  const OPTIONS = HATCH_PRESETS.normal;
  const exact = (overrides: Partial<Parameters<typeof drawExactHatch>[0]> = {}) =>
    drawExactHatch({ width: 220, height: 120, radius: 0, border: 2, color: '#000', options: OPTIONS, seed: 5, at: 0, ...overrides });

  /** Each stroke's outline points (absolute), from `M x y l dx dy … z`. */
  const strokesOf = (svg: string): ReadonlyArray<ReadonlyArray<readonly [number, number]>> =>
    [...svg.matchAll(/M([-\d.]+) ([-\d.]+)l([^z]*)z/g)].map((m) => {
      const steps = (m[3] ?? '').trim().split(' ').map(Number);
      const start = [Number(m[1]), Number(m[2])] as const;
      return Array.from({ length: steps.length / 2 }, (_, i) => i).reduce<ReadonlyArray<readonly [number, number]>>(
        (points, i) => {
          const [x, y] = points.at(-1) ?? start;
          return [...points, [x + (steps[2 * i] ?? 0), y + (steps[2 * i + 1] ?? 0)] as const];
        },
        [start],
      );
    });

  it('draws strokes that reach past the outline by at most `over` plus half a stroke', () => {
    const strokes = strokesOf(exact());
    expect(strokes.length).toBeGreaterThan(15);
    const reach = exactHatchReach(OPTIONS) + 0.2;
    for (const [x, y] of strokes.flat()) {
      expect(x).toBeGreaterThanOrEqual(-reach);
      expect(y).toBeGreaterThanOrEqual(-reach);
      expect(x).toBeLessThanOrEqual(220 + reach);
      expect(y).toBeLessThanOrEqual(120 + reach);
    }
  });

  it('ends each stroke somewhere else: between `over` outside and the middle of the border line', () => {
    // How far past the top edge each stroke's top end reaches (its highest point).
    const tops = strokesOf(exact())
      .map((points) => Math.min(...points.map(([, y]) => y)))
      .filter((y) => y < 30);
    expect(tops.length).toBeGreaterThan(8);
    const spread = Math.max(...tops) - Math.min(...tops);
    expect(spread).toBeGreaterThan(2);
    // The centre of a square end lies within [-over, border / 2]; its corners add half a stroke.
    for (const y of tops) expect(y).toBeGreaterThanOrEqual(-OPTIONS.over - OPTIONS.weight);
  });

  it('keeps strokes inside rounded corners', () => {
    const r = 30;
    const reach = exactHatchReach(OPTIONS) + 0.2;
    for (const [x, y] of strokesOf(exact({ radius: r })).flat()) {
      // Distance outside the rounded outline must stay within the reach.
      const cx = Math.min(Math.max(x, r), 220 - r);
      const cy = Math.min(Math.max(y, r), 120 - r);
      expect(Math.hypot(x - cx, y - cy) - r).toBeLessThanOrEqual(reach);
    }
  });

  it('tapers the ends with `ends: taper`, and is deterministic', () => {
    const square = exact();
    const taper = exact({ options: { ...OPTIONS, ends: 'taper' } });
    expect(taper).not.toBe(square);
    expect(strokesOf(taper)[0]?.length).toBeGreaterThan(strokesOf(square)[0]?.length ?? 0);
    expect(exact()).toBe(square);
  });

  const card = { width: 2, radius: 8, color: '#1d2433', rough: PRESETS.normal, fill: { kind: 'hatch' as const, color: '#3b82f6', width: 220, height: 120, hatch: OPTIONS } };

  it('makes twelve different drawings for the neighbour slots, all slanting the same way', () => {
    const svgs = [11, 23, 37].flatMap((seed) => FLIPS.map((flip) => drawNineSlice({ ...card, seed }, flip).svg));
    expect(new Set(svgs).size).toBe(12);
    for (const svg of svgs) {
      // The hatch is not inside the (flipped) border group, and runs from lower left to upper right.
      const hatch = /^<svg[^>]*>(<path d='[^']*' fill='#3b82f6' stroke='none'\/>)<defs>/.exec(svg)?.[1] ?? '';
      expect(hatch).not.toBe('');
      const [first] = strokesOf(hatch);
      const [x0, y0] = first?.[0] ?? [0, 0];
      const [x1, y1] = first?.[Math.floor((first.length - 1) / 2)] ?? [0, 0];
      expect(Math.sign(x1 - x0)).toBe(-Math.sign(y1 - y0));
    }
  });

  it('is the element size plus the outset, with the border cut into nine pieces like the browser does', () => {
    const drawing = drawNineSlice({ ...card, seed: 11 });
    const geometry = geometryFor(card);
    const W = 220 + 2 * geometry.outset;
    expect(drawing.svg).toMatch(new RegExp(`^<svg [^>]*width='${W}' height='${120 + 2 * geometry.outset}'`));
    // The border is the plain border's square drawing (as without a hatch), at its own outset:
    // corners 1:1, the top edge's middle stretched from the square's 120px to the element's length.
    const plain = nineSliceGeometry(2, 8);
    const k = plain.slice;
    const inset = Math.round((geometry.outset - plain.outset) * 10) / 10;
    expect(drawing.svg).toContain(`<svg x='${inset}' y='${inset}' width='${k}' height='${k}' viewBox='0 0 ${k} ${k}' preserveAspectRatio='none'>`);
    expect(drawing.svg).toContain(
      `<svg x='${inset + k}' y='${inset}' width='${Math.round((W - 2 * inset - 2 * k) * 10) / 10}' height='${k}' viewBox='${k} 0 120 ${k}' preserveAspectRatio='none'>`,
    );
    // The corner slice of the placement holds the whole border corner.
    expect(geometry.slice).toBeCloseTo(inset + k, 5);
    expect((drawing.svg.match(/<use href='#b'\/>/g) ?? []).length).toBe(8);
  });

  it('has no border pieces without a border', () => {
    const svg = drawNineSlice({ ...card, width: 0, color: 'transparent', seed: 11 }).svg;
    expect(svg).not.toContain('<use');
    expect(svg).toContain("fill='#3b82f6'");
  });
});

describe('underline (M6d)', () => {
  it('uses the one-sided line placement, with its line half a width below the element', () => {
    const line = stripGeometry(2, 'bottom').placement;
    const under = underlinePlacement(2);
    expect(under.slice).toBe(line.slice);
    expect(under.width).toBe(line.width);
    // Bottom slice 12px deep with the line in its middle: 6px + 1px puts the centre 1px below.
    expect(under.outset).toBe('12px 3px 7px 3px');
    expect(underlinePlacement(1.5).outset).toBe('11.5px 3px 6.5px 3px');
  });
});

describe('form controls (M7a)', () => {
  const input = { ink: '#111111', accent: '#2563eb', checked: false, rough: PRESETS.normal, seed: 11 };

  it('draws the box and circle in ink, the tick and dot in the accent only when checked', () => {
    expect(drawCheckbox(input).svg).toContain("stroke='#111111'");
    expect(drawCheckbox(input).svg).not.toContain('#2563eb');
    expect(drawCheckbox({ ...input, checked: true }).svg).toContain("stroke='#2563eb'");
    expect(drawRadio(input).svg).not.toContain('#2563eb');
    expect(drawRadio({ ...input, checked: true }).svg).toContain("fill='#2563eb'");
    expect(drawChevron({ color: '#111111', rough: PRESETS.normal, seed: 11 }).svg).toMatch(/^<svg [^>]*width='16' height='14'/);
  });

  it('is deterministic, and a flip mirrors the box but not the tick', () => {
    const checked = { ...input, checked: true };
    expect(drawCheckbox(checked).svg).toBe(drawCheckbox(checked).svg);
    const flipped = drawCheckbox(checked, 'x').svg;
    const groups = [...flipped.matchAll(/<g([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(groups[0]).toContain('transform=');
    expect(groups[1]).not.toContain('transform=');
    const tick = (svg: string) => /<g [^>]*stroke='#2563eb'[^>]*>.*?<\/g>/.exec(svg)?.[0];
    expect(tick(flipped)).toBe(tick(drawCheckbox(checked).svg));
  });
});

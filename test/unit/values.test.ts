import { describe, expect, it } from 'vitest';
import {
  expandBox,
  parseBorderRadius,
  parseBorderShorthand,
  parseColor,
  parseCornerRadius,
  parseWidth,
} from '../../src/read/values';

describe('parseWidth', () => {
  it.each([
    ['1px', 1],
    ['2.5px', 2.5],
    ['0', 0],
    ['thin', 1],
    ['medium', 3],
    ['THICK', 5],
  ])('%s → %spx', (word, px) => {
    expect(parseWidth(word)).toEqual({ kind: 'px', px });
  });

  it.each(['1em', '0.1rem', '2', '-1px', 'calc(1px + 1px)'])('%s is unknown', (word) => {
    expect(parseWidth(word)).toEqual({ kind: 'unknown' });
  });
});

describe('parseColor', () => {
  it.each(['#1d2433', '#FFF', 'red', 'RebeccaPurple', 'rgb(0 0 0 / 50%)', 'hsl(10, 50%, 50%)', 'oklch(0.7 0.1 200)'])(
    '%s is literal',
    (value) => {
      expect(parseColor(value).kind).toBe('literal');
    },
  );

  it('normalises case of hex and names', () => {
    expect(parseColor('#ABCDEF')).toEqual({ kind: 'literal', css: '#abcdef' });
    expect(parseColor('Red')).toEqual({ kind: 'literal', css: 'red' });
  });

  it('recognises transparent', () => {
    expect(parseColor('Transparent')).toEqual({ kind: 'transparent' });
  });

  it.each(['currentColor', 'var(--ink)', 'rgb(var(--r) 0 0)', 'inherit', 'Canvas', 'color-mix(in srgb, red, blue)', 'rgb(from currentColor r g b)', 'notacolor'])(
    '%s is unknown',
    (value) => {
      expect(parseColor(value).kind).toBe('unknown');
    },
  );
});

describe('parseBorderShorthand', () => {
  it('reads all three parts in any order', () => {
    expect(parseBorderShorthand('#000 solid 2px')).toEqual({
      width: { kind: 'px', px: 2 },
      style: { kind: 'keyword', keyword: 'solid' },
      color: { kind: 'literal', css: '#000' },
    });
  });

  it('fills omitted parts with initial values', () => {
    expect(parseBorderShorthand('solid red')).toEqual({
      width: { kind: 'px', px: 3 },
      style: { kind: 'keyword', keyword: 'solid' },
      color: { kind: 'literal', css: 'red' },
    });
    expect(parseBorderShorthand('1px solid').color).toEqual({ kind: 'unknown', css: 'currentcolor' });
    expect(parseBorderShorthand('none').style).toEqual({ kind: 'keyword', keyword: 'none' });
  });

  it('cannot split values with var()', () => {
    expect(parseBorderShorthand('var(--border)').width).toEqual({ kind: 'unknown' });
    expect(parseBorderShorthand('1px solid var(--ink)').color.kind).toBe('unknown');
  });
});

describe('expandBox', () => {
  it('expands 1 to 4 values to the four sides', () => {
    expect(expandBox([1])).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    expect(expandBox([1, 2])).toEqual({ top: 1, right: 2, bottom: 1, left: 2 });
    expect(expandBox([1, 2, 3])).toEqual({ top: 1, right: 2, bottom: 3, left: 2 });
    expect(expandBox([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(expandBox([])).toBeUndefined();
    expect(expandBox([1, 2, 3, 4, 5])).toBeUndefined();
  });
});

describe('radius', () => {
  it('reads uniform and per-corner px', () => {
    expect(parseBorderRadius('12px')['bottom-left']).toEqual({ kind: 'px', px: 12 });
    expect(parseBorderRadius('4px 8px')['top-right']).toEqual({ kind: 'px', px: 8 });
    expect(parseCornerRadius('6px')).toEqual({ kind: 'px', px: 6 });
    expect(parseCornerRadius('6px 6px')).toEqual({ kind: 'px', px: 6 });
  });

  it.each(['50%', '12px / 6px', '1em', 'var(--r)'])('%s is unknown', (value) => {
    expect(parseBorderRadius(value)['top-left']).toEqual({ kind: 'unknown' });
  });

  it('elliptical corner longhand is unknown', () => {
    expect(parseCornerRadius('6px 3px')).toEqual({ kind: 'unknown' });
  });
});

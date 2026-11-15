import { describe, expect, it } from 'vitest';
import {
  expandBox,
  parseBackgroundShorthand,
  parseBorderRadius,
  parseBorderShorthand,
  parseColor,
  parseBoxSizing,
  parseCornerRadius,
  parseLength,
  parsePadding,
  parseSizeHint,
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

describe('parseBackgroundShorthand', () => {
  it.each([
    ['#ffe38a', { color: { kind: 'literal', css: '#ffe38a' }, image: false }],
    ['url(a.png) no-repeat center / cover, red', { color: { kind: 'literal', css: 'red' }, image: true }],
    ['linear-gradient(red, blue)', { color: { kind: 'transparent' }, image: true }],
    ['none', { color: { kind: 'transparent' }, image: false }],
    ['currentColor', { color: { kind: 'unknown', css: 'currentColor' }, image: false }],
  ] as const)('%s', (value, expected) => {
    expect(parseBackgroundShorthand(value)).toEqual(expected);
  });

  it('cannot split values with var()', () => {
    expect(parseBackgroundShorthand('var(--fill)')).toEqual({ color: { kind: 'unknown', css: 'var(--fill)' }, image: false });
  });
});

describe('sizes (M6c)', () => {
  it('reads px lengths; anything else is unknown', () => {
    expect(parseLength('220px')).toEqual({ kind: 'px', px: 220 });
    expect(parseLength('0')).toEqual({ kind: 'px', px: 0 });
    for (const value of ['auto', '50%', '10em', 'calc(10px + 2px)', 'var(--w)', 'inherit', 'fit-content', 'thin']) {
      expect(parseLength(value), value).toEqual({ kind: 'unknown' });
    }
  });

  it('expands padding to the four sides', () => {
    expect(parsePadding('10px 6px')).toEqual({ top: { kind: 'px', px: 10 }, right: { kind: 'px', px: 6 }, bottom: { kind: 'px', px: 10 }, left: { kind: 'px', px: 6 } });
    expect(parsePadding('1em 0').top).toEqual({ kind: 'unknown' });
  });

  it('reads box-sizing; inherit is unknown at build time', () => {
    expect(parseBoxSizing('border-box')).toEqual({ kind: 'keyword', keyword: 'border-box' });
    expect(parseBoxSizing(' Content-Box ')).toEqual({ kind: 'keyword', keyword: 'content-box' });
    expect(parseBoxSizing('inherit')).toEqual({ kind: 'unknown' });
  });

  it('reads --sketch-size: W H, W (a square), unitless or px, above 0', () => {
    expect(parseSizeHint('240 160')).toEqual({ kind: 'size', width: 240, height: 160 });
    expect(parseSizeHint('240px 160.5px')).toEqual({ kind: 'size', width: 240, height: 160.5 });
    expect(parseSizeHint('96')).toEqual({ kind: 'size', width: 96, height: 96 });
    for (const value of ['', '0 10', '-5 10', '10 abc', '10 20 30', '10% 20px', '1em', 'auto', '10,20']) {
      expect(parseSizeHint(value).kind, value).toBe('invalid');
    }
  });
});

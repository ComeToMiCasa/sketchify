import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { factsOfRule } from '../../src/read/collect';
import { requestFor } from '../../src/gather/gather';
import { paintRequestFor, stripRequestFor } from '../../src/gather/request';
import { PRESETS } from '../../src/options';

const options = { rough: PRESETS.normal };
const ruleOf = (body: string): Rule => postcss.parse(`.a { ${body} }`).first as Rule;
const request = (body: string) => requestFor(factsOfRule(ruleOf(body)).border, options);

describe('requestFor (one rule = one element)', () => {
  it.each([
    ['border: 2px solid #1d2433', { width: 2, radius: 0, color: '#1d2433' }],
    ['border: solid red', { width: 3, radius: 0, color: 'red' }],
    ['border-width: thin; border-style: solid; border-color: blue', { width: 1, radius: 0, color: 'blue' }],
    ['border: 1px solid red; border-radius: 12px', { width: 1, radius: 12, color: 'red' }],
    ['border: 1px solid red; border-color: blue', { width: 1, radius: 0, color: 'blue' }],
    ['border-color: blue; border: 1px solid red', { width: 1, radius: 0, color: 'red' }],
    ['border: 1px solid red; border-top-left-radius: 4px; border-radius: 6px', { width: 1, radius: 6, color: 'red' }],
    ['border-top: 1px solid red; border-right: 1px solid red; border-bottom: 1px solid red; border-left: 1px solid red', { width: 1, radius: 0, color: 'red' }],
    ['border: 1px solid red; border-radius: 0', { width: 1, radius: 0, color: 'red' }],
  ])('draws `%s`', (body, expected) => {
    expect(request(body)).toEqual({ kind: 'nine-slice', ...expected, rough: PRESETS.normal, seed: 11 });
  });

  it.each([
    'border-width: 1px',
    'border-color: red; border-style: solid',
    'border: 1px solid',
    'border: 1px solid currentColor',
    'border: 1px solid var(--ink)',
    'border: 1px solid transparent',
    'border: 1px dashed red',
    'border: 0 solid red',
    'border: 1em solid red',
    'border: 1px solid red; border-bottom-width: 2px',
    'border: 1px solid red; border-radius: 50%',
    'border: 1px solid red; border-radius: 2px 4px',
    'border: 1px solid red; border-image: none',
    'border: 1px solid red; border-block-color: blue',
    'border-bottom: 1px solid red',
  ])('skips `%s`', (body) => {
    expect(request(body)).toBeUndefined();
  });

  it('records importance and the last border declaration', () => {
    const facts = factsOfRule(ruleOf('border: 1px solid red !important; border-radius: 4px; color: red'));
    expect(facts.border.important).toBe(true);
    expect(facts.lastBorderDecl?.prop).toBe('border');
  });
});

describe('stripRequestFor (one-sided lines)', () => {
  const strip = (body: string) => stripRequestFor(factsOfRule(ruleOf(body)).border, options);

  it.each([
    ['border-bottom: 1px solid red', { side: 'bottom', width: 1, color: 'red' }],
    ['border: 0; border-top: 2px solid #000', { side: 'top', width: 2, color: '#000' }],
    ['border-left: 4px solid red; border-radius: 0 8px 8px 0', { side: 'left', width: 4, color: 'red' }],
    ['border-style: none; border-right: thin solid red', { side: 'right', width: 1, color: 'red' }],
  ])('draws `%s`', (body, expected) => {
    expect(strip(body)).toEqual({ kind: 'strip', ...expected, rough: PRESETS.normal, seed: 11 });
  });

  it.each([
    'border-bottom: 1px solid red; border-top: 1px solid red',
    'border: 1px solid red',
    'border-bottom: 1px dashed red',
    'border-bottom: 1px solid red; border-radius: 4px',
    'border-bottom: 1px solid red; border-bottom-left-radius: 2px',
    'border-bottom: 1px solid',
    'border-bottom: 1em solid red',
    'border-bottom-color: red',
  ])('skips `%s`', (body) => {
    expect(strip(body)).toBeUndefined();
  });
});

describe('paintRequestFor (fills, M6a)', () => {
  const paint = (body: string) => paintRequestFor(factsOfRule(ruleOf(body)).border, options);

  it('adds the fill to a box border, or draws a fill without a border', () => {
    expect(paint('border: 1px solid red; background: #ffe38a; --sketch-fill: rough')).toMatchObject({ kind: 'nine-slice', width: 1, fill: { kind: 'rough', color: '#ffe38a' } });
    expect(paint('background-color: blue; border-radius: 4px; --sketch-fill: marker')).toMatchObject({ kind: 'nine-slice', width: 0, radius: 4, fill: { kind: 'marker', color: 'blue' } });
  });

  it.each([
    ['solid fill (default)', 'border: 1px solid red; background: #eee', { kind: 'nine-slice', width: 1 }],
    ['no background colour', 'border: 1px solid red; --sketch-fill: rough', { kind: 'nine-slice', width: 1 }],
    ['transparent background', 'border: 1px solid red; background: transparent; --sketch-fill: rough', { kind: 'nine-slice', width: 1 }],
    ['background image', 'border: 1px solid red; background: url(a.png) #eee; --sketch-fill: rough', { kind: 'nine-slice', width: 1 }],
  ] as const)('keeps the original background: %s', (_name, body, expected) => {
    const request = paint(body);
    expect(request).toMatchObject(expected);
    expect(request && 'fill' in request ? request.fill : undefined).toBeUndefined();
  });

  it.each([
    'border-bottom: 1px solid red; background: #eee; --sketch-fill: rough',
    'border: 1px dashed red; background: #eee; --sketch-fill: rough',
    'border: 1px solid red; border-radius: 999px; background: #eee; --sketch-fill: rough',
    'border: 1px solid red; background: currentColor; --sketch-fill: rough',
  ])('draws nothing for `%s`', (body) => {
    expect(paint(body)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { drawingName, fnv1a } from '../../src/draw/hash';
import { drawNineSlice } from '../../src/draw/stroke';
import { FLIPS } from '../../src/draw/svg';
import { pickRules, seedFor } from '../../src/emit/variants';
import { PRESETS } from '../../src/options';
import { targetsPseudoElement } from '../../src/read/collect';
import { transform } from '../helpers/transform';

/** `--sk-xxxxxxxx: url(…)` pairs from the output's `:root` rule. */
const rootVars = (css: string): ReadonlyMap<string, string> =>
  new Map([...css.matchAll(/^ {2}(--sk-[0-9a-f]{8}): (url\("[^"]+"\));$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']));

/** Drawing names a rule's slot variables point at, in slot order. */
const slotDrawings = (css: string, selector: string): ReadonlyArray<string> => {
  const body = css.split('\n').find((line) => line.startsWith(`${selector} {`)) ?? '';
  return [...body.matchAll(/--sk-\d-\d: var\((--sk-[0-9a-f]{8})\)/g)].map((m) => m[1] ?? '');
};

describe('fnv1a', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });

  it('names a drawing by its content', () => {
    expect(drawingName('url("x")')).toBe(`--sk-${fnv1a('url("x")')}`);
  });
});

describe('flipped drawings', () => {
  const input = { width: 2, radius: 0, color: '#1d2433', rough: PRESETS.normal, seed: 11 };
  const pathsOf = (svg: string): ReadonlyArray<string> => [...svg.matchAll(/ d='([^']+)'/g)].map((m) => m[1] ?? '');

  it('keep the same path data and differ only by a transform', () => {
    const [none, ...flipped] = FLIPS.map((flip) => drawNineSlice(input, flip).svg);
    expect(none).not.toContain('transform');
    expect(flipped.map((svg) => /transform='([^']+)'/.exec(svg ?? '')?.[1])).toEqual([
      'matrix(-1 0 0 1 148 0)',
      'matrix(1 0 0 -1 0 148)',
      'matrix(-1 0 0 -1 148 148)',
    ]);
    flipped.forEach((svg) => expect(pathsOf(svg ?? '')).toEqual(pathsOf(none ?? '')));
  });
});

describe('pick rules', () => {
  it('gives three siblings three different seeds, whatever their parents', () => {
    [1, 2, 3].forEach((grandparent) =>
      [1, 2, 3].forEach((parent) => {
        expect(new Set([1, 2, 3].map((own) => seedFor(grandparent, parent, own))).size).toBe(3);
      }),
    );
  });

  it('gives the same position under different parents different seeds', () => {
    expect(new Set([1, 2, 3].map((parent) => seedFor(1, parent, 1))).size).toBe(3);
  });

  it('are a default, three flips and the 18 non-zero seed positions, all at zero specificity', () => {
    const rules = pickRules();
    expect(rules).toHaveLength(1 + 3 + 18);
    expect(rules[0]).toBe(':where(*) { --sk: var(--sk-0); --sk-0: var(--sk-0-0); --sk-1: var(--sk-1-0); --sk-2: var(--sk-2-0); }');
    expect(rules[1]).toBe(':where(:nth-child(4n+2)) { --sk-0: var(--sk-0-1); --sk-1: var(--sk-1-1); --sk-2: var(--sk-2-1); }');
    expect(rules).toContain(':where(:nth-child(3n+1) > :nth-child(3n+1) > :nth-child(3n+2)) { --sk: var(--sk-1); }');
    rules.forEach((rule) => expect(rule).toMatch(/^:where\([^{]+\) \{/));
  });
});

describe('variant output', () => {
  it('stores each drawing once and lets rules with the same border share them', async () => {
    const out = await transform('.a { border: 2px solid red; }\n.b { border: 2px solid red; }\n');
    const vars = rootVars(out);
    expect(vars.size).toBe(12);
    expect(new Set(vars.values()).size).toBe(12);
    expect(slotDrawings(out, '.a')).toEqual([...vars.keys()]);
    expect(slotDrawings(out, '.b')).toEqual([...vars.keys()]);
  });

  it('puts the drawing variables and pick rules after @charset, @import and @layer statements', async () => {
    const out = await transform('@charset "utf-8";\n/* note */\n@import "x.css";\n@layer a, b;\n.a { border: 1px solid red; }\n');
    expect(out).toMatch(/^@charset "utf-8";\n\/\* note \*\/\n@import "x.css";\n@layer a, b;\n:root \{\n/);
    expect(out).toMatch(/\n:where\(\*\) \{[^\n]+\n(:where\([^\n]+\n){21}\.a \{/);
  });

  it('puts them at the very top when there is no prelude', async () => {
    const out = await transform('/* note */\n.a { border: 1px solid red; }\n');
    expect(out).toMatch(/^:root \{\n/);
    expect(out).toContain('\n/* note */\n.a {');
  });

  it('gives a pseudo-element its base drawing directly, without slots or pick rules', async () => {
    const out = await transform('.a::before { border: 1px solid red; }\n.b:after { border: 1px solid red; }\n');
    const [name, ...rest] = [...rootVars(out).keys()];
    expect(rest).toEqual([]);
    expect(out).not.toContain(':where(');
    expect(out).not.toMatch(/--sk-\d-\d:/);
    expect(out).toContain(`.a::before { border: 1px solid red; border-color: transparent; border-image: var(${name}) `);
    expect(out).toContain(`.b:after { border: 1px solid red; border-color: transparent; border-image: var(${name}) `);
  });

  it('never gives one name two drawings across separately compiled files', async () => {
    const [a, b] = await Promise.all([
      transform('.a { border: 2px solid red; }\n.b { border: 1px solid blue; border-radius: 8px; }\n', {}, 'a.css'),
      transform('.c { border: 2px solid red; }\n.d { border: 3px solid green; }\n', {}, 'b.css'),
    ]);
    const varsA = rootVars(a ?? '');
    const varsB = rootVars(b ?? '');
    const shared = [...varsA.keys()].filter((name) => varsB.has(name));
    expect(shared).toHaveLength(12);
    shared.forEach((name) => expect(varsA.get(name)).toBe(varsB.get(name)));
  });
});

describe('targetsPseudoElement', () => {
  it.each([
    ['.a::before', true],
    ['.a:after', true],
    ['p:first-line', true],
    ['.a, .b::marker', true],
    ['.a:hover', false],
    ['.a:first-child', false],
    ['.before-x:not(.y)', false],
  ] as const)('%s → %s', (selector, expected) => {
    expect(targetsPseudoElement(selector)).toBe(expected);
  });
});

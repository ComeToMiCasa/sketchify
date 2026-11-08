import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { lookupFor, scopeOf, substitute } from '../../src/gather/colors';
import { isRootSelector, variableDefs } from '../../src/read/variables';

const env = (entries: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(entries));
const sub = (value: string, vars: Record<string, string>) => substitute(value, (name) => env(vars).get(name));

describe('substitute', () => {
  it('replaces variables, variables inside variables and variables inside functions', () => {
    expect(sub('1px solid var(--ink)', { '--ink': 'red' })).toEqual({ kind: 'ok', value: '1px solid red', names: ['--ink'] });
    expect(sub('var(--line)', { '--line': 'var(--ink)', '--ink': '#000' })).toMatchObject({ kind: 'ok', value: '#000', names: ['--line', '--ink'] });
    expect(sub('rgb(var(--r) 0 0)', { '--r': '255' })).toMatchObject({ kind: 'ok', value: 'rgb(255 0 0)' });
  });

  it('uses the fallback only when the variable is missing, and still records the name', () => {
    expect(sub('var(--x, red)', {})).toEqual({ kind: 'ok', value: 'red', names: ['--x'] });
    expect(sub('var(--x, red)', { '--x': 'blue' })).toMatchObject({ value: 'blue' });
    expect(sub('var(--x, var(--y))', { '--y': 'green' })).toEqual({ kind: 'ok', value: 'green', names: ['--x', '--y'] });
    expect(sub('var(--x, rgb(1 2 3))', {})).toMatchObject({ value: 'rgb(1 2 3)' });
  });

  it('reports missing variables and cycles', () => {
    expect(sub('1px solid var(--nope)', {})).toEqual({ kind: 'missing', name: '--nope', cycle: false, names: ['--nope'] });
    expect(sub('var(--a)', { '--a': 'var(--b)', '--b': 'var(--a)' })).toMatchObject({ kind: 'missing', name: '--a', cycle: true });
    expect(sub('var(--a)', { '--a': 'var(--a)' })).toMatchObject({ kind: 'missing', cycle: true });
  });

  it('leaves values without var() alone', () => {
    expect(sub('2px dashed #ABC', {})).toEqual({ kind: 'ok', value: '2px dashed #ABC', names: [] });
  });
});

describe('lookupFor', () => {
  it('prefers the rule\'s own definitions', () => {
    const lookup = lookupFor(env({ '--c': 'own' }), env({ '--c': 'root', '--d': 'root' }));
    expect(lookup('--c')).toBe('own');
    expect(lookup('--d')).toBe('root');
    expect(lookup('--e')).toBeUndefined();
  });
});

describe('isRootSelector', () => {
  it.each([
    [':root', true],
    ['html', true],
    [':ROOT, html', true],
    ['html.dark', false],
    [':root[data-theme=dark]', false],
    [':host', false],
    ['.a, :root', false],
  ] as const)('%s → %s', (selector, expected) => {
    expect(isRootSelector(selector)).toBe(expected);
  });
});

describe('variableDefs and scopeOf', () => {
  const css = [
    ':root { --ink: #111; --bg: #fff; --sketch: off; }',
    '@layer base { html { --line: var(--ink); } }',
    '@media (prefers-color-scheme: dark) { :root { --ink: #eee; } }',
    '@media (prefers-color-scheme: dark) { :root { --bg: #000; } }',
    '@supports (color: lab(0 0 0)) { @media print { :root { --ink: black; } } }',
    '@keyframes k { from { --ink: red; } }',
    'html.dark { --ink: #ddd; }',
    '.card { --pad: 4px; }',
  ].join('\n');
  const defs = variableDefs(postcss.parse(css));

  it('reads every custom property with its conditions, skipping @keyframes and --sketch', () => {
    expect(defs.map((d) => [d.name, d.root, d.conditions.map((c) => `@${c.name} ${c.params}`).join(' ')])).toEqual([
      ['--ink', true, ''],
      ['--bg', true, ''],
      ['--line', true, ''],
      ['--ink', true, '@media (prefers-color-scheme: dark)'],
      ['--bg', true, '@media (prefers-color-scheme: dark)'],
      ['--ink', true, '@supports (color: lab(0 0 0)) @media print'],
      ['--ink', false, ''],
      ['--pad', false, ''],
    ]);
  });

  it('groups root definitions by condition, on top of the base values', () => {
    const scope = scopeOf(defs);
    expect(Object.fromEntries(scope.base)).toEqual({ '--ink': '#111', '--bg': '#fff', '--line': 'var(--ink)' });
    expect(scope.conditional.map((c) => [c.conditions.map((x) => x.params), Object.fromEntries(c.env)])).toEqual([
      [['(prefers-color-scheme: dark)'], { '--ink': '#eee', '--bg': '#000', '--line': 'var(--ink)' }],
      [['(color: lab(0 0 0))', 'print'], { '--ink': 'black', '--bg': '#fff', '--line': 'var(--ink)' }],
    ]);
    expect(scope.scoped.map((d) => d.rule.selector)).toEqual(['html.dark', '.card']);
  });
});

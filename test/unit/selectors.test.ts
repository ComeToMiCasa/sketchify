import { describe, expect, it } from 'vitest';
import { contains, parseSelectorList, resolveNested, selectorText, unionEntries } from '../../src/read/selectors';

const one = (text: string) => {
  const [entry] = parseSelectorList(text);
  if (!entry) throw new Error(`cannot parse ${text}`);
  return entry;
};

describe('parseSelectorList', () => {
  it('splits a list and reads context, subject compound and pseudo-element', () => {
    expect(parseSelectorList('.a, .toolbar > .btn:hover::before')).toEqual([
      { context: '', compound: ['.a'], pseudoElement: '', specificity: [0, 1, 0], ambiguous: false },
      { context: '.toolbar > ', compound: ['.btn', ':hover'], pseudoElement: '::before', specificity: [0, 3, 1], ambiguous: false },
    ]);
  });

  it('puts the type selector first, lowercases it, and normalises legacy pseudo-elements', () => {
    expect(one('.btn[type="submit"]BUTTON:after')).toMatchObject({ compound: ['button', '.btn', '[type="submit"]'], pseudoElement: '::after' });
  });

  it.each([
    ['#id .c', [1, 1, 0]],
    [':where(.a .b) .c', [0, 1, 0]],
    [':is(.a, #b) .c', [1, 1, 0]],
    [':not(.a, .b.c)', [0, 2, 0]],
    ['a.b::before', [0, 1, 2]],
    ['*', [0, 0, 0]],
  ] as const)('specificity of %s', (text, expected) => {
    expect(one(text).specificity).toEqual(expected);
  });

  it('flags :is()/:where() with several candidates in the subject', () => {
    expect(one(':is(.a, .b):hover').ambiguous).toBe(true);
    expect(one(':where(.a, .b)').ambiguous).toBe(true);
    expect(one(':is(.a):hover').ambiguous).toBe(false);
    expect(one(':is(.a, .b) .c').ambiguous).toBe(false);
  });
});

describe('contains', () => {
  it('needs the inner compound inside the outer one, the same pseudo-element and a matching context', () => {
    expect(contains(one('.btn.lg:hover'), one('.btn'))).toBe(true);
    expect(contains(one('.btn'), one('.btn.lg'))).toBe(false);
    expect(contains(one('.toolbar .btn'), one('.btn'))).toBe(true);
    expect(contains(one('.btn'), one('.toolbar .btn'))).toBe(false);
    expect(contains(one('.toolbar .btn.lg'), one('.toolbar .btn'))).toBe(true);
    expect(contains(one('.side .btn'), one('.toolbar .btn'))).toBe(false);
    expect(contains(one('.btn::before'), one('.btn'))).toBe(false);
  });
});

describe('unionEntries', () => {
  it('joins compounds and keeps a shared context', () => {
    const union = unionEntries([one('.btn'), one('.btn.lg'), one('.toolbar .btn:hover')]);
    expect(union && selectorText(union)).toBe('.toolbar .btn.lg:hover');
    expect(union?.specificity).toEqual([0, 4, 0]);
  });

  it('cannot join different contexts, type selectors or pseudo-elements', () => {
    expect(unionEntries([one('.a .x'), one('.b .x')])).toBeUndefined();
    expect(unionEntries([one('a.x'), one('button.x')])).toBeUndefined();
    expect(unionEntries([one('.x::before'), one('.x::after')])).toBeUndefined();
  });
});

describe('resolveNested', () => {
  it('replaces & with each parent, or makes the child a descendant', () => {
    expect(resolveNested(['.btn', '.link'], '&:hover, .icon')).toEqual(['.btn:hover', '.btn .icon', '.link:hover', '.link .icon']);
    expect(resolveNested([], '.a, .b')).toEqual(['.a', '.b']);
  });
});

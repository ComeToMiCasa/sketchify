import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { appliesTo, computeBorder, elementOf, familiesOf, isComplete, isSelfContained, itemsOf, parentsOf } from '../../src/gather/cascade';
import { scopeOf } from '../../src/gather/colors';
import { combinations, needsRule, winner } from '../../src/gather/combos';
import { collect } from '../../src/read/collect';
import { selectorText } from '../../src/read/selectors';
import { variableDefs } from '../../src/read/variables';

const setup = (css: string) => {
  const root = postcss.parse(css);
  const facts = collect(root).value;
  const items = itemsOf(facts);
  const scope = scopeOf(variableDefs(root));
  const item = (selector: string) => {
    const found = items.find((i) => selectorText(i.entry) === selector && i.facts.atRules.length === 0) ?? items.find((i) => selectorText(i.entry) === selector);
    if (!found) throw new Error(`no item ${selector}`);
    return found;
  };
  return { facts, items, scope, item };
};

describe('partial and complete rules', () => {
  it.each([
    ['border: 1px solid red', false, true],
    ['border-color: red', true, false],
    ['border-width: 0', true, false],
    ['border-bottom-color: red', true, false],
    ['border-bottom: 1px solid red', false, false],
    ['border-radius: 8px', false, false],
    ['border: 1px solid red; border-top-color: var(--x)', false, true],
    ['border-inline-color: red', false, false],
  ] as const)('`%s`: partial %s, complete %s', (body, partial, complete) => {
    const { facts } = setup(`.a { ${body}; }`);
    expect(facts[0]?.partial).toBe(partial);
    expect(facts[0] && isComplete(facts[0])).toBe(complete);
  });
});

describe('parents and families', () => {
  const css = [
    ':root { --ink: red; }',
    '.btn { border: 2px solid var(--ink); }',
    '.btn.lg { border-width: 3px; }',
    '.toolbar .btn { border-color: blue; }',
    '.btn:hover { border-color: green; }',
    '.btn.primary { --ink: blue; }',
    '.btn.unrelated { --pad: 4px; }',
    '@media (min-width: 900px) { .btn { border-radius: 8px; } }',
    '.card { border: 1px solid red; }',
    '.btn.card { border-color: black; }',
    '.x::before { border: 1px solid red; }',
    '.x { border-color: red; }',
  ].join('\n');
  const { items, scope, item, facts } = setup(css);
  const complete = items.filter((i) => isComplete(i.facts));

  it('finds parents by selector, never by name', () => {
    expect(parentsOf(item('.btn.lg'), complete).map((p) => selectorText(p.entry))).toEqual(['.btn']);
    expect(parentsOf(item('.toolbar .btn'), complete).map((p) => selectorText(p.entry))).toEqual(['.btn']);
    expect(parentsOf(item('.btn.card'), complete).map((p) => selectorText(p.entry))).toEqual(['.btn', '.card']);
    // A pseudo-element rule is not the parent of its element.
    expect(parentsOf(item('.x'), complete)).toEqual([]);
  });

  it('groups members under each base, including variable modifiers but not unrelated variables', () => {
    const families = familiesOf(items, scope);
    const btn = families.find((f) => selectorText(f.base.entry) === '.btn');
    expect(btn?.members.map((m) => selectorText(m.entry))).toEqual(['.btn.lg', '.toolbar .btn', '.btn:hover', '.btn.primary', '.btn', '.btn.card']);
    expect(btn?.members.find((m) => m.facts.atRules.length > 0)?.facts.atRules).toEqual([{ name: 'media', params: '(min-width: 900px)' }]);
    const card = families.find((f) => selectorText(f.base.entry) === '.card');
    expect(card?.members.map((m) => selectorText(m.entry))).toEqual(['.btn.card']);
    expect(facts.length).toBeGreaterThan(0);
  });

  it('a rule in a media query applies only to elements under that condition', () => {
    const media = items.find((i) => i.facts.atRules.length > 0);
    const plain = elementOf([item('.btn'), item('.btn.lg')]);
    const wide = media && elementOf([item('.btn.lg'), media]);
    expect(media && plain && appliesTo(media, plain)).toBe(false);
    expect(media && wide && appliesTo(media, wide)).toBe(true);
  });
});

describe('computeBorder (the cascade)', () => {
  const border = (css: string, selectors: ReadonlyArray<string>) => {
    const { item, scope } = setup(css);
    return computeBorder(selectors.map(item), scope.base).border;
  };
  const top = (b: ReturnType<typeof border>) => b.sides.top;

  it('follows specificity, then source order, then importance', () => {
    expect(top(border('.a.b { border-color: blue; }\n.a { border: 1px solid red; }', ['.a', '.a.b'])).color).toMatchObject({ css: 'blue' });
    expect(top(border('.a { border: 1px solid red; }\n.a:hover { border-color: blue; }\n.a.b { border-color: green; }', ['.a', '.a:hover', '.a.b'])).color).toMatchObject({ css: 'green' });
    expect(top(border('.a { border: 1px solid red !important; }\n.a.b { border-color: blue; }', ['.a', '.a.b'])).color).toMatchObject({ css: 'red' });
  });

  it('lets a later shorthand reset what an earlier longhand set', () => {
    const b = border('.a { border-width: 3px; }\n.a.b { border: 1px solid red; }', ['.a', '.a.b']);
    expect(top(b).width).toEqual({ kind: 'px', px: 1 });
  });

  it('resolves variables with the winning custom property', () => {
    const b = border(':root { --ink: red; }\n.a { border: 1px solid var(--ink); }\n.a.b { --ink: blue; }', ['.a', '.a.b']);
    expect(top(b).color).toMatchObject({ css: 'blue' });
  });
});

describe('combos helpers', () => {
  it('lists subsets of two or more, smallest first', () => {
    expect(combinations(['a', 'b', 'c']).map((s) => s.join(''))).toEqual(['ab', 'ac', 'bc', 'abc']);
  });

  it('picks the winning candidate and decides whether a rule is needed', () => {
    const { item } = setup('.btn { border: 1px solid red; }\n.btn.lg { border-width: 3px; }\n.btn:hover { border-color: blue; }');
    const element = elementOf([item('.btn'), item('.btn.lg'), item('.btn:hover')]);
    if (!element) throw new Error('no element');
    const draw = (width: number) => ({ kind: 'draw' as const, request: { kind: 'nine-slice' as const, width, radius: 0, color: 'blue', rough: { roughness: 1, bowing: 1, maxRandomnessOffset: 1 }, seed: 11 }, variants: [] });
    const candidate = (selector: string, order: number, width: number) => ({
      element: { entry: item(selector).entry, conditions: [] },
      look: draw(width),
      important: false,
      specificity: item(selector).entry.specificity,
      order: [order, 0] as const,
    });
    const shown = winner([candidate('.btn', 0, 1), candidate('.btn.lg', 1, 3), candidate('.btn:hover', 2, 1)], element);
    expect(shown && selectorText(shown.element.entry)).toBe('.btn:hover');
    expect(needsRule(draw(3), shown, true)).toBe(true);
    expect(needsRule(draw(1), shown, true)).toBe(false);
    expect(needsRule({ kind: 'plain', colors: 'red' }, undefined, false)).toBe(false);
    expect(needsRule({ kind: 'plain', colors: 'red' }, undefined, true)).toBe(true);
    expect(needsRule({ kind: 'leave' }, shown, true)).toBe(false);
  });
});

describe('isSelfContained (can be a parent)', () => {
  it.each([
    ['border: 1px solid red', true],
    ['border-bottom: 1px solid red', true],
    ['border: 0; border-top: 2px solid red', true],
    ['border-top: 1px solid red; border-bottom-color: blue', false],
    ['border-color: red', false],
    ['border-radius: 8px', false],
  ] as const)('`%s` → %s', (body, expected) => {
    const { facts } = setup(`.a { ${body}; }`);
    expect(facts[0] && isSelfContained(facts[0])).toBe(expected);
  });
});

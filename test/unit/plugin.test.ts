import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sketchify from '../../src/index';
import { loadPage } from '../helpers/pages';
import { transform } from '../helpers/transform';

describe('plugin shape', () => {
  it('is a PostCSS plugin creator', () => {
    expect(sketchify.postcss).toBe(true);
    expect(sketchify().postcssPlugin).toBe('postcss-sketchify');
    expect(sketchify({ roughness: 'messy' }).postcssPlugin).toBe('postcss-sketchify');
  });
});

describe('CSS the plugin does not draw is left untouched', () => {
  const samples: ReadonlyArray<readonly [string, string]> = [
    ['empty', ''],
    ['comment', '/* note */\n'],
    ['no border', '.a { color: red; padding: 4px; }\n'],
    ['nested at-rules without borders', '@layer base {\n  @supports (display: grid) {\n    .a { color: red; }\n  }\n}\n'],
    ['radius without a parent rule', '.rounded { border-radius: 8px; }\n'],
    ['two or three sides', '.a { border-top: 1px solid red; border-bottom: 1px solid red; }\n.b { border: 1px solid red; border-left: 0; }\n'],
    ['a one-sided line with rounded ends', '.a { border-bottom: 1px solid red; border-radius: 4px; }\n'],
    ['variables without borders, even unresolved', ':root { --ink: red; }\n.a { color: var(--nope); }\n'],
    ['transparent colour', '.a { border: 2px solid transparent; }\n'],
    ['no border width', '.a { border: 0 solid red; }\n.b { border: none; }\n'],
    ['non-solid styles', '.a { border: 1px dashed red; }\n.b { border: 1px dotted red; }\n.c { border: 3px double red; }\n'],
    ['non-px width', '.a { border: 0.1em solid red; }\n'],
    ['different sides', '.a { border: 1px solid red; border-top-color: blue; }\n.b { border: 1px solid red; border-left-width: 2px; }\n'],
    ['percent radius', '.a { border: 1px solid red; border-radius: 50%; }\n'],
    ['per-corner radius', '.a { border: 1px solid red; border-radius: 4px 8px; }\n'],
    ['elliptical radius', '.a { border: 1px solid red; border-radius: 12px / 6px; }\n'],
    ['user border-image', '.a { border: 2px solid red; border-image: linear-gradient(red, blue) 1; }\n'],
    ['logical properties', '.a { border: 1px solid red; border-inline-start-color: blue; }\n'],
    ['keyframes', '@keyframes pulse {\n  from { border: 1px solid red; }\n}\n'],
    ['global keyword', '.a { border: inherit; }\n'],
  ];

  it.each(samples)('%s', async (_name, css) => {
    expect(await transform(css)).toBe(css);
  });
});

describe('drawing', () => {
  // The twelve slot variables a mixed rule fills: --sk-{seed}-{flip} = var(--sk-<drawing>).
  const SLOTS = Array.from({ length: 12 }, (_, i) => `--sk-${Math.floor(i / 4)}-${i % 4}: var\\(--sk-[0-9a-f]{8}\\)`);
  const slots = (important = ''): string => SLOTS.map((slot) => `${slot}${important}; `).join('');

  it('adds a transparent colour, the slot variables and border-image after the border declarations', async () => {
    const out = await transform('.a { border: 2px solid #1d2433; padding: 4px; }');
    expect(out).toMatch(
      new RegExp(`\\n\\.a \\{ border: 2px solid #1d2433; border-color: transparent; ${slots()}border-image: var\\(--sk\\) 14 / 14px / 5px stretch; padding: 4px; \\}$`),
    );
  });

  it('keeps !important on the new declarations', async () => {
    const out = await transform('.a { border: 1px solid red !important; }');
    expect(out).toContain('border-color: transparent !important;');
    expect(out).toMatch(new RegExp(`border-color: transparent !important; ${slots(' !important')}border-image: var\\(--sk\\) [^;]+ stretch !important;`));
  });

  it('puts the new declarations after the last border declaration, even a later shorthand', async () => {
    const out = await transform('.a { border-color: blue; border-radius: 4px; border: 2px solid red; color: red; }');
    expect(out).toMatch(new RegExp(`border: 2px solid red; border-color: transparent; ${slots()}border-image: [^;]+; color: red;`));
  });

  it('draws rules inside @media, @supports and @layer', async () => {
    const out = await transform('@media (min-width: 1px) { @supports (display: grid) { @layer x { .a { border: 1px solid red; } } } }');
    expect(out).toMatch(/@layer x \{ \.a \{ [^}]*border-image: var\(--sk\) /);
  });

  it('is deterministic', async () => {
    const page = loadPage('sketch');
    expect(await transform(page.css)).toBe(await transform(page.css));
  });

  it('gives each roughness a different drawing', async () => {
    const css = '.a { border: 2px solid red; }';
    const outputs = await Promise.all(
      (['subtle', 'normal', 'messy', 0.9] as const).map((roughness) => transform(css, { roughness })),
    );
    expect(new Set(outputs).size).toBe(4);
  });

  it('fails the build on invalid options', async () => {
    await expect(transform('.a { border: 1px solid red; }', { roughness: 'wild' as never })).rejects.toThrow(/roughness/);
    await expect(transform('.a { border: 1px solid red; }', { roughness: -1 })).rejects.toThrow(/roughness/);
  });
});

// --- M3: colour resolution ----------------------------------------------------

/** Replaces drawings and slot lists so the structure of the output can be compared. */
const shape = (css: string): string =>
  css
    .replace(/^:root \{\n( {2}--sk-[0-9a-f]{8}: url\("[^"]+"\);\n)+\}\n/, '')
    .replace(/^:where\([^\n]+\n/gm, '')
    .replace(/( --sk-\d-\d: var\(--sk-[0-9a-f]{8}\)( !important)?;){12}/g, ' SLOTS;');

const errorOf = async (css: string): Promise<string> =>
  transform(css, {}, 'theme.css').then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

describe('var() colours', () => {
  it('draws a border whose colour comes from :root, through variables inside variables', async () => {
    const out = await transform(':root { --red: #e5484d; --line: var(--red); }\n.a { border: 2px solid var(--line); }\n');
    expect(shape(out)).toBe(':root { --red: #e5484d; --line: var(--red); }\n.a { border: 2px solid var(--line); border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 5px stretch; }\n');
    // The same drawings as the literal colour.
    const literal = await transform('.a { border: 2px solid #e5484d; }\n');
    const drawings = (css: string): string => /^:root \{\n[^}]+\}/.exec(css)?.[0] ?? '';
    expect(drawings(out)).not.toBe('');
    expect(drawings(out)).toBe(drawings(literal));
  });

  it('uses html, @layer and the rule\'s own definitions, fallbacks and variable widths', async () => {
    const css = [
      'html { --w: 3px; }',
      '@layer tokens { :root { --ink: red; } }',
      '.a { border: var(--w) solid var(--ink); }',
      '.b { --own: blue; border: 1px solid var(--own); }',
      '.c { border: 1px solid var(--missing, green); }',
      '',
    ].join('\n');
    const out = await transform(css);
    expect((out.match(/border-image: var\(--sk\)/g) ?? []).length).toBe(3);
    expect(out).toContain('.a { border: var(--w) solid var(--ink); border-color: transparent; ');
    expect(out).toMatch(/\.a \{[^}]*border-image: var\(--sk\) 14 \/ 14px \/ 4\.5px stretch;/);
  });

  it('adds a drawing for a media query that changes the colour, right after the rule', async () => {
    const css = ':root { --ink: #111111; }\n@media (prefers-color-scheme: dark) { :root { --ink: #eeeeee; } }\n.a { border: 2px solid var(--ink); }\n.b { color: red; }\n';
    expect(shape(await transform(css))).toBe(
      ':root { --ink: #111111; }\n@media (prefers-color-scheme: dark) { :root { --ink: #eeeeee; } }\n' +
        '.a { border: 2px solid var(--ink); border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 5px stretch; }\n' +
        '@media (prefers-color-scheme: dark) { .a { SLOTS; border-image: var(--sk) 14 / 14px / 5px stretch; } }\n' +
        '.b { color: red; }\n',
    );
  });

  it('draws the media query variant in that colour and the base in the base colour', async () => {
    const out = await transform(':root { --ink: #111111; }\n@media (prefers-color-scheme: dark) { :root { --ink: #eeeeee; } }\n.a { border: 2px solid var(--ink); }\n');
    const dark = out.slice(out.indexOf('@media (prefers-color-scheme: dark) { .a'));
    const drawingsIn = (part: string): ReadonlyArray<string> => [...part.matchAll(/--sk-\d-\d: var\((--sk-[0-9a-f]{8})\)/g)].map((m) => m[1] ?? '');
    const urlOf = (name: string): string => new RegExp(`${name}: (url\\("[^"]+"\\))`).exec(out)?.[1] ?? '';
    drawingsIn(dark).forEach((name) => expect(urlOf(name)).toContain("stroke='%23eeeeee'"));
    drawingsIn(out.slice(0, out.indexOf('@media (prefers-color-scheme: dark) { .a'))).forEach((name) => expect(urlOf(name)).toContain("stroke='%23111111'"));
  });

  it('adds nothing for a media query that does not change this border', async () => {
    const out = await transform(':root { --ink: red; --bg: white; }\n@media (prefers-color-scheme: dark) { :root { --bg: black; } }\n.a { border: 1px solid var(--ink); }\n');
    expect(out).not.toContain('@media (prefers-color-scheme: dark) { .a');
  });

  it('nests the variant inside the rule\'s own @media, keeps !important and pseudo-elements fixed', async () => {
    const css = ':root { --ink: red; }\n@supports (color: lab(0 0 0)) { :root { --ink: blue; } }\n@media (min-width: 1px) { .a::before { border: 1px solid var(--ink) !important; } }\n';
    expect(shape(await transform(css))).toMatch(
      /@media \(min-width: 1px\) \{ \.a::before \{ border: 1px solid var\(--ink\) !important; border-color: transparent !important; border-image: var\(--sk-[0-9a-f]{8}\) 14 \/ 14px \/ 5\.5px stretch !important; \} @supports \(color: lab\(0 0 0\)\) \{ \.a::before \{ border-image: var\(--sk-[0-9a-f]{8}\) 14 \/ 14px \/ 5\.5px stretch !important; \} \} \}/,
    );
  });

  it('turns the drawing off where the variable makes the border transparent', async () => {
    const out = await transform(':root { --ink: red; }\n@media print { :root { --ink: transparent; } }\n.a { border: 1px solid var(--ink); }\n');
    expect(shape(out)).toContain('@media print { .a { border-image: none; } }');
  });
});

describe('colour errors', () => {
  it('currentColor, written or left out, names the line, the cause and the fixes', async () => {
    const message = await errorOf('.a {\n  border: 1px solid;\n}\n');
    expect(message).toContain('theme.css:2:3:');
    expect(message).toContain('currentColor');
    expect(message).toContain('색을 생략해도 currentColor');
    expect(message).toContain('border: 1px solid #1d2433');
    expect(message).toContain('--sketch: off');
    expect(await errorOf('.a { border: 1px solid currentColor; }')).toContain('currentColor');
  });

  it('an unresolvable var() names the variable and where to define it', async () => {
    const message = await errorOf('.a { border: 1px solid var(--ink); }');
    expect(message).toContain('theme.css:1:6:');
    expect(message).toContain('`var(--ink)`');
    expect(message).toContain(':root');
    expect(message).toContain('postcss-import');
    expect(message).toContain('--sketch: off');
    expect(await errorOf(':root { --a: var(--b); --b: var(--a); }\n.a { border: 1px solid var(--a); }')).toContain('순환');
  });

  it('a class theme or another rule changing the variable is an error, even through another variable', async () => {
    const message = await errorOf(':root { --base: red; --ink: var(--base); }\nhtml.dark { --base: blue; }\n.a { border: 1px solid var(--ink); }\n');
    expect(message).toContain('`--base`');
    expect(message).toContain('`html.dark`(2:13)');
    expect(message).toContain('@media (prefers-color-scheme: dark)');
    // A modifier with its parent in the selector may change the variable (M4, README 7).
    expect(await errorOf('.a { --c: red; border: 1px solid var(--c); }\n.a.big { --c: blue; }\n')).toBe('no error');
    expect(await errorOf('.x { --c: blue; }\n.a { border: 1px solid var(--c, red); }\n')).toContain('`--c`');
  });

  it('a media query that makes the border undrawable is an error', async () => {
    const message = await errorOf(':root { --s: solid; }\n@media print { :root { --s: dashed; } }\n.a { border: 1px var(--s) red; }\n');
    expect(message).toContain('@media print');
  });

  it('reports every error at once, each with its line', async () => {
    const message = await errorOf('.a { border: 1px solid; }\n.b { border: 1px solid var(--x); }\n');
    expect(message).toContain('오류 2개');
    expect(message).toContain('\n1:6 ');
    expect(message).toContain('\n2:6 ');
  });
});

describe('--sketch control', () => {
  it('`--sketch: off` leaves the rule alone, silences its errors and is removed', async () => {
    expect(await transform('.a { border: 1px solid; --sketch: off; }\n.b { border: 1px solid red; --sketch: OFF; }\n')).toBe(
      '.a { border: 1px solid; }\n.b { border: 1px solid red; }\n',
    );
    expect(await transform('.a { --sketch: off; }\n')).toBe('.a { }\n');
  });

  it('any other value is an error', async () => {
    expect(await errorOf('.a { border: 1px solid red; --sketch: on; }')).toContain('`--sketch`에는 `off`만');
  });
});

// --- M4: borders across rules -------------------------------------------------

describe('cascade across rules', () => {
  /** Rule lines of the output whose selector is exactly `selector`, structure only. */
  const rulesFor = (css: string, selector: string): ReadonlyArray<string> =>
    shape(css)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${selector} {`) || line.includes(`{ ${selector} {`));

  it('a modifier with its parent in the selector draws with the values it takes from the parent', async () => {
    const out = await transform('.btn { border: 2px solid red; border-radius: 6px; }\n.btn.btn--lg { border-width: 3px; border-radius: 10px; }\n');
    expect(rulesFor(out, '.btn.btn--lg')).toEqual([
      '.btn.btn--lg { border-width: 3px; border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 2.5px stretch; border-radius: 10px; }',
    ]);
  });

  it('combines a state with a modifier that changes another property, right after the later rule', async () => {
    const css = '.btn { border: 2px solid red; }\n.btn.btn--lg { border-width: 3px; }\n.btn:hover { border-color: blue; }\n.next { color: red; }\n';
    const lines = shape(await transform(css)).split('\n');
    const hover = lines.findIndex((line) => line.startsWith('.btn:hover {'));
    expect(lines[hover + 1]).toBe('.btn.btn--lg:hover { border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 4.5px stretch; }');
    expect(lines[hover + 2]).toBe('.next { color: red; }');
  });

  it('does not combine modifiers that change the same property', async () => {
    const out = await transform('.btn { border: 2px solid red; }\n.btn.a { border-color: blue; }\n.btn.b { border-color: green; }\n.btn:hover { border-color: black; }\n');
    expect(out).not.toMatch(/\.btn\.a\.b|\.btn\.a:hover|\.btn\.b:hover/);
  });

  it('combines inside the media query when a same-selector rule there changes another property', async () => {
    const css = '.btn { border: 2px solid red; border-radius: 6px; }\n.btn.primary { border-color: blue; }\n.btn.big { border-radius: 10px; }\n@media (min-width: 900px) { .btn { border-radius: 8px; } }\n';
    const out = shape(await transform(css));
    expect(out).toContain('@media (min-width: 900px) { .btn { border-radius: 8px; border-color: transparent; SLOTS; border-image: var(--sk) 12 / 12px / 3px stretch; } .btn.primary { border-color: transparent; SLOTS; border-image: var(--sk) 12 / 12px / 3px stretch; } }');
    // .btn.big sets its own radius, which beats the media rule in the original CSS too.
    expect(out).not.toMatch(/@media[^\n]*\.btn\.big/);
  });

  it('keeps the context of a descendant selector', async () => {
    const out = shape(await transform('.btn { border: 2px solid red; }\n.toolbar .btn { border-width: 3px; }\n.btn:hover { border-color: blue; }\n'));
    expect(out).toContain('.toolbar .btn { border-width: 3px; border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 4.5px stretch; }');
    expect(out).toContain('.toolbar .btn:hover { border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 4.5px stretch; }');
  });

  it('follows a parent\'s !important, as the original CSS does', async () => {
    const out = shape(await transform('.btn { border: 2px solid red !important; }\n.toolbar .btn { border-width: 3px; }\n.btn:hover { border-color: blue; }\n'));
    // The important 2px red wins over the 3px and the hover colour: no combination is needed,
    // and the important drawing of .btn is what every element shows.
    expect(out).not.toContain('.toolbar .btn:hover');
    expect(out).toContain('border-image: var(--sk) 14 / 14px / 5px stretch !important;');
    expect(out).not.toMatch(/14px \/ 4\.5px stretch/);
  });

  it('shows a border the drawing cannot express as the original CSS would', async () => {
    const out = shape(await transform('.btn { border: 2px solid red; }\n.btn.plain { border-style: dashed; }\n'));
    expect(out).toContain('.btn.plain { border-style: dashed; border-image: none; border-color: red; }');
  });

  it('splits a selector list whose selectors get different drawings', async () => {
    const out = shape(await transform('.a { border: 1px solid red; }\n.b { border: 2px solid red; }\n.a:hover, .b:hover { border-color: blue; }\n'));
    expect(out).toContain('.a:hover, .b:hover { border-color: blue; }\n.a:hover { border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 5.5px stretch; }\n.b:hover { border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 5px stretch; }');
  });

  it('takes a variable from a modifier with its parent in the selector', async () => {
    const out = shape(await transform(':root { --ink: red; }\n.btn { border: 2px solid var(--ink); }\n.btn.primary { --ink: blue; }\n'));
    expect(out).toContain('.btn.primary { --ink: blue; border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 5px stretch; }');
  });

  it('resolves nested rules against their parent', async () => {
    const out = shape(await transform('.btn { border: 2px solid red; &.big { border-width: 3px; } }\n'));
    expect(out).toContain('&.big { border-width: 3px; border-color: transparent; SLOTS; border-image: var(--sk) 14 / 14px / 4.5px stretch; }');
  });
});

describe('cascade errors', () => {
  it.each([
    ['a modifier named after its parent', '.btn { border: 2px solid red; }\n.btn--lg { border-width: 3px; }\n', '`.btn--lg`'],
    ['a utility class', '.w2 { border-width: 2px; }\n', '`.w2`'],
    ['a colour-only rule', '.x { border-color: red; }\n', '`.x`'],
    ['a width-only and a colour-only rule', '.a { border-width: 1px; }\n.b { border-color: red; }\n', '`.a`'],
    ['currentColor in a partial rule', '.a { border-color: currentColor; }\n', '`.a`'],
  ])('%s without a parent in its selector', async (_name, css, selector) => {
    const message = await errorOf(css);
    expect(message).toContain(selector);
    expect(message).toContain('셀렉터로 알 수 없습니다');
    expect(message).toContain('`.btn.btn--lg`');
    expect(message).toContain('border: 2px solid #1d2433');
    expect(message).toContain('--sketch: off');
  });

  it(':is() with several candidates', async () => {
    const message = await errorOf('.a { border: 1px solid red; }\n.b { border: 1px solid red; }\n:is(.a, .b):hover { border-color: blue; }\n');
    expect(message).toContain(':is(.a, .b):hover');
    expect(message).toContain('.a:hover, .b:hover');
  });

  it('too many rules on one parent', async () => {
    const modifiers = Array.from({ length: 17 }, (_, i) => `.btn.m${i} { border-width: ${i + 1}px; }`).join('\n');
    expect(await errorOf(`.btn { border: 1px solid red; }\n${modifiers}\n`)).toContain('17개로 16개를 넘습니다');
  });

  it('a class theme without the parent in its selector is still an error', async () => {
    expect(await errorOf(':root { --ink: red; }\n.btn { border: 2px solid var(--ink); }\nhtml.dark { --ink: blue; }\n')).toContain('`html.dark`');
  });

  it.each([
    ['name-only-width.css', 'name-only-width.css:9:23:', '`.btn--large`'],
    ['name-only-color.css', 'name-only-color.css:6:17:', '`.card--active`'],
  ])('fixture %s fails where its comment says', async (file, at, selector) => {
    const path = new URL(`../fixtures/cascade/${file}`, import.meta.url);
    const css = readFileSync(path, 'utf8');
    const message = await transform(css, {}, fileURLToPath(path)).then(
      () => 'no error',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).toContain(at);
    expect(message).toContain(selector);
  });
});

// --- M5: one-sided lines --------------------------------------------------------

describe('one-sided lines', () => {
  it('draws a line on that side only, ends fixed, reaching the element ends', async () => {
    const out = shape(await transform('.a { border-bottom: 1px solid red; }\n'));
    expect(out).toBe('.a { border-bottom: 1px solid red; border-color: transparent; SLOTS; border-image: var(--sk) 0 16 11 16 / 0 16px 11px 16px / 11px 3px 5px 3px stretch; }\n');
  });

  it.each([
    ['top', '.a { border: 0; border-top: 2px solid red; }', '12 16 0 16 / 12px 16px 0 16px / 5px 3px 12px 3px'],
    ['left', '.a { border-left: 4px solid red; }', '16 0 16 14 / 16px 0 16px 14px / 3px 14px 3px 5px'],
    ['right', '.a { border-right: 1px solid red; border-radius: 6px 0 0 6px; }', '16 11 16 0 / 16px 11px 16px 0 / 3px 5px 3px 11px'],
    ['bottom with a rounded top', '.tab { border-bottom: 2px solid red; border-radius: 6px 6px 0 0; }', '0 16 12 16 / 0 16px 12px 16px / 12px 3px 5px 3px'],
  ])('%s', async (_side, css, placement) => {
    expect(await transform(`${css}\n`)).toContain(`border-image: var(--sk) ${placement} stretch;`);
  });

  it('a state that changes the colour takes the rest from the one-sided rule', async () => {
    const out = shape(await transform('.list li { border-bottom: 1px solid red; }\n.list li:hover { border-bottom-color: blue; }\n'));
    expect(out).toContain('.list li:hover { border-bottom-color: blue; border-color: transparent; SLOTS; border-image: var(--sk) 0 16 11 16 / 0 16px 11px 16px / 11px 3px 5px 3px stretch; }');
  });

  it('currentColor on a one-sided line is an error, as on a box', async () => {
    expect(await errorOf('.b { border-bottom: 1px solid; }\n')).toContain('currentColor');
  });
});

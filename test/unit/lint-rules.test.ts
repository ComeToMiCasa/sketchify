// Checks that eslint.config.js enforces the CLAUDE.md coding conventions in the right folders.
// Code is linted as if it lived at the given path; the files do not need to exist.
import { ESLint } from 'eslint';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Virtual files are not in tsconfig.json, so type information is turned off here.
// The only type-aware rule (switch-exhaustiveness-check) is a stock rule and not tested.
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false, project: null } },
    rules: { '@typescript-eslint/switch-exhaustiveness-check': 'off' },
  },
});

const ruleIds = async (file: string, code: string): Promise<ReadonlyArray<string | null>> => {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((message) => message.ruleId);
};

type Case = readonly [title: string, file: string, code: string, rules: ReadonlyArray<string>];

const violations: ReadonlyArray<Case> = [
  ['function declaration', 'src/emit/a.ts', 'export function f(): number { return 1; }\n', ['func-style', 'no-restricted-syntax']],
  ['function expression', 'src/emit/a.ts', 'export const f = function (): number { return 1; };\n', ['no-restricted-syntax']],
  ['method shorthand', 'src/emit/a.ts', 'export const p = { Once(): void {} };\n', ['no-restricted-syntax']],
  ['class declaration', 'src/emit/a.ts', 'export class A {}\n', ['no-restricted-syntax']],
  ['class expression', 'src/emit/a.ts', 'export const A = class {};\n', ['no-restricted-syntax']],
  ['function in tests', 'test/unit/a.test.ts', 'export function f(): number { return 1; }\n', ['func-style', 'no-restricted-syntax']],
  ['default export outside index.ts', 'src/emit/a.ts', 'const f = (): number => 1;\nexport default f;\n', ['no-restricted-syntax']],
  ['let never reassigned', 'src/emit/a.ts', 'let a = 1;\nexport const b = a;\n', ['prefer-const']],
  ['Math.random', 'src/draw/a.ts', 'export const r = (): number => Math.random();\n', ['no-restricted-properties']],
  ['Date', 'src/emit/a.ts', 'export const now = (): number => Date.now();\n', ['no-restricted-globals']],
  ['console outside entry points', 'src/emit/a.ts', 'export const log = (): void => { console.log(1); };\n', ['no-console']],
  ['fs outside entry points', 'src/emit/a.ts', "import { readFileSync } from 'node:fs';\nexport const read = (): string => readFileSync('a', 'utf8');\n", ['@typescript-eslint/no-restricted-imports']],
  ['process outside entry points', 'src/emit/a.ts', "export const out = (): void => { process.stdout.write('a'); };\n", ['no-restricted-globals']],
  ['postcss value import in draw/', 'src/draw/a.ts', "import postcss from 'postcss';\nexport const p = postcss;\n", ['@typescript-eslint/no-restricted-imports']],
  ['selector parser value import in gather/', 'src/gather/a.ts', "import parser from 'postcss-selector-parser';\nexport const p = parser;\n", ['@typescript-eslint/no-restricted-imports']],
  ['selector parser given a PostCSS rule in read/', 'src/read/a.ts', "import parser from 'postcss-selector-parser';\nimport type { Rule } from 'postcss';\nexport const f = (rule: Rule): void => { parser().processSync(rule); };\n", ['no-restricted-syntax']],
  ['postcss value import in read/', 'src/read/a.ts', "import postcss from 'postcss';\nexport const p = postcss;\n", ['@typescript-eslint/no-restricted-imports']],
  ['node.remove() in read/', 'src/read/a.ts', "import type { Declaration } from 'postcss';\nexport const f = (d: Declaration): void => { d.remove(); };\n", ['no-restricted-syntax']],
  ['rule.append() in gather/', 'src/gather/a.ts', "import type { Rule } from 'postcss';\nexport const f = (r: Rule): void => { r.append({ prop: 'a', value: 'b' }); };\n", ['no-restricted-syntax']],
  ['node.replaceWith() in draw/', 'src/draw/a.ts', "import type { Rule } from 'postcss';\nexport const f = (r: Rule): void => { r.replaceWith(r); };\n", ['no-restricted-syntax']],
  ['decl.after() in gather/', 'src/gather/a.ts', "import type { Declaration } from 'postcss';\nexport const f = (d: Declaration): void => { d.after('a: b'); };\n", ['no-restricted-syntax']],
  ['assigning to an input in gather/', 'src/gather/a.ts', "import type { Declaration } from 'postcss';\nexport const f = (d: Declaration): void => { d.value = 'x'; };\n", ['no-param-reassign']],
  ['fs in draw/', 'src/draw/a.ts', "import { readFileSync } from 'fs';\nexport const read = (): string => readFileSync('a', 'utf8');\n", ['@typescript-eslint/no-restricted-imports']],
];

const allowed: ReadonlyArray<readonly [title: string, file: string, code: string]> = [
  ['arrow function', 'src/emit/a.ts', 'export const f = (n: number): number => n + 1;\n'],
  ['plugin default export in index.ts', 'src/index.ts', 'const plugin = (): number => 1;\nexport default plugin;\n'],
  ['type import from postcss in draw/', 'src/draw/a.ts', "import type { Root } from 'postcss';\nexport const count = (root: Root): number => root.nodes.length;\n"],
  ['reading nodes in read/', 'src/read/a.ts', "import type { Root } from 'postcss';\nexport const props = (root: Root): ReadonlyArray<string> => { const out: string[] = []; root.walkDecls((d) => { out.push(d.prop); }); return out; };\n"],
  ['selector parser reading selector text in read/', 'src/read/a.ts', "import parser from 'postcss-selector-parser';\nexport const f = (text: string): number => parser().astSync(String(text)).nodes.length + parser().astSync('.a').nodes.length;\n"],
  ['local loop variables in draw/', 'src/draw/a.ts', 'export const sum = (n: number): number => { let s = 0; for (let i = 0; i < n; i += 1) { s += i; } return s; };\n'],
  ['node mutation in emit/', 'src/emit/a.ts', "import type { Declaration } from 'postcss';\nexport const f = (d: Declaration): void => { d.value = 'x'; d.remove(); };\n"],
  ['postcss value import in emit/', 'src/emit/a.ts', "import postcss from 'postcss';\nexport const decl = (): unknown => postcss.decl({ prop: 'a', value: 'b' });\n"],
  ['console and fs in cli.ts', 'src/cli.ts', "import { readFileSync } from 'node:fs';\nexport const run = (): void => { console.log(readFileSync('a', 'utf8')); process.exitCode = 0; };\n"],
];

describe('ESLint enforces the coding conventions', () => {
  it.each(violations)('rejects %s', async (_title, file, code, rules) => {
    const found = await ruleIds(file, code);
    expect(found).not.toContain(null); // no parse errors
    for (const rule of rules) expect(found).toContain(rule);
  });

  it.each(allowed)('allows %s', async (_title, file, code) => {
    expect(await ruleIds(file, code)).toEqual([]);
  });
});

// Enforces the coding conventions in CLAUDE.md ("Coding conventions").
// ESLint replaces a rule's whole option list when a later block sets the same rule,
// so the restriction lists are built here and combined per folder.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const PURE_DIRS = ['src/read/**', 'src/gather/**', 'src/draw/**'];
const IO_FILES = ['src/index.ts', 'src/cli.ts'];

// --- no-restricted-syntax ---------------------------------------------------
const FUNCTION_STYLE = [
  {
    selector: 'FunctionDeclaration',
    message: 'Write functions only as `const f = (...) => ...` (CLAUDE.md coding conventions).',
  },
  {
    selector: 'FunctionExpression',
    message: 'Use arrow functions instead of `function` expressions and method shorthand (CLAUDE.md coding conventions).',
  },
  { selector: 'ClassDeclaration', message: 'No `class`. Data as `type`, behaviour as functions (CLAUDE.md coding conventions).' },
  { selector: 'ClassExpression', message: 'No `class`. Data as `type`, behaviour as functions (CLAUDE.md coding conventions).' },
];
const NO_DEFAULT_EXPORT = [
  {
    selector: 'ExportDefaultDeclaration',
    message: 'Named exports only. The only default export is the plugin entry point in src/index.ts (CLAUDE.md coding conventions).',
  },
];
// PostCSS Node/Container methods that change the tree. Matched by name, so this is a
// best-effort guard: it cannot see a node that was stored under another name and changed.
const POSTCSS_MUTATORS = [
  'after',
  'before',
  'append',
  'prepend',
  'insertBefore',
  'insertAfter',
  'remove',
  'removeAll',
  'removeChild',
  'replaceWith',
  'replaceValues',
  'cloneBefore',
  'cloneAfter',
  'assign',
];
const NO_NODE_MUTATION = [
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${POSTCSS_MUTATORS.join('|')})$/]`,
    message: 'read/, gather/ and draw/ do not modify PostCSS nodes. AST changes only in emit/ (CLAUDE.md coding conventions).',
  },
];

// postcss-selector-parser can rewrite a PostCSS rule's selector when given the rule itself
// (`parser(fn).processSync(rule)` sets rule.selector by default). read/ may parse selectors, but
// only as text: the argument must be a string, a template literal or `String(...)`.
const SELECTOR_PARSER_METHODS = ['process', 'processSync', 'transform', 'transformSync', 'ast', 'astSync'];
const SELECTOR_TEXT_ONLY = [
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${SELECTOR_PARSER_METHODS.join('|')})$/]:not([arguments.0.type='Literal'], [arguments.0.type='TemplateLiteral'], [arguments.0.callee.name='String'])`,
    message: 'In read/, pass only selector text to the selector parser (a string, a template, `String(...)`). Given a PostCSS rule, the parser changes rule.selector (CLAUDE.md coding conventions).',
  },
];

// --- no-restricted-imports --------------------------------------------------
const IO_MESSAGE = 'File and console I/O only in src/cli.ts and src/index.ts (CLAUDE.md coding conventions).';
const NO_IO_IMPORTS = ['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'readline', 'node:readline'].map(
  (name) => ({ name, message: IO_MESSAGE }),
);
const postcssTypesOnly = (name) => ({
  name,
  allowTypeImports: true,
  message: 'read/, gather/ and draw/ use `import type` only. APIs that create or change nodes belong in emit/ (CLAUDE.md coding conventions).',
});
const NO_POSTCSS_VALUES = ['postcss', 'postcss-selector-parser'].map(postcssTypesOnly);
// read/ parses selectors with postcss-selector-parser (as text only, see SELECTOR_TEXT_ONLY).
const NO_POSTCSS_VALUES_READ = ['postcss'].map(postcssTypesOnly);

// --- no-restricted-globals --------------------------------------------------
const NO_DATE = [{ name: 'Date', message: 'Deterministic output: no `Date` (CLAUDE.md coding conventions).' }];
const NO_PROCESS = [{ name: 'process', message: IO_MESSAGE }];

export default tseslint.config(
  { ignores: ['dist/', 'site/dist/', 'node_modules/', 'prototypes/', 'test-results/', 'playwright-report/'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type information, only for the TypeScript files in tsconfig.json.
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false },
      ],
    },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },

  // Project code: functional style.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-restricted-syntax': ['error', ...FUNCTION_STYLE, ...NO_DEFAULT_EXPORT],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // The landing page (site/): the same functional style; Node scripts and one browser script.
  {
    files: ['site/**/*.mjs', 'site/**/*.js'],
    rules: {
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-restricted-syntax': ['error', ...FUNCTION_STYLE, ...NO_DEFAULT_EXPORT],
    },
  },
  {
    files: ['site/*.mjs'],
    languageOptions: { globals: Object.fromEntries(['console', 'process', 'setTimeout', 'clearTimeout', 'URL'].map((name) => [name, 'readonly'])) },
  },
  {
    files: ['site/src/**/*.js'],
    languageOptions: {
      globals: Object.fromEntries(
        ['window', 'document', 'console', 'setTimeout', 'requestAnimationFrame', 'performance', 'matchMedia', 'ResizeObserver', 'navigator'].map((name) => [name, 'readonly']),
      ),
    },
  },

  // src/: deterministic output.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Deterministic output: random numbers only from seeded generators (CLAUDE.md coding conventions).' },
      ],
      'no-restricted-globals': ['error', ...NO_DATE],
    },
  },

  // src/ except the entry points: no file or console I/O.
  {
    files: ['src/**/*.ts'],
    ignores: IO_FILES,
    rules: {
      'no-console': 'error',
      'no-restricted-globals': ['error', ...NO_DATE, ...NO_PROCESS],
      '@typescript-eslint/no-restricted-imports': ['error', { paths: NO_IO_IMPORTS }],
    },
  },

  // The plugin entry point is the one default export PostCSS needs.
  {
    files: ['src/index.ts'],
    rules: { 'no-restricted-syntax': ['error', ...FUNCTION_STYLE] },
  },

  // read/, gather/, draw/: pure functions. No PostCSS node mutation, no input mutation.
  {
    files: PURE_DIRS,
    rules: {
      'no-restricted-syntax': ['error', ...FUNCTION_STYLE, ...NO_DEFAULT_EXPORT, ...NO_NODE_MUTATION],
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [...NO_IO_IMPORTS, ...NO_POSTCSS_VALUES] }],
      'no-param-reassign': ['error', { props: true }],
    },
  },

  // read/: may parse selectors with postcss-selector-parser, as text only.
  {
    files: ['src/read/**'],
    rules: {
      'no-restricted-syntax': ['error', ...FUNCTION_STYLE, ...NO_DEFAULT_EXPORT, ...NO_NODE_MUTATION, ...SELECTOR_TEXT_ONLY],
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [...NO_IO_IMPORTS, ...NO_POSTCSS_VALUES_READ] }],
    },
  },
);

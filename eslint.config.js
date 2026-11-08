// Enforces the coding conventions in CLAUDE.md ("코딩 컨벤션").
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
    message: '함수는 `const f = (...) => ...` 형식으로만 쓴다 (CLAUDE.md 코딩 컨벤션).',
  },
  {
    selector: 'FunctionExpression',
    message: '`function` 표현식과 메서드 단축 문법 대신 화살표 함수를 쓴다 (CLAUDE.md 코딩 컨벤션).',
  },
  { selector: 'ClassDeclaration', message: '`class`는 쓰지 않는다. 데이터는 `type`, 동작은 함수로 (CLAUDE.md 코딩 컨벤션).' },
  { selector: 'ClassExpression', message: '`class`는 쓰지 않는다. 데이터는 `type`, 동작은 함수로 (CLAUDE.md 코딩 컨벤션).' },
];
const NO_DEFAULT_EXPORT = [
  {
    selector: 'ExportDefaultDeclaration',
    message: '이름 있는 export만 쓴다. default export는 src/index.ts의 플러그인 진입점만 (CLAUDE.md 코딩 컨벤션).',
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
    message: 'read/, gather/, draw/는 PostCSS 노드를 수정하지 않는다. AST 수정은 emit/에서만 (CLAUDE.md 코딩 컨벤션).',
  },
];

// postcss-selector-parser can rewrite a PostCSS rule's selector when given the rule itself
// (`parser(fn).processSync(rule)` sets rule.selector by default). read/ may parse selectors, but
// only as text: the argument must be a string, a template literal or `String(...)`.
const SELECTOR_PARSER_METHODS = ['process', 'processSync', 'transform', 'transformSync', 'ast', 'astSync'];
const SELECTOR_TEXT_ONLY = [
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${SELECTOR_PARSER_METHODS.join('|')})$/]:not([arguments.0.type='Literal'], [arguments.0.type='TemplateLiteral'], [arguments.0.callee.name='String'])`,
    message: 'read/에서 셀렉터 파서에는 셀렉터 글자만 넘긴다(문자열, 템플릿, `String(...)`). PostCSS 규칙을 넘기면 파서가 rule.selector를 바꾼다 (CLAUDE.md 코딩 컨벤션).',
  },
];

// --- no-restricted-imports --------------------------------------------------
const IO_MESSAGE = '파일·콘솔 입출력은 src/cli.ts와 src/index.ts에서만 (CLAUDE.md 코딩 컨벤션).';
const NO_IO_IMPORTS = ['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'readline', 'node:readline'].map(
  (name) => ({ name, message: IO_MESSAGE }),
);
const postcssTypesOnly = (name) => ({
  name,
  allowTypeImports: true,
  message: 'read/, gather/, draw/에서는 `import type`만 쓴다. 노드를 만들거나 바꾸는 API는 emit/에서만 (CLAUDE.md 코딩 컨벤션).',
});
const NO_POSTCSS_VALUES = ['postcss', 'postcss-selector-parser'].map(postcssTypesOnly);
// read/ parses selectors with postcss-selector-parser (as text only, see SELECTOR_TEXT_ONLY).
const NO_POSTCSS_VALUES_READ = ['postcss'].map(postcssTypesOnly);

// --- no-restricted-globals --------------------------------------------------
const NO_DATE = [{ name: 'Date', message: '결정적 출력: `Date`는 쓰지 않는다 (CLAUDE.md 코딩 컨벤션).' }];
const NO_PROCESS = [{ name: 'process', message: IO_MESSAGE }];

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'prototypes/', 'test-results/', 'playwright-report/'] },

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

  // src/: deterministic output.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '결정적 출력: 난수는 seed가 있는 생성기만 쓴다 (CLAUDE.md 코딩 컨벤션).' },
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

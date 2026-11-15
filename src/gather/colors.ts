// Resolves `var()` in border declarations (spec "색 해석"). Pure.
//
// Values come from `:root`/`html` rules in the file, and from the drawn rule itself, which
// wins (an element's own value beats the inherited one). Root rules inside `@media` or
// `@supports` make a condition: the file's values with that block's on top, resolved on
// their own. A variable that another rule (a class theme, a modifier) also changes cannot be
// known at build time.
import valueParser from 'postcss-value-parser';
import type { Declaration } from 'postcss';
import { position, type Diagnostic } from '../report/diagnostics';
import type { Condition, VariableDef } from '../read/variables';

/** Variable name → value, for one condition. */
export type Env = ReadonlyMap<string, string>;

export type Scope = {
  /** Values that always apply. */
  readonly base: Env;
  /** Each condition that changes some value, in source order, with base values underneath. */
  readonly conditional: ReadonlyArray<{ readonly conditions: ReadonlyArray<Condition>; readonly env: Env }>;
  /** Definitions outside root rules, for the class-theme check. */
  readonly scoped: ReadonlyArray<VariableDef>;
};

const conditionKey = (conditions: ReadonlyArray<Condition>): string =>
  JSON.stringify(conditions.map((c) => [c.name.toLowerCase(), c.params]));

const envOf = (defs: ReadonlyArray<VariableDef>, under: Env = new Map()): Env =>
  new Map([...under, ...defs.map((def) => [def.name, def.value] as const)]);

export const scopeOf = (defs: ReadonlyArray<VariableDef>): Scope => {
  const rootDefs = defs.filter((def) => def.root);
  const base = envOf(rootDefs.filter((def) => def.conditions.length === 0));
  const keys = [...new Set(rootDefs.filter((def) => def.conditions.length > 0).map((def) => conditionKey(def.conditions)))];
  const conditional = keys.map((key) => {
    const group = rootDefs.filter((def) => def.conditions.length > 0 && conditionKey(def.conditions) === key);
    return { conditions: group[0]?.conditions ?? [], env: envOf(group, base) };
  });
  return { base, conditional, scoped: defs.filter((def) => !def.root) };
};

export type Substitution =
  | { readonly kind: 'ok'; readonly value: string; readonly names: ReadonlyArray<string> }
  | { readonly kind: 'missing'; readonly name: string; readonly cycle: boolean; readonly names: ReadonlyArray<string> };

/**
 * Replaces every `var()` in a value, using fallbacks and variables inside variables.
 * `names` lists every variable the value reads, including ones that fell back.
 */
export const substitute = (value: string, lookup: (name: string) => string | undefined): Substitution => {
  // Local bookkeeping for the walk below; nothing here leaves the function.
  const names: string[] = [];
  const found: { failure?: { readonly name: string; readonly cycle: boolean } } = {};

  const resolve = (text: string, stack: ReadonlyArray<string>): string =>
    valueParser.stringify(valueParser(text).nodes, (node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return undefined;
      const comma = node.nodes.findIndex((child) => child.type === 'div' && child.value === ',');
      const name = valueParser.stringify(comma === -1 ? node.nodes : node.nodes.slice(0, comma)).trim();
      const fallback = comma === -1 ? undefined : valueParser.stringify(node.nodes.slice(comma + 1)).trim();
      names.push(name);
      if (stack.includes(name)) {
        found.failure ??= { name, cycle: true };
        return '';
      }
      const defined = lookup(name);
      if (defined !== undefined) return resolve(defined, [...stack, name]);
      if (fallback !== undefined) return resolve(fallback, stack);
      found.failure ??= { name, cycle: false };
      return '';
    });

  const resolved = resolve(value, []);
  const unique = [...new Set(names)];
  return found.failure ? { kind: 'missing', ...found.failure, names: unique } : { kind: 'ok', value: resolved, names: unique };
};

/** A variable lookup for one rule: its own definitions first, then the condition's values. */
export const lookupFor = (own: Env, env: Env) => (name: string): string | undefined => own.get(name) ?? env.get(name);

// --- Messages ---------------------------------------------------------------

const OFF = '이 규칙을 변환에서 빼려면 규칙 안에 `--sketch: off`를 넣으세요.';

export const currentColorError = (decl: Declaration | undefined): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    '테두리 색을 빌드 때 알 수 없습니다: currentColor. 손그림 테두리는 색을 그림(SVG)에 고정하므로 색이 정해져 있어야 합니다. ' +
    '`border: 1px solid`처럼 색을 생략해도 currentColor가 됩니다. ' +
    `고치는 법: 색을 직접 쓰세요(예: \`border: 1px solid #1d2433\`). ${OFF}`,
});

export const missingVarError = (decl: Declaration, name: string, cycle: boolean): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: cycle
    ? `\`${name}\`의 값이 자기 자신을 참조해(순환) 값을 정할 수 없습니다. 변수 정의를 고치세요. ${OFF}`
    : `\`var(${name})\`의 값을 찾을 수 없습니다. 테두리에 쓰는 변수는 같은 파일의 \`:root\`나 \`html\` 규칙, 또는 이 규칙 안에 정의해야 합니다. ` +
      `다른 파일에 정의했다면 postcss-import 등으로 한 파일로 합친 뒤 변환하세요. ${OFF}`,
});

export const classThemeError = (decl: Declaration, def: VariableDef): Diagnostic => {
  const at = position(def.decl);
  return {
    severity: 'error',
    node: decl,
    message:
      `\`${def.name}\`가 \`${def.rule.selector}\`${at ? `(${at})` : ''}에서 바뀝니다. 클래스로 바꾸는 값은 빌드 때 어떤 값이 쓰일지 알 수 없어 테두리 그림에 담을 수 없습니다. ` +
      `고치는 법: 테마라면 미디어 쿼리로 바꾸세요(예: \`@media (prefers-color-scheme: dark) { :root { ${def.name}: … } }\`). 그러면 조건마다 그림을 따로 만듭니다. ` +
      `이 규칙만의 값이라면 이 규칙 안에 정의하고 다른 규칙에서는 바꾸지 마세요. ${OFF}`,
  };
};

export const conditionUndrawableError = (decl: Declaration | undefined, conditions: ReadonlyArray<Condition>): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `\`${conditions.map((c) => `@${c.name} ${c.params}`).join(' ')}\` 안에서 바뀐 변수 값으로는 이 테두리를 그릴 수 없습니다(실선이 아니거나, 색·두께를 알 수 없는 값). ` +
    `그 조건에서도 같은 종류의 값(px 두께, 실선, 색)이 되도록 변수를 고치세요. ${OFF}`,
});

export const invalidSketchError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: `\`--sketch\`에는 \`off\`만 쓸 수 있습니다. 받은 값: \`${decl.value}\`.`,
});

// --- Cascade (M4) -------------------------------------------------------------

export const parentlessError = (decl: Declaration, selector: string): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `\`${selector}\`는 테두리의 일부(\`${decl.prop}\`)만 바꾸는데, 나머지 값(두께·스타일·색·모서리)을 받을 규칙을 셀렉터로 알 수 없습니다. ` +
    '손그림은 테두리 값을 그림 하나에 담으므로 값을 모두 알아야 하고, 클래스 이름으로 부모를 추측하지는 않습니다. ' +
    '고치는 법: (1) 셀렉터에 테두리가 완성된 규칙을 함께 쓰세요(예: `.btn--lg` 대신 `.btn.btn--lg`). ' +
    '(2) 이 규칙에 테두리 속성을 모두 쓰세요(예: `border: 2px solid #1d2433`). ' +
    `(3) ${OFF}`,
});

export const ambiguousSelectorError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    '`:is()`·`:where()` 안에 후보가 여럿이라, 테두리의 나머지 값을 어느 규칙에서 받을지 정할 수 없습니다. ' +
    `셀렉터 목록으로 풀어 쓰세요(예: \`:is(.a, .b):hover\` → \`.a:hover, .b:hover\`). ${OFF}`,
});

export const familyTooLargeError = (decl: Declaration, count: number, max: number): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `이 규칙의 테두리를 바꾸는 규칙(수정자·상태·조건)이 ${count}개로 ${max}개를 넘습니다. 조합이 2^${count}가지로 늘어 처리하지 않습니다. ` +
    `규칙을 나누거나(예: 크기별 기본 클래스), 일부 규칙에 \`--sketch: off\`를 넣으세요.`,
});

// --- Fills (M6a) -------------------------------------------------------------------

export const invalidFillError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message: `\`--sketch-fill\`에는 \`solid\`, \`rough\`, \`marker\`, \`hatch\` 중 하나를 쓸 수 있습니다. 받은 값: \`${decl.value}\`.`,
});

export const invalidSizeError = (decl: Declaration): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    `\`--sketch-size\`에는 요소의 테두리 상자(border-box) 크기를 \`가로 세로\`(예: \`240 160\` 또는 \`240px 160px\`)나, 정사각형이면 \`가로\` 하나로 씁니다. ` +
    `0보다 큰 px 값이어야 합니다. 받은 값: \`${decl.value}\`.`,
});

export const currentFillColorError = (decl: Declaration | undefined): Diagnostic => ({
  severity: 'error',
  node: decl,
  message:
    '채움 색을 빌드 때 알 수 없습니다: currentColor. `--sketch-fill: rough`·`marker`는 배경색을 그림(SVG)에 고정하므로 색이 정해져 있어야 합니다. ' +
    `고치는 법: 배경색을 직접 쓰거나(예: \`background-color: #ffe38a\`), \`--sketch-fill\`을 빼서 원래 배경을 쓰세요. ${OFF}`,
});

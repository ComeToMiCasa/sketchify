// Warnings (spec "제약과 오류 처리", M8): why something is not drawn, or may not look right. Pure.
// Each has a name the `quiet` option can turn off; `--sketch: off` on a rule leaves it out too.
import type { Node } from 'postcss';
import { BASE_LAYER } from '../emit/layer';
import type { Emission } from '../gather/gather';
import type { FileContext } from '../read/context';
import type { RuleFacts } from '../read/collect';
import { type SelectorEntry, contains, parseSelectorList, selectorText } from '../read/selectors';
import type { Diagnostic } from './diagnostics';

export const WARNING_KINDS = [
  'style',
  'mixed',
  'sides',
  'radius',
  'unit',
  'combo',
  'collapse',
  'transition',
  'clip',
  'underline-color',
  'fill-image',
  'link-color',
] as const;

export type WarningKind = (typeof WARNING_KINDS)[number];

export const isWarningKind = (value: unknown): value is WarningKind => typeof value === 'string' && (WARNING_KINDS as ReadonlyArray<string>).includes(value);

const WHAT: Readonly<Record<WarningKind, string>> = {
  style: '실선(solid)이 아닌 테두리(dashed, dotted 등)는 손그림으로 그리지 않고 원래 CSS대로 둡니다.',
  mixed: '변마다 색이나 두께가 다른 테두리는 손그림으로 그리지 않고 원래 CSS대로 둡니다.',
  sides: '두세 변에만 있는 테두리는 손그림으로 그리지 않고 원래 CSS대로 둡니다(네 변 모두나 한 변만 그림).',
  radius: '이 모서리(32px보다 큰 radius, %, 모서리마다 다르거나 타원)는 손그림으로 그리지 않고 원래 CSS대로 둡니다.',
  unit: 'px가 아닌 테두리 두께(em 등)는 빌드 때 알 수 없어 원래 CSS대로 둡니다.',
  combo: '이 규칙이 다른 규칙과 함께 걸리는 요소에서는 결과 테두리를 그릴 수 없어 원래 CSS대로 보여줍니다.',
  collapse: '`border-collapse: collapse` 표의 칸 테두리는 이웃 칸과 합쳐지지만, 손그림은 칸마다 따로 그려져 겹쳐 보일 수 있습니다.',
  transition: '테두리 색 전환(`transition`)은 손그림에서는 부드럽게 바뀌지 않고 한 번에 바뀝니다.',
  clip: '이 요소를 감싸는 규칙에 `overflow: hidden`(또는 auto, scroll)이 있어, 테두리 밖으로 나가는 손그림 선이 잘릴 수 있습니다. 부모에 padding을 주거나 `overflow: clip`과 `overflow-clip-margin`을 쓰면 안 잘립니다.',
  'underline-color': '밑줄 색(`text-decoration-color` 또는 `color`)을 빌드 때 알 수 없어(부모에서 물려받음 등) 브라우저 밑줄로 둡니다. 이 규칙에 색을 쓰면 손그림으로 그립니다.',
  'fill-image': '배경 이미지가 있어 채움(`--sketch-fill`)을 그리지 않고 원래 배경대로 둡니다.',
  'link-color': '링크 글자색만 바꾸면 `@sketchify base`의 밑줄은 강조색으로 남아 어긋납니다. 이 규칙에 `text-decoration: underline`을 쓰면 그 색으로 다시 그립니다.',
};

/** A warning of a kind, at a node, with how to turn it off. */
export const warning = (kind: WarningKind, node: Node | undefined, detail = ''): Diagnostic => ({
  severity: 'warning',
  node,
  message: `[sketchify:${kind}] ${WHAT[kind]}${detail ? ` (${detail})` : ''} 이 경고를 끄려면 옵션 \`quiet: ['${kind}']\`, 이 규칙만 빼려면 \`--sketch: off\`.`,
});

/** The kind of a warning made by `warning`, read back from its message. */
export const kindOf = (diagnostic: Diagnostic): WarningKind | undefined => {
  const name = /^\[sketchify:([\w-]+)\]/.exec(diagnostic.message)?.[1];
  return isWarningKind(name) ? name : undefined;
};

// --- Warnings from the file around a drawn rule -------------------------------------------

const TABLE_PARTS: ReadonlySet<string> = new Set(['table', 'td', 'th', 'tr', 'caption', 'thead', 'tbody', 'tfoot']);

const firstDecl = (facts: RuleFacts): Node | undefined => facts.lastBorderDecl ?? facts.decls[0];

/** Whether `inner` (a selector with no context) matches every element the compound text `outer` does. */
const covers = (outer: string, inner: SelectorEntry): boolean => {
  const [parsed] = parseSelectorList(outer);
  return parsed !== undefined && inner.context === '' && contains(parsed, inner);
};

/** The compounds before a selector's subject (`.card .list > ` → `.card`, `.list`). */
const contextCompounds = (context: string): ReadonlyArray<string> => context.split(/\s*[>+~]\s*|\s+/).filter((part) => part.trim() !== '');

/**
 * Warnings that need the rest of the file: a drawn rule in a collapsing table, with a border
 * colour transition, or inside a clipping rule (as far as its selector says); and, with a base,
 * page rules that change a link's colour only.
 */
export const contextWarnings = (
  emissions: ReadonlyArray<Emission>,
  facts: ReadonlyArray<RuleFacts>,
  context: FileContext,
  base: boolean,
): ReadonlyArray<Diagnostic> => {
  const clipping = context.clipping.flatMap((selector) => parseSelectorList(selector));
  const transitions = new Set(context.transitions.flatMap((selector) => parseSelectorList(selector)).map(selectorText));
  const drawn = [...new Set(emissions.filter((e) => e.outcome.kind === 'draw').map((e) => e.facts))];
  const fromDrawn = drawn.flatMap((f): ReadonlyArray<Diagnostic> => [
    ...(context.collapse && f.entries.some((entry) => entry.compound.some((simple) => TABLE_PARTS.has(simple))) ? [warning('collapse', firstDecl(f))] : []),
    ...(f.entries.some((entry) => transitions.has(selectorText(entry))) ? [warning('transition', firstDecl(f))] : []),
    ...(f.entries.some((entry) => contextCompounds(entry.context).some((outer) => clipping.some((inner) => covers(outer, inner))))
      ? [warning('clip', firstDecl(f))]
      : []),
  ]);
  const links = base
    ? facts
        .filter((f) => !f.atRules.some((c) => /^layer$/i.test(c.name) && c.params.trim() === BASE_LAYER))
        .filter((f) => f.entries.some((entry) => entry.compound.includes('a') && entry.pseudoElement === ''))
        .flatMap((f): ReadonlyArray<Diagnostic> => {
          const color = f.decls.find((d) => d.prop.toLowerCase() === 'color');
          return color && !f.decls.some((d) => /^text-decoration/i.test(d.prop)) ? [warning('link-color', color)] : [];
        })
    : [];
  return [...fromDrawn, ...links];
};

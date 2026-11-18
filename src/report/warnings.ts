// Warnings (spec "Limits and errors", M8): why something is not drawn, or may not look right. Pure.
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
  style: 'A border that is not solid (dashed, dotted…) is not sketched; it stays as written.',
  mixed: 'A border whose sides differ in colour or width is not sketched; it stays as written.',
  sides: 'A border on two or three sides is not sketched; it stays as written (all four sides or a single side are drawn).',
  radius: 'This radius (over 32px, %, different per corner, or elliptical) is not sketched; the border stays as written.',
  unit: 'A border width not in px (em and so on) is not known at build time; the border stays as written.',
  combo: 'On elements where this rule applies together with another, the resulting border cannot be drawn; it shows as written.',
  collapse: 'Cell borders in a `border-collapse: collapse` table merge with their neighbours, but sketches are drawn per cell and may look doubled.',
  transition: 'A border colour `transition` does not fade on a sketch; it changes at once.',
  clip: 'A rule around this element has `overflow: hidden` (or auto, scroll), which may cut sketched lines that reach outside the border. Padding on the parent, or `overflow: clip` with `overflow-clip-margin`, keeps them whole.',
  'underline-color': 'The underline colour (`text-decoration-color` or `color`) is not known at build time (inherited from a parent, for example), so the browser underline stays. Write the colour in this rule to get a sketched one.',
  'fill-image': 'There is a background image, so the fill (`--sketch-fill`) is not drawn; the background stays as written.',
  'link-color': 'Changing only the link colour leaves the `@sketchify base` underline in the accent colour. Add `text-decoration: underline` to this rule to redraw it in this colour.',
};

/** A warning of a kind, at a node, with how to turn it off. */
export const warning = (kind: WarningKind, node: Node | undefined, detail = ''): Diagnostic => ({
  severity: 'warning',
  node,
  message: `[sketchify:${kind}] ${WHAT[kind]}${detail ? ` (${detail})` : ''} To silence this warning use the option \`quiet: ['${kind}']\`; to leave this rule out, \`--sketch: off\`.`,
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

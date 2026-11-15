// Neighbour variants (spec "이웃 요소 변형"). Writes the drawing variables on `:root` and the
// rules that pick, for every element, which of its rule's variants to use. The only other
// place (with emit.ts) that changes the PostCSS tree.
//
// How it works: a drawn rule fills twelve slot variables, `--sk-{seed}-{flip}`, with its own
// drawings. The rules here never name a drawn rule; they only set, on every element,
// `--sk-{seed}: var(--sk-{seed}-{flip})` and `--sk: var(--sk-{seed})`. `var()` in a custom
// property resolves on the element that has it, so the same pick rules choose each element's
// own drawing, whatever selector, state or media query drew it.
import postcss, { type ChildNode, type Root } from 'postcss';
import { FLIPS } from '../draw/svg';
import { SEEDS } from '../gather/gather';

/** Seeds and flips per drawing. The seed mixing is mod 3 over `:nth-child(3n+…)`, so it needs three seeds. */
export const SEED_COUNT: 3 = SEEDS.length;
export const FLIP_COUNT = FLIPS.length;

/** The variable a mixed rule's `border-image` reads. */
export const PICK = '--sk';

export const seedVar = (seed: number): string => `--sk-${seed}`;
export const slotVar = (seed: number, flip: number): string => `--sk-${seed}-${flip}`;

const range = (n: number): ReadonlyArray<number> => Array.from({ length: n }, (_, i) => i);

/**
 * Seed index for an element whose own, parent's and grandparent's positions are
 * `:nth-child(3n+own)`, `(3n+parent)` and `(3n+grandparent)`, each 1 to 3. From the prototype.
 */
export const seedFor = (grandparent: number, parent: number, own: number): number => (grandparent + parent + own) % SEED_COUNT;

const flipDecls = (flip: number): string =>
  range(SEED_COUNT)
    .map((seed) => `${seedVar(seed)}: var(${slotVar(seed, flip)});`)
    .join(' ');

/**
 * The pick rules, all at zero specificity (`:where`) so the page's own styles always win.
 * Defaults first (seed 0, not flipped), for elements without a grandparent too; then the flip
 * by the element's own position mod 4; then the seed by the three positions mod 3.
 */
export const pickRules = (): ReadonlyArray<string> => {
  const defaults = `:where(*) { ${PICK}: var(${seedVar(0)}); ${flipDecls(0)} }`;
  const flips = range(FLIP_COUNT)
    .slice(1)
    .map((flip) => `:where(:nth-child(${FLIP_COUNT}n+${flip + 1})) { ${flipDecls(flip)} }`);
  const positions = [1, 2, 3];
  const seeds = positions.flatMap((a) =>
    positions.flatMap((b) =>
      positions.flatMap((c) => {
        const seed = seedFor(a, b, c);
        return seed === 0
          ? []
          : [`:where(:nth-child(3n+${a}) > :nth-child(3n+${b}) > :nth-child(3n+${c})) { ${PICK}: var(${seedVar(seed)}); }`];
      }),
    ),
  );
  return [defaults, ...flips, ...seeds];
};

/**
 * The hatch tile's shift for each seed (prototype values): neighbours start the shared tile at
 * different places. Same formula as the drawings; seed 0 keeps the default `0 0`.
 */
export const HATCH_SHIFTS: ReadonlyArray<number> = [0, 61, 127];

export const hatchPickRules = (): ReadonlyArray<string> => {
  const positions = [1, 2, 3];
  // Custom properties inherit: without a default on every element, an element of seed 0 would
  // take its parent's shift.
  const defaults = ':where(*) { --skh: 0px 0px; }';
  return [defaults, ...positions.flatMap((a) =>
    positions.flatMap((b) =>
      positions.flatMap((c) => {
        const seed = seedFor(a, b, c);
        const shift = HATCH_SHIFTS[seed] ?? 0;
        return seed === 0 ? [] : [`:where(:nth-child(3n+${a}) > :nth-child(3n+${b}) > :nth-child(3n+${c})) { --skh: ${shift}px ${shift}px; }`];
      }),
    ),
  )];
};

export type NamedDrawing = { readonly name: string; readonly url: string };

/** `@charset`, `@import` and `@layer a, b;` must stay before any rule. */
const isPrelude = (node: ChildNode): boolean =>
  node.type === 'atrule' && (/^(charset|import)$/i.test(node.name) || (/^layer$/i.test(node.name) && node.nodes === undefined));

/**
 * Puts the drawing variables, and the pick rules when some rule mixes, at the top of the file,
 * after the prelude at-rules. Nothing is added when there are no drawings.
 */
export const emitVariants = (root: Root, drawings: ReadonlyArray<NamedDrawing>, mix: boolean, hatch = false): void => {
  if (drawings.length === 0) return;
  const vars = `:root {\n${drawings.map((drawing) => `  ${drawing.name}: ${drawing.url};`).join('\n')}\n}`;
  const css = [vars, ...(mix ? pickRules() : []), ...(hatch ? hatchPickRules() : [])].join('\n');
  const nodes = postcss.parse(css).nodes.map((node) => node.clone({ raws: { ...node.raws, before: '\n' } }));

  const end = root.nodes.findIndex((node) => !(node.type === 'comment' || isPrelude(node)));
  const leading = end === -1 ? root.nodes : root.nodes.slice(0, end);
  const anchor = leading.filter(isPrelude).at(-1);
  if (anchor) {
    root.insertAfter(anchor, nodes);
    return;
  }
  const first = root.first;
  root.prepend(nodes.map((node, i) => (i === 0 ? node.clone({ raws: { ...node.raws, before: '' } }) : node)));
  if (first) first.raws.before = '\n';
};

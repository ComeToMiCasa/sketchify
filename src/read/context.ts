// What the file says around the drawn rules, for warnings (M8): which selectors clip their
// content, whether tables collapse their borders, which selectors animate border colours.
// Only reads the PostCSS tree.
import type { ChildNode, Container, Declaration, Root } from 'postcss';
import { splitList } from './selectors';

export type FileContext = {
  /** Selectors (as written, one per list item) of rules with `overflow` that clips. */
  readonly clipping: ReadonlyArray<string>;
  /** Some rule sets `border-collapse: collapse`. */
  readonly collapse: boolean;
  /** Selectors of rules whose `transition` covers the border colour. */
  readonly transitions: ReadonlyArray<string>;
};

const CLIPS = /^(hidden|auto|scroll)$/i;

const clips = (decl: Declaration): boolean =>
  /^overflow(-x|-y|-inline|-block)?$/i.test(decl.prop) && decl.value.trim().split(/\s+/).some((word) => CLIPS.test(word));

const animatesBorder = (decl: Declaration): boolean =>
  /^transition(-property)?$/i.test(decl.prop) && /(^|[\s,])(all|border(-[a-z-]*)?)([\s,]|$)/i.test(decl.value);

type Seen = { readonly selectors: ReadonlyArray<string>; readonly decls: ReadonlyArray<Declaration> };

const rulesIn = (container: Container): ReadonlyArray<Seen> =>
  (container.nodes ?? []).flatMap((node: ChildNode): ReadonlyArray<Seen> => {
    if (node.type === 'rule') {
      const decls = (node.nodes ?? []).filter((child): child is Declaration => child.type === 'decl');
      return [{ selectors: splitList(node.selector), decls }, ...rulesIn(node)];
    }
    return node.type === 'atrule' ? rulesIn(node) : [];
  });

export const fileContext = (root: Root): FileContext => {
  const rules = rulesIn(root);
  return {
    clipping: rules.filter((r) => r.decls.some(clips)).flatMap((r) => r.selectors),
    collapse: rules.some((r) => r.decls.some((d) => /^border-collapse$/i.test(d.prop) && /^collapse$/i.test(d.value.trim()))),
    transitions: rules.filter((r) => r.decls.some(animatesBorder)).flatMap((r) => r.selectors),
  };
};

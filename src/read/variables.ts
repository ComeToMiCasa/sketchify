// Custom property definitions in the file, with where they apply. Only reads the PostCSS tree.
import type { ChildNode, Container, Declaration, Rule } from 'postcss';

/** An at-rule a definition sits in, such as `@media (prefers-color-scheme: dark)`. `@layer` is not one. */
export type Condition = { readonly name: string; readonly params: string };

export type VariableDef = {
  readonly name: string;
  readonly value: string;
  /** Defined on `:root` or `html`, so every element inherits it. */
  readonly root: boolean;
  /** Outermost first. Empty for definitions that always apply. */
  readonly conditions: ReadonlyArray<Condition>;
  readonly rule: Rule;
  readonly decl: Declaration;
};

/** `--sketch` and `--sketch-*`: the plugin's own controls, not variables. */
export const isSketchControl = (prop: string): boolean => /^--sketch(-|$)/i.test(prop);

/** `:root`, `html`, or a list of only those. */
export const isRootSelector = (selector: string): boolean =>
  selector.split(',').every((part) => /^(:root|html)$/i.test(part.trim()));

const defsIn = (container: Container, conditions: ReadonlyArray<Condition>): ReadonlyArray<VariableDef> =>
  (container.nodes ?? []).flatMap((node: ChildNode): ReadonlyArray<VariableDef> => {
    if (node.type === 'atrule') {
      if (/keyframes$/i.test(node.name)) return [];
      // `@layer` changes priority, not whether a value applies; it is read like the outside.
      const inner = /^layer$/i.test(node.name) ? conditions : [...conditions, { name: node.name, params: node.params }];
      return defsIn(node, inner);
    }
    if (node.type !== 'rule') return [];
    const root = isRootSelector(node.selector);
    const own = (node.nodes ?? [])
      .filter((child): child is Declaration => child.type === 'decl' && child.prop.startsWith('--') && !isSketchControl(child.prop))
      .map((decl) => ({ name: decl.prop, value: decl.value.trim(), root, conditions, rule: node, decl }));
    return [...own, ...defsIn(node, conditions)];
  });

/** Every custom property definition, in source order. `@keyframes` are skipped. */
export const variableDefs = (container: Container): ReadonlyArray<VariableDef> => defsIn(container, []);

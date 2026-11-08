// Writes drawings into the CSS. With emit/variants.ts, the only place that changes the PostCSS tree.
import postcss from 'postcss';
import type { ImagePlacement } from '../draw/stroke';
import type { RuleFacts } from '../read/collect';
import type { Condition } from '../read/variables';
import { PICK, slotVar } from './variants';

/** One drawing variable for each `--sk-{seed}-{flip}` slot. */
export type Slot = { readonly seed: number; readonly flip: number; readonly drawing: string };

/** How a rule draws its border. */
export type BorderImage =
  /** Picks among its variants with the neighbour rules (`var(--sk)`). */
  | { readonly kind: 'mixed'; readonly placement: ImagePlacement; readonly slots: ReadonlyArray<Slot> }
  /** Always the same drawing (pseudo-elements). */
  | { readonly kind: 'fixed'; readonly placement: ImagePlacement; readonly drawing: string };

/** The `border-image` value for a drawing whose image is `source`. */
export const borderImageValue = (source: string, placement: ImagePlacement): string =>
  `${source} ${placement.slice} / ${placement.width} / ${placement.outset} stretch`;

const sourceOf = (image: BorderImage): string => {
  switch (image.kind) {
    case 'mixed':
      return `var(${PICK})`;
    case 'fixed':
      return `var(${image.drawing})`;
    default: {
      const unreachable: never = image;
      return unreachable;
    }
  }
};

/** The slot variables (mixed rules only) and `border-image` that draw the image. */
const imageDecls = (image: BorderImage, important: boolean): ReadonlyArray<postcss.Declaration> => {
  const slots =
    image.kind === 'mixed'
      ? image.slots.map((slot) => postcss.decl({ prop: slotVar(slot.seed, slot.flip), value: `var(${slot.drawing})`, important }))
      : [];
  return [...slots, postcss.decl({ prop: 'border-image', value: borderImageValue(sourceOf(image), image.placement), important })];
};

/** What to write for an element. */
export type Look =
  /** A drawing. */
  | { readonly kind: 'image'; readonly image: BorderImage }
  /** The original border, shown as CSS would (`border-image: none` and its colours). */
  | { readonly kind: 'plain'; readonly colors: string }
  /** No border at all here (`border-image: none`; the colour stays transparent). */
  | { readonly kind: 'none' };

/**
 * The declarations for a look. A drawing keeps the border's width and style (layout) and hides
 * its colour (`hideColor`). Every declaration carries the importance of the border it draws, so
 * the rule whose border wins also wins the drawing.
 */
const lookDecls = (look: Look, important: boolean, hideColor: boolean): ReadonlyArray<postcss.Declaration> => {
  switch (look.kind) {
    case 'image':
      return [...(hideColor ? [postcss.decl({ prop: 'border-color', value: 'transparent', important })] : []), ...imageDecls(look.image, important)];
    case 'plain':
      return [
        postcss.decl({ prop: 'border-image', value: 'none', important }),
        postcss.decl({ prop: 'border-color', value: look.colors, important }),
      ];
    case 'none':
      return [postcss.decl({ prop: 'border-image', value: 'none', important })];
    default: {
      const unreachable: never = look;
      return unreachable;
    }
  }
};

/**
 * In the rule itself, right after `anchor` (its last border declaration), so a `border`
 * shorthand (which resets `border-image`) never comes after the drawing (spec "구현 주의점").
 */
export const emitInline = (anchor: postcss.Declaration, look: Look, important: boolean): void => {
  anchor.after([...lookDecls(look, important, true)]);
};

/** Writes a new rule after a rule: `(rule, conditions, selector, look, important, hideColor)`. */
export type Inserter = (
  rule: postcss.Rule,
  conditions: ReadonlyArray<Condition>,
  selector: string,
  look: Look,
  important: boolean,
  hideColor: boolean,
) => void;

const conditionKey = (c: Condition): string => `@${c.name.toLowerCase()} ${c.params}`;

/** The outermost style rule around a (possibly nested) rule: new rules go after it, with full selectors. */
const topRule = (rule: postcss.Rule): postcss.Rule => (rule.parent?.type === 'rule' ? topRule(rule.parent as postcss.Rule) : rule);

const atRulesAround = (node: postcss.Node): ReadonlyArray<Condition> => {
  const parent = node.parent;
  if (!parent || parent.type === 'root') return [];
  const outer = atRulesAround(parent as postcss.Node);
  return parent.type === 'atrule' ? [...outer, { name: (parent as postcss.AtRule).name, params: (parent as postcss.AtRule).params }] : outer;
};

/**
 * New rules after a rule, in the order they are written. Each goes after the rule's outermost
 * style rule (CSS nesting), wrapped in the conditions not already around it, and is formatted
 * like the rule: on one line, or indented one step per nesting level.
 */
export const createInserter = (): Inserter => {
  const lastAfter = new Map<postcss.Rule, postcss.ChildNode>();
  return (rule, conditions, selector, look, important, hideColor) => {
    const top = topRule(rule);
    const around = new Set(atRulesAround(top).map(conditionKey));
    const wrap = conditions.filter((c) => !around.has(conditionKey(c)));
    const { before = '\n', between = ' ', after = ' ' } = top.raws;
    const multiline = after.includes('\n');
    const indent = before.slice(before.lastIndexOf('\n') + 1);
    const at = (depth: number): string => (multiline ? `\n${indent}${'  '.repeat(depth)}` : ' ');
    const depth = wrap.length;
    // Straight after the rule: one line break, not the rule's own blank lines.
    const first = before.replace(/\n+/, '\n');
    const inner = postcss.rule({
      selector,
      raws: { before: depth === 0 ? first : at(depth), between, after: at(depth), semicolon: true },
      nodes: lookDecls(look, important, hideColor).map((decl) => decl.clone({ raws: { before: at(depth + 1), between: ': ' } })),
    });
    const node = wrap.reduceRight<postcss.ChildNode>(
      (child, condition, i) =>
        postcss.atRule({
          name: condition.name,
          params: condition.params,
          raws: { before: i === 0 ? first : at(i), between: ' ', afterName: ' ', after: at(i), semicolon: false },
          nodes: [child],
        }),
      inner,
    );
    (lastAfter.get(top) ?? top).after(node);
    lastAfter.set(top, node);
  };
};

/** Removes the plugin's `--sketch` control from the output. */
export const removeControl = (facts: RuleFacts): void => {
  if (facts.sketch.kind !== 'none') facts.sketch.decl.remove();
};

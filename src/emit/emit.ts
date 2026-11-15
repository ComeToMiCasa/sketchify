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

/** A hatch background (M6b): the tile's variable and size. `none`: no hatch here (a condition removes it). */
export type HatchLook = { readonly kind: 'tile'; readonly tile: string; readonly size: number } | { readonly kind: 'none' };

/**
 * The text decoration around a drawn underline (M6d), which is a `border-image` like any border
 * drawing: `hide` turns the browser's underline off under the drawing; `native` brings it back
 * where the drawing does not show; `off` writes back the element's own line (`none`, `line-through`)
 * over another rule's `hide`.
 */
export type UnderlineLook = { readonly kind: 'hide' | 'native' } | { readonly kind: 'off'; readonly line?: string };

const underlineDecls = (underline: UnderlineLook | undefined, important: boolean): ReadonlyArray<postcss.Declaration> => {
  if (!underline) return [];
  switch (underline.kind) {
    case 'hide':
      return [postcss.decl({ prop: 'text-decoration-line', value: 'none', important })];
    case 'native':
      return [postcss.decl({ prop: 'text-decoration-line', value: 'underline', important })];
    case 'off':
      return underline.line === undefined ? [] : [postcss.decl({ prop: 'text-decoration-line', value: underline.line, important })];
    default: {
      const unreachable: never = underline;
      return unreachable;
    }
  }
};

/** The variable the neighbour rules set to shift each element's hatch tile. */
export const HATCH_PICK = '--skh';

/** What to write for an element. */
export type Look =
  /**
   * A drawing. `filled`: it draws the background too, so the original one is hidden.
   * `background`: the original background colour to show again (another rule's fill hid it).
   */
  | {
      readonly kind: 'image';
      readonly image: BorderImage;
      readonly filled?: boolean;
      readonly background?: string;
      readonly hatch?: HatchLook;
      /** An exact hatch (M6c) is in the drawing: a repeated hatch from another rule must not show under it. */
      readonly exact?: boolean;
      readonly underline?: UnderlineLook;
    }
  /** The original border, shown as CSS would (`border-image: none` and its colours). */
  | { readonly kind: 'plain'; readonly colors: string; readonly background?: string; readonly hatch?: HatchLook; readonly underline?: UnderlineLook }
  /** No border at all here (`border-image: none`; the colour stays transparent). */
  | { readonly kind: 'none' }
  /** Only the background (a hatch, a restored colour) or the text decoration; the border is left as it is. */
  | { readonly kind: 'paint'; readonly background?: string; readonly hatch?: HatchLook; readonly underline?: UnderlineLook };

/**
 * The hatch as a background (spec "채움": unknown size). Only paint properties: the layout stays.
 * The tile shows inside the padding box, starting where the neighbour rules shift it.
 */
const hatchDecls = (hatch: HatchLook | undefined, important: boolean, full: boolean): ReadonlyArray<postcss.Declaration> => {
  if (!hatch) return [];
  if (hatch.kind === 'none') return [postcss.decl({ prop: 'background-image', value: 'none', important })];
  const image = postcss.decl({ prop: 'background-image', value: `var(${hatch.tile})`, important });
  if (!full) return [image];
  return [
    postcss.decl({ prop: 'background-color', value: 'transparent', important }),
    image,
    postcss.decl({ prop: 'background-size', value: `${hatch.size}px ${hatch.size}px`, important }),
    postcss.decl({ prop: 'background-repeat', value: 'repeat', important }),
    postcss.decl({ prop: 'background-clip', value: 'padding-box', important }),
    postcss.decl({ prop: 'background-position', value: `var(${HATCH_PICK}, 0 0)`, important }),
  ];
};

/**
 * The declarations for a look. A drawing keeps the border's width and style (layout) and hides
 * its colour (`hideColor`). Every declaration carries the importance of the border it draws, so
 * the rule whose border wins also wins the drawing.
 */
const backgroundDecl = (value: string | undefined, important: boolean): ReadonlyArray<postcss.Declaration> =>
  value === undefined ? [] : [postcss.decl({ prop: 'background-color', value, important })];

const lookDecls = (look: Look, important: boolean, hideColor: boolean): ReadonlyArray<postcss.Declaration> => {
  switch (look.kind) {
    case 'image':
      return [
        ...(hideColor ? [postcss.decl({ prop: 'border-color', value: 'transparent', important })] : []),
        ...(look.hatch ? [] : backgroundDecl(look.filled ? 'transparent' : look.background, important)),
        ...(look.exact ? [postcss.decl({ prop: 'background-image', value: 'none', important })] : []),
        ...hatchDecls(look.hatch, important, hideColor),
        ...imageDecls(look.image, important),
        ...underlineDecls(look.underline, important),
      ];
    case 'plain':
      return [
        postcss.decl({ prop: 'border-image', value: 'none', important }),
        postcss.decl({ prop: 'border-color', value: look.colors, important }),
        ...(look.hatch ? hatchDecls(look.hatch, important, true) : backgroundDecl(look.background, important)),
        ...underlineDecls(look.underline, important),
      ];
    case 'none':
      return [postcss.decl({ prop: 'border-image', value: 'none', important })];
    case 'paint':
      return [...(look.hatch ? hatchDecls(look.hatch, important, hideColor) : backgroundDecl(look.background, important)), ...underlineDecls(look.underline, important)];
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

/** Removes the plugin's controls (`--sketch`, `--sketch-fill`, `--sketch-size`) from the output. */
export const removeControl = (facts: RuleFacts): void => {
  if (facts.sketch.kind !== 'none') facts.sketch.decl.remove();
  facts.decls.filter((decl) => /^--sketch-(fill|size)$/i.test(decl.prop)).forEach((decl) => decl.remove());
};

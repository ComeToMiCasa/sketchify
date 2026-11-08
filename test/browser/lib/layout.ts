import type { Page } from '@playwright/test';

/** One element's geometry, keyed by its DOM path. Rects are in document coordinates. */
export type ElementBox = {
  readonly path: string;
  readonly rect: readonly [x: number, y: number, width: number, height: number];
  /** Line boxes of inline elements (more than one when the text wraps). */
  readonly lines: ReadonlyArray<readonly [number, number, number, number]>;
  /** For elements marked `data-hit`: whether they are the topmost element at sample points. */
  readonly onTop?: ReadonlyArray<boolean>;
};

export type Layout = {
  readonly scroll: readonly [width: number, height: number];
  readonly elements: ReadonlyArray<ElementBox>;
};

/**
 * Measures every element in the body. `data-hit` elements are also probed with
 * elementFromPoint at 10%, 50% and 90% of their width, so stacking changes
 * (e.g. a tooltip covered by the next card) count as layout differences.
 */
export const captureLayout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const parent: Element | null = node.parentElement;
        const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1;
        parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
        node = parent;
      }
      return parts.join(' > ');
    };
    const docRect = (r: DOMRect): [number, number, number, number] => [r.x + scrollX, r.y + scrollY, r.width, r.height];
    const probe = (el: Element): boolean[] => {
      const r = el.getBoundingClientRect();
      return [0.1, 0.5, 0.9].map((fx) => {
        const hit = document.elementFromPoint(r.x + r.width * fx, r.y + r.height / 2);
        return hit !== null && el.contains(hit);
      });
    };
    const elements = Array.from(document.body.querySelectorAll('*')).map((el) => ({
      path: pathOf(el),
      rect: docRect(el.getBoundingClientRect()),
      lines: Array.from(el.getClientRects()).map(docRect),
      ...(el.hasAttribute('data-hit') ? { onTop: probe(el) } : {}),
    }));
    const root = document.documentElement;
    return { scroll: [root.scrollWidth, root.scrollHeight] as const, elements };
  });

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Differences between two layouts, with zero tolerance. Empty means identical.
 * Each entry names the element path and both values.
 */
export const diffLayouts = (before: Layout, after: Layout): ReadonlyArray<string> => {
  const scroll = same(before.scroll, after.scroll) ? [] : [`document scroll size: ${before.scroll.join('x')} -> ${after.scroll.join('x')}`];
  const count =
    before.elements.length === after.elements.length
      ? []
      : [`element count: ${before.elements.length} -> ${after.elements.length}`];
  const afterByPath = new Map(after.elements.map((el) => [el.path, el]));
  const elements = before.elements.flatMap((el) => {
    const other = afterByPath.get(el.path);
    if (!other) return [`${el.path}: missing after transform`];
    return [
      ...(same(el.rect, other.rect) ? [] : [`${el.path}: rect ${JSON.stringify(el.rect)} -> ${JSON.stringify(other.rect)}`]),
      ...(same(el.lines, other.lines) ? [] : [`${el.path}: lines ${JSON.stringify(el.lines)} -> ${JSON.stringify(other.lines)}`]),
      ...(same(el.onTop, other.onTop) ? [] : [`${el.path}: on top ${JSON.stringify(el.onTop)} -> ${JSON.stringify(other.onTop)}`]),
    ];
  });
  return [...scroll, ...count, ...elements];
};

import { expect, test, type Page } from '@playwright/test';
import { loadPage, loadPages } from '../helpers/pages';
import { transform } from '../helpers/transform';
import { captureLayout, diffLayouts, type Layout } from './lib/layout';
import { render } from './lib/render';

// The core promise: the same HTML rendered with the original CSS and with the
// transformed CSS has every element at the same position and size.

const layoutWith = async (page: Page, html: string, css: string): Promise<Layout> => {
  await render(page, html, css);
  return captureLayout(page);
};

/**
 * Pages with `@sketchify base`: the base replaces the browser's look of form controls and is held
 * only to staying close to the browser's sizes (spec "폼 요소와 @sketchify base"), checked in base.spec.ts.
 */
const BASE_PAGES: ReadonlySet<string> = new Set(['base']);

test.describe('layout is unchanged by the transform', () => {
  for (const testPage of loadPages().filter((p) => !BASE_PAGES.has(p.name))) {
    test(testPage.name, async ({ page }) => {
      const before = await layoutWith(page, testPage.html, testPage.css);
      const after = await layoutWith(page, testPage.html, await transform(testPage.css, {}, testPage.cssPath));

      expect(before.elements.length).toBeGreaterThan(3);
      for (const el of before.elements.filter((e) => e.onTop)) {
        expect(el.onTop, `${el.path} should be on top in the original`).toEqual(el.onTop?.map(() => true));
      }
      expect(diffLayouts(before, after)).toEqual([]);
    });
  }
});

// Pages with a dark-mode theme also get condition rules (M3); compare them in dark mode too.
test.describe('layout is unchanged in dark mode', () => {
  for (const name of ['theme', 'design-system']) {
    test(name, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      const testPage = loadPage(name);
      const before = await layoutWith(page, testPage.html, testPage.css);
      const after = await layoutWith(page, testPage.html, await transform(testPage.css, {}, testPage.cssPath));
      expect(before.elements.length).toBeGreaterThan(3);
      expect(diffLayouts(before, after)).toEqual([]);
    });
  }
});

// Negative controls: the comparison must catch the bugs the spec records
// (docs/spec.md "구현 주의점"), otherwise the tests above prove nothing.
test.describe('the layout comparison catches real breakage', () => {
  const broken: ReadonlyArray<readonly [title: string, page: string, extraCss: string, expected: RegExp]> = [
    ['a border 1px wider', 'boxes', '.box.w1 { border-width: 2px; }', /rect/],
    ['position: relative moves an absolute child', 'mega-menu', '.mitem { position: relative; }', /rect/],
    ['isolation: isolate traps a tooltip', 'tooltip', '.card { isolation: isolate; }', /on top/],
  ];

  for (const [title, pageName, extraCss, expected] of broken) {
    test(title, async ({ page }) => {
      const testPage = loadPage(pageName);
      const before = await layoutWith(page, testPage.html, testPage.css);
      const transformed = await transform(testPage.css, {}, testPage.cssPath);
      const after = await layoutWith(page, testPage.html, `${transformed}\n${extraCss}`);
      const diff = diffLayouts(before, after);
      expect(diff.length).toBeGreaterThan(0);
      expect(diff.join('\n')).toMatch(expected);
    });
  }
});

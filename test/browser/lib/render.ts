import type { Page } from '@playwright/test';

// Same for the original and the transformed render, so it never explains a difference.
const FREEZE = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

/** Loads a test page's body HTML with the given CSS and waits for fonts. */
export const render = async (page: Page, html: string, css: string): Promise<void> => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style><style>${FREEZE}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
};

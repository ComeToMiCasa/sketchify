import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A test page: one folder in test/pages with index.html (body content) and style.css. */
export type TestPage = {
  readonly name: string;
  readonly html: string;
  readonly css: string;
  readonly cssPath: string;
};

export const PAGES_DIR = fileURLToPath(new URL('../pages/', import.meta.url));

export const loadPage = (name: string): TestPage => {
  const cssPath = join(PAGES_DIR, name, 'style.css');
  return {
    name,
    html: readFileSync(join(PAGES_DIR, name, 'index.html'), 'utf8'),
    css: readFileSync(cssPath, 'utf8'),
    cssPath,
  };
};

export const loadPages = (): ReadonlyArray<TestPage> =>
  readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(loadPage);

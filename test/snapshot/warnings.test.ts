import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import sketchify from '../../src/index';
import { loadPages } from '../helpers/pages';

// Warnings per example page, by kind (M8). A change shows up as a snapshot diff: a new warning on a
// page, or one that went away. Update with `npx vitest run -u` only when the change is intended.
describe('warnings per page', () => {
  it('counts each kind', async () => {
    const counts = await Promise.all(
      loadPages().map(async (page) => {
        const result = await postcss([sketchify()]).process(page.css, { from: page.cssPath });
        const kinds = result.warnings().map((w) => /^\[sketchify:([\w-]+)\]/.exec(w.text)?.[1] ?? 'other');
        return [page.name, Object.fromEntries([...new Set(kinds)].sort().map((kind) => [kind, kinds.filter((k) => k === kind).length]))] as const;
      }),
    );
    await expect(`${JSON.stringify(Object.fromEntries(counts), null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/warnings.json');
  });
});

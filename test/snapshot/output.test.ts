import { describe, expect, it } from 'vitest';
import { loadPages } from '../helpers/pages';
import { transform } from '../helpers/transform';

// The output of every test page is stored next to this file. A change in the drawings
// shows up as a snapshot diff; update with `npx vitest run -u` only when the change is intended.
describe('output snapshots', () => {
  it.each(loadPages().map((page) => [page.name, page] as const))('%s', async (name, page) => {
    await expect(await transform(page.css, {}, page.cssPath)).toMatchFileSnapshot(`./__snapshots__/${name}.css`);
  });
});

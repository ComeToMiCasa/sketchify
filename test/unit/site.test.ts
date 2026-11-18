import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import sketchify from '../../src/index';

// The landing page (site/) is written so that the plugin draws all of it: no warnings at any
// roughness, within the default size budget.
const css = readFileSync(new URL('../../site/src/style.css', import.meta.url), 'utf8');

describe('landing page CSS', () => {
  it.each(['subtle', 'normal', 'messy'] as const)('compiles without warnings at %s', async (roughness) => {
    const result = await postcss([sketchify({ roughness })]).process(css, { from: 'site/src/style.css' });
    expect(result.warnings().map((w) => w.text)).toEqual([]);
    expect(result.css).toContain('border-image: var(--sk)');
  });
});

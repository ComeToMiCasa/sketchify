import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import sketchify from '../../src/index';
import { indexPage, sketchPage } from '../../site/pages.mjs';

// The landing page (site/) is written so that the plugin draws all of it: no warnings at any
// roughness, within the default size budget.
const css = readFileSync(new URL('../../site/src/style.css', import.meta.url), 'utf8');

describe('landing page CSS', () => {
  it.each(['subtle', 'normal', 'messy'] as const)('compiles without warnings at %s', async (roughness) => {
    const result = await postcss([sketchify({ roughness })]).process(css, { from: 'site/src/style.css' });
    expect(result.warnings().map((w) => w.text)).toEqual([]);
    expect(result.css).toContain('border-image: var(--sk)');
  });

  it('draws the divider tag without warnings', async () => {
    const tag = readFileSync(new URL('../../site/src/tag.css', import.meta.url), 'utf8');
    const result = await postcss([sketchify({ roughness: 'normal' })]).process(tag, { from: 'site/src/tag.css' });
    expect(result.warnings().map((w) => w.text)).toEqual([]);
    expect(result.css).toContain('border-image: var(--sk)');
  });
});

// The index carries the page itself (what search engines and AI crawlers read, since they do not
// follow frames); the sketched copies in the frame are kept out of search results.
describe('landing page HTML', () => {
  const read = (name: string): string => readFileSync(new URL(`../../site/src/${name}`, import.meta.url), 'utf8');
  const body = read('page.html');
  const index = indexPage(read('shell.html'), body);

  it('puts the page itself in the index, with the sketched copy in one frame', () => {
    expect(index).toContain(body);
    expect(index).toContain('<h1 class="hero__title">');
    expect(index).not.toContain('<!-- page -->');
    expect(index).not.toContain('raw.html');
    expect(index.match(/<iframe/g)).toHaveLength(1);
    expect(index).not.toContain('noindex');
  });

  it('keeps the sketched copies out of search results', () => {
    expect(sketchPage('sketchify: normal', ['sketch-normal.css', 'hand.css'], body)).toContain('<meta name="robots" content="noindex">');
  });
});

// What search engines and link previews read about the page: one address everywhere, a preview
// image of the size the tags announce, and structured data that parses.
describe('landing page metadata', () => {
  const read = (name: string): string => readFileSync(new URL(`../../site/src/${name}`, import.meta.url), 'utf8');
  const shell = read('shell.html');
  const URL_ = 'https://cometomicasa.github.io/sketchify/';
  const attr = (pattern: RegExp): string | undefined => shell.match(pattern)?.[1];

  it('uses one address for canonical, og:url, og:image, the sitemap and the structured data', () => {
    expect(attr(/<link rel="canonical" href="([^"]+)">/)).toBe(URL_);
    expect(attr(/<meta property="og:url" content="([^"]+)">/)).toBe(URL_);
    expect(attr(/<meta property="og:image" content="([^"]+)">/)).toBe(`${URL_}og.png`);
    expect(read('sitemap.xml').match(/<loc>([^<]+)<\/loc>/g)).toEqual([`<loc>${URL_}</loc>`]);
    const ld: unknown = JSON.parse(attr(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? 'null');
    expect(ld).toMatchObject({ '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: 'postcss-sketchify', url: URL_ });
  });

  it('has a preview image of the announced size and a favicon', () => {
    const png = readFileSync(new URL('../../site/src/og.png', import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      Number(attr(/<meta property="og:image:width" content="(\d+)">/)),
      Number(attr(/<meta property="og:image:height" content="(\d+)">/)),
    ]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(read('favicon.svg')).toContain('<svg');
    expect(shell).toContain('<link rel="icon" href="favicon.svg" type="image/svg+xml">');
  });
});

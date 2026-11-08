// Current method (pseudo-elements + mask + position/isolation) vs approach A
// (border-image + backgrounds on the element itself, colours baked into the SVG).
import rough from 'roughjs';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { penHatchTile } from '../fills.mjs';

const W = 2;
const L = 120;
const PRESET = { roughness: 1.3, bowing: 1.2, maxRandomnessOffset: 2 };
const SEEDS = [11, 23, 37];
const RADIUS = 6;
const gen = rough.generator();
const r1 = (n) => Math.round(n * 10) / 10;
const tidy = (d) => d.replace(/-?\d*\.\d+/g, (n) => r1(+n));
const enc = (s) => `url("data:image/svg+xml,${s.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

// Same geometry as the showcase: rounded corners get a tight corner slice.
const B = 4, C = B + RADIUS, S = 2 * C + L, OUTSET = B - W / 2;

function strokePaths(seed) {
  const w = S - 2 * B;
  return gen.toPaths(gen.path(rr(B, B, w, w, RADIUS), { stroke: '#000', strokeWidth: W, seed, ...PRESET })).map((p) => tidy(p.d));
}
function blobPaths(seed) {
  const m = B + 1.5, w = S - 2 * m;
  const o = { stroke: 'none', fill: '#000', fillStyle: 'solid', seed, ...PRESET, roughness: 1.6 };
  return gen.toPaths(gen.path(rr(m, m, w, w, RADIUS - 1), o)).map((p) => tidy(p.d));
}
/** One 9-slice SVG: optional rough blob in `fill`, stroke in `stroke`. */
function nine({ seed, stroke, fill }) {
  const blob = fill ? blobPaths(seed + 100).map((d) => `<path d='${d}' fill='${fill}'/>`).join('') : '';
  const line = stroke ? `<g fill='none' stroke='${stroke}' stroke-width='${W * 0.85}' stroke-linecap='round'>${strokePaths(seed).map((d) => `<path d='${d}'/>`).join('')}</g>` : '';
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${S}' height='${S}' viewBox='0 0 ${S} ${S}'>${blob}${line}</svg>`);
}

const INK = '#1d2433', INK_DARK = '#e7eaf0';
const BRAND = '#2f6fe4', BRAND_DARK = '#7ea6ff';
const FILL = '#f6c445', FILL_DARK = '#b8892a';
const HOVER_FILL = '#ffe38a', HOVER_FILL_DARK = '#d9a93a';

// ---------------- current method ----------------
let cur = '';
const c = (s) => (cur += s + '\n');
c(`.cur { --stroke: ${INK}; --fill: ${FILL}; --brand: ${BRAND}; --hover-fill: ${HOVER_FILL}; }
.cur.dark, .dark .cur { --stroke: ${INK_DARK}; --fill: ${FILL_DARK}; --brand: ${BRAND_DARK}; --hover-fill: ${HOVER_FILL_DARK}; }
.cur .sk { position: relative; isolation: isolate; border: ${W}px solid transparent; border-radius: ${RADIUS}px; }
.cur .sk::before { content: ""; position: absolute; inset: -${W + OUTSET}px; z-index: -1; pointer-events: none; background: var(--stroke);
  -webkit-mask-box-image: var(--sk-b0) ${C} / ${C}px stretch; mask-border: var(--sk-b0) ${C} / ${C}px stretch; }
.cur .sk.brand::before { background: var(--brand); }
.cur .sk.fx::after { content: ""; position: absolute; z-index: -2; pointer-events: none; inset: -${W}px; border-radius: inherit; background: var(--fill); }
.cur .sk.fx.rough::after { inset: -${W + OUTSET}px; border-radius: 0; -webkit-mask-box-image: var(--sk-f0) ${C} fill / ${C}px stretch; mask-border: var(--sk-f0) ${C} fill / ${C}px stretch; }
.cur .sk.fx.hatch::after { inset: 0; border-radius: 0; -webkit-mask: var(--sk-h) 0 0 / 192px 192px repeat; mask: var(--sk-h) 0 0 / 192px 192px repeat; }
.cur .sk.hov:hover::before, .force-hover .cur .sk.hov::before { background: var(--brand); }
.cur .sk.hov:hover::after, .force-hover .cur .sk.hov::after { background: var(--hover-fill); }`);
const strokeMasks = SEEDS.map((sd) => nine({ seed: sd, stroke: '#000' }));
const blobMasks = SEEDS.map((sd) => nine({ seed: sd, fill: '#000' }));
const hatch = penHatchTile({ seed: 7 });
c(`.cur { ${strokeMasks.map((u, k) => `--sk-b${k}: ${u};`).join(' ')} ${blobMasks.map((u, k) => `--sk-f${k}: ${u};`).join(' ')} --sk-h: ${hatch.url}; }`);
for (const k of [1, 2]) {
  c(`.cur .sk:nth-child(3n+${k + 1})::before { -webkit-mask-box-image-source: var(--sk-b${k}); mask-border-source: var(--sk-b${k}); }`);
  c(`.cur .sk.fx.rough:nth-child(3n+${k + 1})::after { -webkit-mask-box-image-source: var(--sk-f${k}); mask-border-source: var(--sk-f${k}); }`);
}

// ---------------- approach A ----------------
// Every colour the page uses becomes its own drawing. Theme (light/dark) and hover double it.
let alt = '';
const a = (s) => (alt += s + '\n');
const tint = (url, colour) => url.replace(/%23000/g, colour.replace('#', '%23'));
a(`.alt .sk { border: ${W}px solid transparent; border-radius: ${RADIUS}px; }
.alt .sk.fx { background-color: ${FILL}; }
.alt .sk.fx.rough { background: none; }
.alt .sk.fx.hatch { background-color: transparent; background-repeat: repeat; background-size: 192px 192px; background-clip: padding-box; }
.dark .alt .sk.fx { background-color: ${FILL_DARK}; }
.dark .alt .sk.fx.rough, .dark .alt .sk.fx.hatch { background-color: transparent; }`);
const theme = (sel, ink, brand, fill, hoverFill, hatchColour) => {
  const v = (name, list) => list.map((u, k) => `--${name}${k}: ${u};`).join(' ');
  a(`${sel} { ${v('a-b', SEEDS.map((sd) => nine({ seed: sd, stroke: ink })))} ${v('a-br', SEEDS.map((sd) => nine({ seed: sd, stroke: brand })))}
  ${v('a-rf', SEEDS.map((sd) => nine({ seed: sd, stroke: ink, fill })))} --a-h: ${tint(hatch.url, hatchColour)}; }`);
  // hover variants live in their own block so the page can re-mint them (see "첫 hover 다시 보기")
  return `${sel} { ${v('a-hv', SEEDS.map((sd) => nine({ seed: sd, stroke: brand })))} ${v('a-hrf', SEEDS.map((sd) => nine({ seed: sd, stroke: brand, fill: hoverFill })))} }`;
};
const hoverVars = [theme('.alt', INK, BRAND, FILL, HOVER_FILL, FILL), theme('.dark .alt', INK_DARK, BRAND_DARK, FILL_DARK, HOVER_FILL_DARK, FILL_DARK)];
a(`.alt .sk { border-image: var(--a-b0) ${C} / ${C}px / ${OUTSET}px stretch; }
.alt .sk.brand { border-image-source: var(--a-br0); }
.alt .sk.fx.rough { border-image: var(--a-rf0) ${C} fill / ${C}px / ${OUTSET}px stretch; }
.alt .sk.fx.hatch { background-image: var(--a-h); }
.alt .sk.hov:hover, .force-hover .alt .sk.hov { border-image-source: var(--a-hv0); background-color: ${HOVER_FILL}; }
.dark .alt .sk.hov:hover, .dark.force-hover .alt .sk.hov { background-color: ${HOVER_FILL_DARK}; }
.alt .sk.hov.rough:hover, .force-hover .alt .sk.hov.rough { border-image-source: var(--a-hrf0); background: none; }`);
for (const k of [1, 2]) {
  a(`.alt .sk:nth-child(3n+${k + 1}) { border-image-source: var(--a-b${k}); }
.alt .sk.brand:nth-child(3n+${k + 1}) { border-image-source: var(--a-br${k}); }
.alt .sk.fx.rough:nth-child(3n+${k + 1}) { border-image-source: var(--a-rf${k}); }
.alt .sk.hov:nth-child(3n+${k + 1}):hover, .force-hover .alt .sk.hov:nth-child(3n+${k + 1}) { border-image-source: var(--a-hv${k}); }
.alt .sk.hov.rough:nth-child(3n+${k + 1}):hover, .force-hover .alt .sk.hov.rough:nth-child(3n+${k + 1}) { border-image-source: var(--a-hrf${k}); }`);
}

const size = (css) => {
  const kb = (n) => (n / 1024).toFixed(1) + 'KB';
  const urls = (css.match(/data:image\/svg\+xml/g) || []).length;
  return { raw: kb(Buffer.byteLength(css)), gz: kb(zlib.gzipSync(css, { level: 9 }).length), br: kb(zlib.brotliCompressSync(css).length), urls };
};
const altAll = alt + hoverVars.join('\n');
const sCur = size(cur), sAlt = size(altAll);
console.log('current', sCur, 'A', sAlt);

const tpl = fs.readFileSync(new URL('./page.html', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./index.html', import.meta.url), tpl
  .replace('/*CUR*/', cur).replace('/*ALT*/', alt).replace('/*ALT_HOVER*/', hoverVars.join('\n'))
  .replace('<!--S_CUR-->', `SVG ${sCur.urls}개 · 원본 ${sCur.raw} · gzip ${sCur.gz} · brotli ${sCur.br}`)
  .replace('<!--S_ALT-->', `SVG ${sAlt.urls}개 · 원본 ${sAlt.raw} · gzip ${sAlt.gz} · brotli ${sAlt.br}`));

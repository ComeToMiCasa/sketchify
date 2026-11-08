// Builds the sketch UI showcase. Every SVG here is generated at build time;
// the page only switches classes, it never draws.
//
// Boxes: a Rough.js rectangle used as a 9-slice source (mask-border), corners fixed,
//        edges stretched only along their length. Colour comes from var(--stroke).
// Form controls, underlines: drawn on the element's own background (border-image /
//        background-image), so the colour is baked in, as the spec says.
import rough from 'roughjs';
import fs from 'node:fs';
import { blob, marker, penHatchTile, edgeStrip, exactHatch, geom, HATCH_OVER } from '../fills.mjs';

const INK = '#1d2433';
const LINK = '#2f55d4';
const L = 120; // length of the stretchable middle of each edge
const PRESETS = {
  subtle: { roughness: 0.6, bowing: 0.6, maxRandomnessOffset: 1.2 },
  normal: { roughness: 1.3, bowing: 1.2, maxRandomnessOffset: 2 },
  messy: { roughness: 2.4, bowing: 2.2, maxRandomnessOffset: 3 },
};
const WIDTHS = [1, 2, 4];
const RADII = [0, 12];
const SEEDS = [11, 23, 37];

const gen = rough.generator();
const r1 = (n) => Math.round(n * 10) / 10;
const tidy = (d) => d.replace(/-?\d*\.\d+/g, (n) => r1(+n));
const enc = (svg) => `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

/** Strokes use `color`; filled sub-paths are filled with it. */
function svg(w, h, drawables, color, sw, stretch = false) {
  const body = drawables
    .flatMap((d) => gen.toPaths(d))
    .map((p) =>
      p.fill && p.fill !== 'none' && (!p.stroke || p.stroke === 'none')
        ? `<path d='${tidy(p.d)}' fill='${color}' stroke='none'/>`
        : `<path d='${tidy(p.d)}'/>`,
    )
    .join('');
  return enc(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'${stretch ? " preserveAspectRatio='none'" : ''}><g fill='none' stroke='${color}' stroke-width='${r1(sw)}' stroke-linecap='round' stroke-linejoin='round'>${body}</g></svg>`,
  );
}

function roundedRect(x, y, w, h, r) {
  return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

/**
 * 9-slice source. Rounded corners get a slice just big enough for the curve, so small
 * elements don't shrink their corners; sharp corners keep room for the overshoot.
 */
function nineSlice({ W, radius, preset, seed, color = '#000' }) {
  const tight = radius > 0;
  const B = tight ? 4 : 6;
  const C = tight ? B + Math.max(radius, 4) : Math.max(B + 2, 14);
  const S = 2 * C + L;
  const opts = { stroke: color, strokeWidth: W, seed, ...preset };
  const x = B, w = S - 2 * B;
  const d = radius > 0 ? gen.path(roundedRect(x, x, w, w, radius), opts) : gen.rectangle(x, x, w, w, opts);
  return { url: svg(S, S, [d], color, W * 0.85), C, outset: B - W / 2 };
}

/** A horizontal stroke for one-sided borders and hr; stretched along its length only. */
// The two ends (C px each) stay fixed and only the middle stretches, so the line keeps
// its exact inset at any width instead of the inset growing with the element.
function strip({ W, preset, seed, color = '#000' }) {
  const H = W + 10, C = 16, M = 3, len = 2 * C + L;
  const d = gen.line(M, H / 2, len - M, H / 2, { stroke: color, strokeWidth: W, seed, ...preset, bowing: preset.bowing * 1.5 });
  return { url: svg(len, H, [d], color, W * 0.85), H, C, M };
}

function checkbox({ W, preset, seed }) {
  const m = W / 2 + 1.5;
  const box = gen.rectangle(m, m, 18 - 2 * m, 18 - 2 * m, { stroke: INK, strokeWidth: W, seed, ...preset, maxRandomnessOffset: Math.min(preset.maxRandomnessOffset, 1.5) });
  const tick = gen.linearPath([[4.2, 9.2], [7.8, 13], [14.2, 4.2]], { stroke: INK, strokeWidth: 2, seed: seed + 1, ...preset, roughness: preset.roughness * 0.7 });
  return { box: svg(18, 18, [box], INK, W * 0.85), tick: svg(18, 18, [tick], INK, 2) };
}

function radio({ W, preset, seed }) {
  const ring = gen.circle(9, 9, 18 - W - 3, { stroke: INK, strokeWidth: W, seed, ...preset, maxRandomnessOffset: Math.min(preset.maxRandomnessOffset, 1.5) });
  const dot = gen.circle(9, 9, 7, { stroke: 'none', fill: INK, fillStyle: 'solid', seed: seed + 1, ...preset, roughness: preset.roughness * 0.6 });
  return { ring: svg(18, 18, [ring], INK, W * 0.85), dot: svg(18, 18, [dot], INK, 1) };
}

function avatar({ W, preset, seed }) {
  // 44px element, drawn on a 52px overlay so the wobble has room.
  const d = gen.ellipse(26, 26, 44 - W, 44 - W, { stroke: '#000', strokeWidth: W, seed, ...preset });
  return svg(52, 52, [d], '#000', W * 0.85);
}

function underline({ preset, seed }) {
  const d = gen.line(0, 4, 200, 4, { stroke: LINK, strokeWidth: 1.6, seed, ...preset, bowing: preset.bowing * 2 });
  return svg(200, 8, [d], LINK, 1.5, true);
}

function chevron({ preset, seed }) {
  const d = gen.linearPath([[3, 5], [8, 10.5], [13, 5]], { stroke: INK, strokeWidth: 1.8, seed, ...preset, roughness: preset.roughness * 0.6 });
  return svg(16, 14, [d], INK, 1.8);
}

let css = '';
const add = (s) => (css += s + '\n');

for (const [pname, preset] of Object.entries(PRESETS)) {
  const P = `.p-${pname}`;
  add(`${P} .sk-link { background-image: ${underline({ preset, seed: 5 })}; }`);
  add(`${P} select.field { background-image: ${chevron({ preset, seed: 9 })}; }`);

  for (const W of WIDTHS) {
    const PW = `${P}.w${W}`;
    // Each scope puts its three drawings per kind in custom properties on .demo, once.
    // Which of the three an element uses is decided by the mixing rules further down.
    for (const radius of RADII) {
      const PWR = `${PW}.r${radius}`;
      const boxes = SEEDS.map((seed) => nineSlice({ W, radius, preset, seed }));
      const fields = [41, 53, 67].map((seed) => nineSlice({ W, radius, preset, seed, color: INK }));
      add(`${PWR} { ${boxes.map((b, k) => `--sk-b${k}: ${b.url};`).join(' ')} ${fields.map((f, k) => `--sk-f${k}: ${f.url};`).join(' ')} }`);
      const { C, outset } = boxes[0];
      add(`${PWR} .sk::before { inset: -${W + outset}px; -webkit-mask-box-image: var(--sk-bs) ${C} / ${C}px stretch; mask-border: var(--sk-bs) ${C} / ${C}px stretch; }`);
      // Form fields can't host ::before, so they get the drawing as border-image with a baked colour.
      add(`${PWR} .field { border-image: var(--sk-fs) ${fields[0].C} / ${fields[0].C}px / ${fields[0].outset}px stretch; }`);
    }
    // One-sided borders: hr, list dividers, nav underline.
    const [s1, s2, s3] = SEEDS.map((seed) => strip({ W, preset, seed }));
    // The pseudo-element sticks out by the end margin so the visible line reaches the edges.
    add(`${PW} .sk-line::before { height: ${s1.H}px; left: -${s1.M}px; right: -${s1.M}px; -webkit-mask-box-image: ${s1.url} 0 ${s1.C} fill / 0 ${s1.C}px stretch; mask-border: ${s1.url} 0 ${s1.C} fill / 0 ${s1.C}px stretch; }`);
    add(`${PW} .sk-line:nth-child(3n+2)::before { -webkit-mask-box-image-source: ${s2.url}; mask-border-source: ${s2.url}; }`);
    add(`${PW} .sk-line:nth-child(3n+3)::before { -webkit-mask-box-image-source: ${s3.url}; mask-border-source: ${s3.url}; }`);
    add(`${PW} hr.sk-line::before { top: -${W / 2 + s1.H / 2}px; }`);
    add(`${PW} .sk-line:not(hr)::before { bottom: -${W / 2 + s1.H / 2}px; }`);
    // Checkboxes, radios and avatars: three drawings each, as custom properties.
    const cbs = [13, 29, 47].map((seed) => checkbox({ W, preset, seed }));
    const rds = [13, 29, 47].map((seed) => radio({ W, preset, seed }));
    const avs = [17, 31, 59].map((seed) => avatar({ W, preset, seed }));
    add(`${PW} { ${[0, 1, 2].map((k) => `--sk-cb${k}: ${cbs[k].box}; --sk-ck${k}: ${cbs[k].tick}; --sk-rg${k}: ${rds[k].ring}; --sk-dt${k}: ${rds[k].dot}; --sk-av${k}: ${avs[k]};`).join(' ')} }`);
  }
}

// Which drawing an element uses: (own position + parent's + grandparent's) mod 3. Neighbours
// differ, and so do look-alikes in different places (each card's avatar, each form row's input).
// All of it at zero specificity, so anything the page itself sets still wins.
add(`:where(.sk)::before { --sk-bs: var(--sk-b0); }
:where(.field) { --sk-fs: var(--sk-f0); }
:where(.avatar)::before { --sk-avs: var(--sk-av0); }
:where(.check > input) { --sk-cbs: var(--sk-cb0); --sk-cks: var(--sk-ck0); --sk-rgs: var(--sk-rg0); --sk-dts: var(--sk-dt0); }`);
const MIX = [
  ['.sk', '::before', (k) => `--sk-bs: var(--sk-b${k});`],
  ['.field', '', (k) => `--sk-fs: var(--sk-f${k});`],
  ['.avatar', '::before', (k) => `--sk-avs: var(--sk-av${k});`],
  ['.check > input', '', (k) => `--sk-cbs: var(--sk-cb${k}); --sk-cks: var(--sk-ck${k}); --sk-rgs: var(--sk-rg${k}); --sk-dts: var(--sk-dt${k});`],
];
for (const [target, pseudo, assign] of MIX) {
  const last = target.split(' ').pop();
  const lead = target.includes(' ') ? target.slice(0, target.lastIndexOf(' ') + 1) : '';
  for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 3; c++) {
    const k = (a + b + c) % 3;
    if (k === 0) continue;
    // `.check > input` already names the parent, so it counts from the label upwards.
    const chain = lead
      ? `:nth-child(3n+${a}) > ${lead.replace(/\s*>\s*$/, '')}:nth-child(3n+${b}) > ${last}:nth-child(3n+${c})`
      : `:nth-child(3n+${a}) > :nth-child(3n+${b}) > ${last}:nth-child(3n+${c})`;
    add(`:where(${chain})${pseudo} { ${assign(k)} }`);
  }
}
add(`.check input[type=checkbox] { background-image: var(--sk-cbs); }
.check input[type=checkbox]:checked { background-image: var(--sk-cks), var(--sk-cbs); }
.check input[type=radio] { background-image: var(--sk-rgs); }
.check input[type=radio]:checked { background-image: var(--sk-dts), var(--sk-rgs); }
.avatar::before { -webkit-mask: var(--sk-avs) 0 0 / 100% 100% no-repeat; mask: var(--sk-avs) 0 0 / 100% 100% no-repeat; }`);

for (const W of WIDTHS) {
  add(`.w${W} .sk, .w${W} .field, .w${W} .avatar { border-width: ${W}px; }`);
  add(`.w${W} hr.sk-line { border-top-width: ${W}px; } .w${W} .sk-line:not(hr) { border-bottom-width: ${W}px; }`);
  add(`.w${W} .avatar::before { inset: -${W + 4}px; }`);
}
for (const radius of RADII) add(`.r${radius} .sk, .r${radius} .field { border-radius: ${radius}px; }`);
add(`.sk:nth-child(4n+2)::before { transform: scaleX(-1); }
.sk:nth-child(4n+3)::before { transform: scaleY(-1); }
.sk:nth-child(4n+4)::before { transform: scale(-1, -1); }`);

// ---------- Fills (decided on the fill comparison page) ----------
// Elements with .fx get a fill on ::after; the fill style is picked by a class on .demo.
for (const Wd of WIDTHS) add(`.w${Wd} { --bw: ${Wd}px; }`);
add(`.fx { position: relative; isolation: isolate; }
.fx:not(.sk) { --bw: 0px; }
.fx::after { content: ""; position: absolute; z-index: -2; pointer-events: none; inset: calc(-1 * var(--bw)); background: var(--fill); border-radius: inherit; }
.fill-none .fx::after { display: none; }`);

const FSEEDS = [111, 223, 337];
// Rough solid: a ragged blob as a 9-slice
for (const radius of RADII) {
  const blobs = FSEEDS.map((sd) => blob(radius, sd));
  const { outset } = geom(radius);
  add(`.fill-rough.r${radius} .fx::after { inset: calc(-1 * (var(--bw) + ${outset}px)); border-radius: 0; -webkit-mask-box-image: ${blobs[0].url} ${blobs[0].C} fill / ${blobs[0].C}px stretch; mask-border: ${blobs[0].url} ${blobs[0].C} fill / ${blobs[0].C}px stretch; }`);
  add(`.fill-rough.r${radius} .fx:nth-child(3n+2)::after { -webkit-mask-box-image-source: ${blobs[1].url}; mask-border-source: ${blobs[1].url}; }`);
  add(`.fill-rough.r${radius} .fx:nth-child(3n+3)::after { -webkit-mask-box-image-source: ${blobs[2].url}; mask-border-source: ${blobs[2].url}; }`);
}

// Marker swipe
{
  const marks = FSEEDS.map((sd) => marker(sd * 7));
  add(`.fill-marker .fx::after { inset: calc(-1 * var(--bw) - 2px) -6px; opacity: 0.55; border-radius: 0; -webkit-mask-box-image: ${marks[0].url} ${marks[0].C} fill / ${marks[0].C}px stretch; mask-border: ${marks[0].url} ${marks[0].C} fill / ${marks[0].C}px stretch; }`);
  add(`.fill-marker .fx:nth-child(3n+2)::after { -webkit-mask-box-image-source: ${marks[1].url}; mask-border-source: ${marks[1].url}; }`);
  add(`.fill-marker .fx:nth-child(3n+3)::after { -webkit-mask-box-image-source: ${marks[2].url}; mask-border-source: ${marks[2].url}; }`);
}

// Hatch, unknown size: seamless pen-stroke tile cut by ragged strips that stay inside the outline
{
  const tile = penHatchTile({ seed: 7 });
  const H = 2 + 3;
  FSEEDS.forEach((sd, i) => {
    const strips = ['top', 'bottom', 'left', 'right'].map((side, k) => edgeStrip({ seed: sd * 13 + k * 101, side, H, minDepth: 0.3, maxDepth: 2, blur: 0 }));
    const shift = ['0px', '61px', '127px'][i];
    const img = ['var(--sk-hatch)', ...strips, 'linear-gradient(#000, #000)'].join(', ');
    const pos = [`${shift} ${shift}`, `${shift} 0`, `${shift} 100%`, `0 ${shift}`, `100% ${shift}`, `${H}px ${H}px`].join(', ');
    const size = [`${tile.T}px ${tile.T}px`, `192px ${H}px`, `192px ${H}px`, `${H}px 192px`, `${H}px 192px`, `calc(100% - ${2 * H}px) calc(100% - ${2 * H}px)`].join(', ');
    const rep = ['repeat', 'repeat-x', 'repeat-x', 'repeat-y', 'repeat-y', 'no-repeat'].join(', ');
    const comp = ['intersect', 'add', 'add', 'add', 'add', 'add'].join(', ');
    const wcomp = ['source-in', 'source-over', 'source-over', 'source-over', 'source-over', 'source-over'].join(', ');
    const sel = i === 0 ? '.fill-hatch .fx::after' : `.fill-hatch .fx:nth-child(3n+${i + 1})::after`;
    add(`${sel} { ${i === 0 ? `--sk-hatch: ${tile.url}; inset: calc(-1 * var(--bw)); border-radius: 0; ` : ''}-webkit-mask-image: ${img}; mask-image: ${img}; -webkit-mask-position: ${pos}; mask-position: ${pos}; -webkit-mask-size: ${size}; mask-size: ${size}; -webkit-mask-repeat: ${rep}; mask-repeat: ${rep}; -webkit-mask-composite: ${wcomp}; mask-composite: ${comp}; }`);
  });
}

// Hatch, known size (px width/height in the CSS): strokes computed end to end, like Rough.js
{
  const KNOWN = { prog: [186, 10], c1: [36, 44], c2: [36, 80], c3: [36, 60], c4: [36, 96], c5: [36, 70] };
  for (const ends of ['taper', 'square']) {
    Object.entries(KNOWN).forEach(([id, [w, h]], i) => {
      const url = exactHatch({ w, h, seed: 900 + i * 37, ends });
      add(`.fill-hatch.ends-${ends} .fx[data-x="${id}"]::after { --sk-hx: ${url}; inset: calc(-1 * var(--bw) - ${HATCH_OVER}px); -webkit-mask-image: var(--sk-hx); mask-image: var(--sk-hx); -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-position: 0 0; mask-position: 0 0; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-composite: source-over; mask-composite: add; }`);
    });
  }
}

const tpl = fs.readFileSync(new URL('./page.html', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./index.html', import.meta.url), tpl.replace('/*GENERATED*/', css));
console.log('ok', (Buffer.byteLength(css) / 1024).toFixed(1) + 'KB of generated CSS');

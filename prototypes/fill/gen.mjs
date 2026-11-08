// Fill comparison page. Outlines use the confirmed method (Rough.js 9-slice, mask-border);
// each row swaps only the fill. All SVGs are generated here, at build time.
import rough from 'roughjs';
import fs from 'node:fs';

const W = 2;
const L = 120;
const PRESET = { roughness: 1.3, bowing: 1.2, maxRandomnessOffset: 2 };
const SEEDS = [11, 23, 37];
const gen = rough.generator();
const r1 = (n) => Math.round(n * 10) / 10;
const tidy = (d) => d.replace(/-?\d*\.\d+/g, (n) => r1(+n));
const enc = (s) => `url("data:image/svg+xml,${s.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

function svg(w, h, drawables, { sw = 1, extra = '' } = {}) {
  const body = drawables
    .flatMap((d) => gen.toPaths(d))
    .map((p) => (p.fill && p.fill !== 'none' && (!p.stroke || p.stroke === 'none') ? `<path d='${tidy(p.d)}' fill='#000' stroke='none'/>` : `<path d='${tidy(p.d)}'/>`))
    .join('');
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><g fill='none' stroke='#000' stroke-width='${sw}' stroke-linecap='round' stroke-linejoin='round'>${body}${extra}</g></svg>`);
}
const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

function geom(radius) {
  const tight = radius > 0;
  const B = tight ? 4 : 6;
  const C = tight ? B + Math.max(radius, 4) : Math.max(B + 2, 14);
  return { B, C, S: 2 * C + L, outset: B - W / 2 };
}

/** Outline: the confirmed 9-slice stroke. */
function outline(radius, seed) {
  const { B, C, S, outset } = geom(radius);
  const o = { stroke: '#000', strokeWidth: W, seed, ...PRESET };
  const w = S - 2 * B;
  const d = radius > 0 ? gen.path(rr(B, B, w, w, radius), o) : gen.rectangle(B, B, w, w, o);
  return { url: svg(S, S, [d], { sw: W * 0.85 }), C, outset };
}

/** 3: a solid blob with ragged edges, as a 9-slice with `fill`. */
function blob(radius, seed) {
  const { B, C, S, outset } = geom(radius);
  const o = { stroke: 'none', fill: '#000', fillStyle: 'solid', seed, ...PRESET, roughness: 1.6 };
  const m = B + 1.5, w = S - 2 * m;
  const d = radius > 0 ? gen.path(rr(m, m, w, w, Math.max(radius - 1, 1)), o) : gen.rectangle(m, m, w, w, o);
  return { url: svg(S, S, [d]), C, outset };
}

/** Same drawing as hatchEdge, cut into nine mask-image layers (a hand-rolled 9-slice). */
function hatchEdgeLayers(radius, seed) {
  const { B, C, S, outset } = geom(radius);
  const o = { stroke: 'none', fill: '#000', fillStyle: 'solid', seed, roughness: 2.6, bowing: 1.5, maxRandomnessOffset: 3 };
  const m = B + 3.5, w = S - 2 * m;
  const d = radius > 0 ? gen.path(rr(m, m, w, w, Math.max(radius - 2, 1)), o) : gen.rectangle(m, m, w, w, o);
  const body = gen.toPaths(d).map((p) => `<path d='${tidy(p.d)}' fill='#000'/>`).join('');
  const piece = (x, y, pw, ph, stretch) =>
    enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${pw}' height='${ph}' viewBox='${x} ${y} ${pw} ${ph}'${stretch ? " preserveAspectRatio='none'" : ''}>${body}</svg>`);
  const mid = `calc(100% - ${2 * C}px)`;
  const layers = [
    [piece(0, 0, C, C), `0 0`, `${C}px ${C}px`],
    [piece(S - C, 0, C, C), `100% 0`, `${C}px ${C}px`],
    [piece(0, S - C, C, C), `0 100%`, `${C}px ${C}px`],
    [piece(S - C, S - C, C, C), `100% 100%`, `${C}px ${C}px`],
    [piece(C, 0, L, C, true), `${C}px 0`, `${mid} ${C}px`],
    [piece(C, S - C, L, C, true), `${C}px 100%`, `${mid} ${C}px`],
    [piece(0, C, C, L, true), `0 ${C}px`, `${C}px ${mid}`],
    [piece(S - C, C, C, L, true), `100% ${C}px`, `${C}px ${mid}`],
    ['linear-gradient(#000, #000)', `${C}px ${C}px`, `${mid} ${mid}`],
  ];
  return { layers, outset };
}

/** Ragged outer edge for hatching: hatch strokes stop short of the outline, unevenly. */
function hatchEdge(radius, seed) {
  const { B, C, S, outset } = geom(radius);
  const o = { stroke: 'none', fill: '#000', fillStyle: 'solid', seed, roughness: 2.6, bowing: 1.5, maxRandomnessOffset: 3 };
  const m = B + 3.5, w = S - 2 * m;
  const d = radius > 0 ? gen.path(rr(m, m, w, w, Math.max(radius - 2, 1)), o) : gen.rectangle(m, m, w, w, o);
  return { url: svg(S, S, [d]), C, outset };
}

/** 7: a marker swipe: ragged ends, slightly wavy long edges. */
function marker(seed) {
  const C = 18, S = 2 * C + L;
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const top = 5, bot = S - 5;
  const left = [], right = [];
  for (let y = top; y <= bot; y += 9) {
    left.push([3 + rand() * 7, y]);
    right.push([S - 3 - rand() * 7, y]);
  }
  // Clockwise from the top-left: down the jagged left end, along the bottom, up the right end, back along the top.
  const poly = [...left, [C, bot - rand() * 2], [S - C, bot - rand() * 2], ...right.reverse(), [S - C, top + rand() * 2], [C, top + rand() * 2]];
  const d = gen.polygon(poly, { stroke: 'none', fill: '#000', fillStyle: 'solid', roughness: 0.8, seed });
  return { url: svg(S, S, [d]), C };
}

/**
 * Hatch tiles that repeat seamlessly. Each diagonal is a polyline whose wobble and
 * gaps are periodic in the tile size, so a stroke leaving one tile continues exactly
 * in the next; the breaks fall at random spots instead of along the tile grid.
 */
function hatchTile({ T = 96, gap = 8, cross = false, seed }) {
  const hash = (n) => {
    let h = (n * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const paths = [];
  const dirs = cross ? [-1, 1] : [-1];
  for (const dir of dirs) {
    // y = c - x needs c in [0, 2T]; y = x - c needs c in [-T, T].
    const [c0, c1] = dir < 0 ? [-2 * gap, 2 * T + 2 * gap] : [-T - 2 * gap, T + 2 * gap];
    for (let c = c0; c <= c1; c += gap) {
      const key = ((c % T) + T) % T + (dir > 0 ? 1000 : 0);
      const a1 = 0.5 + hash(key) * 0.6, a2 = 0.2 + hash(key + 7) * 0.4;
      const p1 = hash(key + 13) * 6.283, p2 = hash(key + 29) * 6.283;
      const g1 = hash(key + 41) * T, g2 = (g1 + T / 2 + (hash(key + 53) - 0.5) * T * 0.4) % T;
      const gl = 3 + hash(key + 67) * 4;
      const inGap = (s) => {
        const m = ((s % T) + T) % T;
        return (m > g1 && m < g1 + gl) || (m > g2 && m < g2 + gl);
      };
      let d = '', pen = false;
      for (let x = -4; x <= T + 4; x += 2) {
        const y = dir < 0 ? c - x : x - c;
        if (y < -4 || y > T + 4) { pen = false; continue; }
        const s = dir < 0 ? x - y : x + y;
        const off = a1 * Math.sin((2 * Math.PI * s) / T + p1) + a2 * Math.sin((4 * Math.PI * s) / T + p2);
        const px = r1(x + (dir < 0 ? off : -off) / Math.SQRT2), py = r1(y + off / Math.SQRT2);
        d += `${pen ? 'L' : 'M'}${px} ${py}`;
        pen = true;
      }
      if (d) paths.push(`<path d='${d}'/>`);
    }
  }
  return { url: enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${T}' height='${T}' viewBox='0 0 ${T} ${T}'><g fill='none' stroke='#000' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'>${paths.join('')}</g></svg>`), T };
}

/**
 * Hatch strokes drawn the way a pen lays them down: nearly straight, one long gentle bow,
 * a per-stroke base width, and pressure that swells and thins along the stroke. Each stroke
 * is a filled ribbon so its width can change. Every variation is periodic in the tile size,
 * so strokes still continue exactly across tile seams.
 */
// gap must divide T, or the strokes would not line up across tile seams
// A bigger tile lets pressure (and bow) change over a longer stretch while staying seamless.
function penHatchTile({ T = 192, gap = 6, seed }) {
  const hash = (n) => {
    let h = (n * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const TAU = 2 * Math.PI;
  const ribbons = [];
  // Per-stroke parameters depend only on c mod T, so the pattern repeats exactly every tile.
  const params = (c) => {
    const key = ((c % T) + T) % T;
    return {
      key,
      bow: (0.25 + hash(key) * 0.55) * (hash(key + 3) < 0.5 ? -1 : 1),   // one long bend
      bowPhase: hash(key + 5) * TAU,
      base: 1.65 + hash(key + 11) * 0.5,                                 // stroke weight
      press: 0.1 + hash(key + 17) * 0.12,                                // how much pressure varies
      pressPhase: hash(key + 19) * TAU,
    };
  };
  // Where stroke c's centre sits (offset along the normal) at position s along it.
  const offAt = (c, sAlong) => { const p = params(c); return p.bow * Math.sin((TAU * sAlong) / T + p.bowPhase); };
  for (let c = -2 * gap; c <= 2 * T + 2 * gap; c += gap) {
    const { bow, bowPhase, base, press, pressPhase } = params(c);
    const pressK = 1;
    const left = [], right = [];
    for (let x = -6; x <= T + 6; x += 6) {
      const y = c - x;
      if (y < -6 || y > T + 6) continue;
      const sAlong = x - y;
      // period T along the stroke keeps it seamless across tiles
      const off = bow * Math.sin((TAU * sAlong) / T + bowPhase);
      const w = base * (1 + press * Math.sin((TAU * pressK * sAlong) / T + pressPhase));
      // centre line nudged along the normal (1,1)/√2, ribbon edges ±w/2 along the same normal
      const cx = x + off / Math.SQRT2, cy = y + off / Math.SQRT2, h = w / 2 / Math.SQRT2;
      left.push(`${r1(cx + h)} ${r1(cy + h)}`);
      right.push(`${r1(cx - h)} ${r1(cy - h)}`);
    }
    if (left.length > 1) ribbons.push(`<path d='M${left.join('L')}L${right.reverse().join('L')}Z'/>`);
  }
  return { url: enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${T}' height='${T}' viewBox='0 0 ${T} ${T}'><g fill='#000' stroke='none'>${ribbons.join('')}</g></svg>`), T, gap, offAt, hash };
}

/**
 * End strips whose shape is aligned to the hatch strokes: one tapered wedge per stroke,
 * cut perpendicular to the stroke at a random depth. Only valid where the strokes' positions
 * along that edge are known (the strip and the tile share an origin on that edge).
 *
 * side: which box edge. Tile coordinates: strokes are y = c - x, s = x - y.
 *   top:    stroke c meets the edge (y = 0) near x = c, runs inward towards (-1, 1)
 *   left:   meets x = 0 near y = c, inward ( 1,-1)
 *   bottom: edge is the tile's bottom (y = T), meets near x = c - T, inward ( 1,-1)
 *   right:  edge is the tile's right (x = T), meets near y = c - T, inward (-1, 1)
 */
function alignedEndStrip(model, { side, Hb, maxEnd, taper = 3.2, seed }) {
  const { T, gap, offAt, hash } = model;
  const S2 = Math.SQRT2;
  const n = [1 / S2, 1 / S2];                       // normal shared by all strokes
  const horizontal = side === 'top' || side === 'bottom';
  const [w, h] = horizontal ? [T, Hb] : [Hb, T];
  const polys = [];
  for (let c = -T - 2 * gap; c <= 2 * T + 2 * gap; c += gap) {
    const e = 0.2 + hash(((c % T) + T) % T + seed) * (maxEnd - 0.2); // depth of the stroke's end from the edge
    let x, y, u;
    if (side === 'top') { y = e; x = c - y; u = [-1 / S2, 1 / S2]; }
    if (side === 'left') { x = e; y = c - x; u = [1 / S2, -1 / S2]; }
    if (side === 'bottom') { const yt = T - e; x = c - yt; y = Hb - e; u = [1 / S2, -1 / S2]; }
    if (side === 'right') { const xt = T - e; y = c - xt; x = Hb - e; u = [-1 / S2, 1 / S2]; }
    // follow the stroke's bow so the tip sits on the actual centre line
    const tx = side === 'bottom' ? x : side === 'right' ? T - e : x;
    const ty = side === 'bottom' ? T - e : side === 'right' ? y : y;
    const off = offAt(c, tx - ty);
    const px = x + off * n[0], py = y + off * n[1];
    const far = (Hb + 4) * S2;
    const at = (t, k) => `${r1(px + u[0] * t + n[0] * k)} ${r1(py + u[1] * t + n[1] * k)}`;
    // tip (perpendicular cut, nearly a point) → widening over `taper` → full width to the far side
    polys.push(`M${at(0, 0.3)}L${at(taper, 2.3)}L${at(far, 2.3)}L${at(far, -2.3)}L${at(taper, -2.3)}L${at(0, -0.3)}Z`);
  }
  // Wedges run past the strip's inner side, so it joins the solid centre with no seam.
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='${polys.join('')}' fill='#000'/></svg>`);
}

/**
 * Ragged edge strips for hatching. Each is a short band whose inner side is solid and whose
 * outer boundary wanders, repeated along one side of the box. Unioned with a solid centre and
 * intersected with the hatch tile, strokes end at uneven depths, some past the outline.
 */
function edgeStrip({ len = 192, H = 12, minDepth = 1, maxDepth = H - 2, blur = 0.9, seed, side }) {
  let st = seed;
  const rand = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const TAU = 2 * Math.PI;
  const waves = [5, 9, 13, 21].map((k) => [k, rand() * TAU, (0.6 + rand() * 0.6) / Math.sqrt(k / 5)]);
  const norm = waves.reduce((a, w) => a + w[2], 0);
  // depth: 0 = outer edge of the band, H = inner edge; periodic in len so the strip tiles seamlessly
  const depth = (t) => {
    const v = waves.reduce((a, [k, p, a1]) => a + a1 * Math.sin((TAU * k * t) / len + p), 0) / norm;
    return r1(minDepth + (v * 0.5 + 0.5) * (maxDepth - minDepth));
  };
  // The shape runs past the strip's ends and inner side, so the blur below only softens the
  // outer boundary: no soft seam where strips repeat or where they meet the solid centre.
  const pts = [];
  for (let t = -12; t <= len + 12; t += 3) pts.push([t, depth(((t % len) + len) % len)]);
  const E = H + 6, a = -12, z = len + 12;
  let d;
  if (side === 'top') d = `M${a} ${E}` + pts.map(([t, b]) => `L${t} ${b}`).join('') + `L${z} ${E}Z`;
  if (side === 'bottom') d = `M${a} ${H - E}` + pts.map(([t, b]) => `L${t} ${r1(H - b)}`).join('') + `L${z} ${H - E}Z`;
  if (side === 'left') d = `M${E} ${a}` + pts.map(([t, b]) => `L${b} ${t}`).join('') + `L${E} ${z}Z`;
  if (side === 'right') d = `M${H - E} ${a}` + pts.map(([t, b]) => `L${r1(H - b)} ${t}`).join('') + `L${H - E} ${z}Z`;
  const [w, h] = side === 'top' || side === 'bottom' ? [len, H] : [H, len];
  // A slight blur makes each stroke thin out and fade where it ends, like a pen lifting off.
  const filter = blur > 0 ? `<filter id='f' x='-1' y='-1' width='3' height='3'><feGaussianBlur stdDeviation='${blur}'/></filter>` : '';
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>${filter}<path d='${d}' fill='#000'${blur > 0 ? " filter='url(%23f)'" : ''}/></svg>`);
}

function dotTile({ T = 96, step = 8, seed }) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let dots = '';
  for (let y = step / 2; y < T; y += step) for (let x = step / 2; x < T; x += step) {
    const cx = r1(x + (rand() - 0.5) * 4), cy = r1(y + (rand() - 0.5) * 4), r = r1(0.9 + rand() * 0.7);
    if (cx > 1.5 && cy > 1.5 && cx < T - 1.5 && cy < T - 1.5) dots += `<circle cx='${cx}' cy='${cy}' r='${r}' fill='#000' stroke='none'/>`;
  }
  return { url: svg(T, T, [], { extra: dots }), T };
}

let css = '';
const add = (s) => (css += s + '\n');

for (const radius of [0, 12]) {
  const R = `.r${radius}`;
  const outs = SEEDS.map((sd) => outline(radius, sd));
  const { outset } = outs[0];
  add(`${R} .sk::before { inset: -${W + outset}px; -webkit-mask-box-image: ${outs[0].url} ${outs[0].C} / ${outs[0].C}px stretch; mask-border: ${outs[0].url} ${outs[0].C} / ${outs[0].C}px stretch; }`);
  add(`${R} .sk:nth-child(3n+2)::before { -webkit-mask-box-image-source: ${outs[1].url}; mask-border-source: ${outs[1].url}; }`);
  add(`${R} .sk:nth-child(3n+3)::before { -webkit-mask-box-image-source: ${outs[2].url}; mask-border-source: ${outs[2].url}; }`);
  add(`${R} .sk, ${R} .fx { border-radius: ${radius}px; }`);

  const blobs = SEEDS.map((sd) => blob(radius, sd + 100));
  add(`${R} .m3 .fx::after { inset: calc(-1 * (var(--bw) + ${outset}px)); border-radius: 0; -webkit-mask-box-image: ${blobs[0].url} ${blobs[0].C} fill / ${blobs[0].C}px stretch; mask-border: ${blobs[0].url} ${blobs[0].C} fill / ${blobs[0].C}px stretch; }`);
  add(`${R} .m3 .fx:nth-child(3n+2)::after { -webkit-mask-box-image-source: ${blobs[1].url}; mask-border-source: ${blobs[1].url}; }`);
  add(`${R} .m3 .fx:nth-child(3n+3)::after { -webkit-mask-box-image-source: ${blobs[2].url}; mask-border-source: ${blobs[2].url}; }`);

}

// 2: offset solid, a different nudge for neighbours
add(`.m2 .fx::after { inset: calc(-1 * var(--bw) + 2px); transform: translate(4px, 4px); }
.m2 .fx:nth-child(3n+2)::after { transform: translate(-4px, 3px); }
.m2 .fx:nth-child(3n+3)::after { transform: translate(3px, -4px); }`);

// 4: hatch = pen-stroke tile ∩ (ragged strips on four sides ∪ solid centre).
// Used where the element's size is unknown. Strokes stay inside the outline: each ends
// somewhere within the outline's own thickness, so it reaches the line but never passes it.
{
  const tile = penHatchTile({ seed: 7 });
  const OVER = 0, H = W + 3;
  SEEDS.forEach((sd, i) => {
    const strips = ['top', 'bottom', 'left', 'right'].map((side, k) => edgeStrip({ seed: sd * 13 + k * 101, side, H, minDepth: 0.3, maxDepth: W, blur: 0 }));
    const shift = ['0px', '61px', '127px'][i];
    // The big tile lives once in a custom property; every variant reuses it.
    const img = ['var(--sk-hatch)', ...strips, 'linear-gradient(#000, #000)'].join(', ');
    const pos = [`${shift} ${shift}`, `${shift} 0`, `${shift} 100%`, `0 ${shift}`, `100% ${shift}`, `${H}px ${H}px`].join(', ');
    const size = [`${tile.T}px ${tile.T}px`, `192px ${H}px`, `192px ${H}px`, `${H}px 192px`, `${H}px 192px`, `calc(100% - ${2 * H}px) calc(100% - ${2 * H}px)`].join(', ');
    const rep = ['repeat', 'repeat-x', 'repeat-x', 'repeat-y', 'repeat-y', 'no-repeat'].join(', ');
    const comp = ['intersect', 'add', 'add', 'add', 'add', 'add'].join(', ');
    const wcomp = ['source-in', 'source-over', 'source-over', 'source-over', 'source-over', 'source-over'].join(', ');
    const sel = i === 0 ? '.m4 .fx::after' : `.m4 .fx:nth-child(3n+${i + 1})::after`;
    add(`${sel} { ${i === 0 ? `--sk-hatch: ${tile.url}; inset: calc(-1 * var(--bw) - ${OVER}px); border-radius: 0; ` : ''}-webkit-mask-image: ${img}; mask-image: ${img}; -webkit-mask-position: ${pos}; mask-position: ${pos}; -webkit-mask-size: ${size}; mask-size: ${size}; -webkit-mask-repeat: ${rep}; mask-repeat: ${rep}; -webkit-mask-composite: ${wcomp}; mask-composite: ${comp}; }`);
  });
}

// 4 (known size): Rough.js-style hachure. Each stroke runs between where its line meets the
// box, with each end nudged to land between the outline's middle and 2px outside it. The stroke
// is a ribbon: perpendicular ends that taper over ~2.5px, slow pressure, one gentle bow.
// How far strokes may run past the outside of the box.
const HATCH_OVER = 4;
function exactHatch({ w, h, seed, gap = 6, OVER = HATCH_OVER, Wb = W, ends = 'taper' }) {
  let st = seed;
  const rand = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const S2 = Math.SQRT2, TAU = 2 * Math.PI;
  const d = [1 / S2, -1 / S2], n = [1 / S2, 1 / S2];
  const ribbons = [];
  for (let c = rand() * gap; c < w + h; c += gap) {
    const x1 = Math.max(0, c - h), x2 = Math.min(w, c);
    if (x2 - x1 < 1.5) continue;
    const e1 = -OVER + rand() * (OVER + Wb / 2), e2 = -OVER + rand() * (OVER + Wb / 2);
    const p1 = [x1 + d[0] * e1 * S2, c - x1 + d[1] * e1 * S2];
    const p2 = [x2 - d[0] * e2 * S2, c - x2 - d[1] * e2 * S2];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (L < 3) continue;
    const base = 1.65 + rand() * 0.5, press = 0.1 + rand() * 0.12, phase = rand() * TAU, lambda = 120 + rand() * 40;
    const bow = (0.25 + rand() * 0.55) * (rand() < 0.5 ? -1 : 1) * Math.min(1, L / 60);
    const left = [], right = [];
    // Dense samples only where the end tapers; the middle is nearly straight.
    const ts = [0, 0.8, 1.6, 2.5];
    for (let t = 8; t < L - 2.5; t += 8) ts.push(t);
    ts.push(L - 2.5, L - 1.6, L - 0.8, L);
    for (const t of ts.filter((v, i, a) => v >= 0 && v <= L && (i === 0 || v > a[i - 1]))) {
      const off = bow * Math.sin((Math.PI * t) / L);
      // 'taper': thins to a point over ~2.5px. 'square': full width to a flat, perpendicular end.
      const taper = ends === 'square' ? 1 : Math.min(1, 0.3 + 0.7 * Math.min(t, L - t) / 2.5);
      const hw = (base * (1 + press * Math.sin((TAU * t) / lambda + phase)) * taper) / 2;
      const cx = OVER + p1[0] + d[0] * t + n[0] * off, cy = OVER + p1[1] + d[1] * t + n[1] * off;
      left.push(`${r1(cx + n[0] * hw)} ${r1(cy + n[1] * hw)}`);
      right.push(`${r1(cx - n[0] * hw)} ${r1(cy - n[1] * hw)}`);
    }
    ribbons.push(`M${left.join('L')}L${right.reverse().join('L')}Z`);
  }
  const vw = w + 2 * OVER, vh = h + 2 * OVER;
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${vw}' height='${vh}' viewBox='0 0 ${vw} ${vh}'><path d='${ribbons.join('')}' fill='#000'/></svg>`);
}

// Sizes the compiler would read from px width/height (border-box) or --sketch-size.
const KNOWN = { card: [260, 96], card2: [260, 96], prog: [143, 8], c1: [44, 40], c2: [44, 72], c3: [44, 54], c4: [44, 86] };
Object.entries(KNOWN).forEach(([id, [w, h]], i) => {
  const url = exactHatch({ w, h, seed: id === 'card2' ? 900 : 900 + i * 37, ends: id === 'card2' ? 'square' : 'taper' });
  // Same specificity as the :nth-child variant rules above, and later, so it wins over them.
  add(`.m4 .fx[data-x="${id}"]::after { --sk-hx: ${url}; inset: calc(-1 * var(--bw) - ${HATCH_OVER}px); -webkit-mask-image: var(--sk-hx); mask-image: var(--sk-hx); -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-position: 0 0; mask-position: 0 0; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-composite: source-over; mask-composite: add; }`);
});

// Comparison aid: the fixed card's hatching without its outline, so the stroke ends are visible.


// 7: marker swipe
const marks = SEEDS.map((sd) => marker(sd * 7));
add(`.m7 .fx::after { inset: calc(-1 * var(--bw) - 2px) -6px; opacity: 0.55; border-radius: 0; -webkit-mask-box-image: ${marks[0].url} ${marks[0].C} fill / ${marks[0].C}px stretch; mask-border: ${marks[0].url} ${marks[0].C} fill / ${marks[0].C}px stretch; }`);
add(`.m7 .fx:nth-child(3n+2)::after { -webkit-mask-box-image-source: ${marks[1].url}; mask-border-source: ${marks[1].url}; }`);
add(`.m7 .fx:nth-child(3n+3)::after { -webkit-mask-box-image-source: ${marks[2].url}; mask-border-source: ${marks[2].url}; }`);

add(`.sk:nth-child(4n+2)::before { transform: scaleX(-1); }
.sk:nth-child(4n+3)::before { transform: scaleY(-1); }
.sk:nth-child(4n+4)::before { transform: scale(-1, -1); }
.m3 .fx:nth-child(4n+2)::after, .m7 .fx:nth-child(4n+2)::after { transform: scaleX(-1); }
.m3 .fx:nth-child(4n+3)::after, .m7 .fx:nth-child(4n+3)::after { transform: scaleY(-1); }`);

const ROWS = [
  ['m1', '단색', '평범한 배경색. 손맛은 테두리에서만 나요.', ['ok:글자 가독성', 'ok:크기 무관', 'ok:SVG 없음']],
  ['m3', '거친 단색', '가장자리가 울퉁불퉁한 색 덩어리를 테두리처럼 9-slice로 깔아요.', ['ok:글자 가독성', 'ok:크기 무관 (9-slice)', 'ok:작은 SVG']],
  ['m4', '빗금', '크기가 정해진 요소(고정 크기 카드, 진행 막대, 차트 막대)는 Rough.js처럼 선마다 양 끝을 계산해서 그려요. 끝은 진행 방향에 수직이고 가늘게 모여요. 크기를 모르는 요소(버튼, 태그, 너비 조절 카드)는 들쭉날쭉한 띠로 잘라내고, 테두리 선 밖으로는 나가지 않아요.', ['ok:크기 아는 요소: 펜 끝 그대로', 'no:크기 모르는 요소: 잘린 끝 (이후 Houdini로 보강)', 'ok:글자 없는 요소에 잘 어울림']],
  ['m7', '형광펜', '반투명한 마커로 한 번 긁은 모양이에요. 양 끝은 들쭉날쭉하고 가로로만 늘어나요.', ['ok:글자 가독성', 'no:큰 면적엔 어색', 'ok:작은 SVG']],
];
const sample = `
      <button type="button" class="sk fx btn">시안 승인</button>
      <span class="sk fx tag">진행 중</span><span class="sk fx tag">인스타그램</span>
      <div class="sk fx card"><h4>가을 립 컬렉션</h4><p>경쟁사 광고 12건을 수집했고 시안 3종이 검토 대기 중이에요.</p></div>
      <div class="sk fx card fixed" data-x="card"><h4>끝: 가늘게 모임</h4><p>고정 크기 260 × 96px</p></div>
      <div class="sk fx card fixed only-m4" data-x="card2"><h4>끝: 네모</h4><p>같은 선, 끝만 반듯하게</p></div>
      <div class="side">
        <div class="sk progress" role="img" aria-label="진행률 68%"><div class="fx in" data-x="prog"></div></div>
        <div class="chart" role="img" aria-label="채널별 도달 막대 차트">
          <div class="sk fx col" data-x="c1" style="height: 40px"></div><div class="sk fx col" data-x="c2" style="height: 72px"></div><div class="sk fx col" data-x="c3" style="height: 54px"></div><div class="sk fx col" data-x="c4" style="height: 86px"></div>
        </div>
      </div>`;
const rows = ROWS.map(([m, name, desc, traits], i) => `
  <section class="row ${m}">
    <div>
      <h2><span class="num">${i + 1}</span>${name}</h2>
      <p>${desc}</p>
      <div class="traits">${traits.map((t) => { const [k, v] = t.split(':'); return `<span class="${k}">${v}</span>`; }).join('')}</div>
    </div>
    <div class="stage"><div class="stage-inner">${sample}
    </div></div>
  </section>`).join('');

const tpl = fs.readFileSync(new URL('./page.html', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./index.html', import.meta.url), tpl.replace('/*GENERATED*/', css).replace('<!--ROWS-->', rows));
console.log('ok', (Buffer.byteLength(css) / 1024).toFixed(1) + 'KB');

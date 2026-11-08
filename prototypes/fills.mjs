// Fill drawings shared by the demos. Extracted from fill/gen.mjs (the comparison page).
import rough from 'roughjs';

export const W = 2;
const L = 120;
const PRESET = { roughness: 1.3, bowing: 1.2, maxRandomnessOffset: 2 };
const gen = rough.generator();
const r1 = (n) => Math.round(n * 10) / 10;
const tidy = (d) => d.replace(/-?\d*\.\d+/g, (n) => r1(+n));
export const enc = (s) => `url("data:image/svg+xml,${s.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
export const HATCH_OVER = 4;

function svg(w, h, drawables, { sw = 1, extra = '' } = {}) {
  const body = drawables
    .flatMap((d) => gen.toPaths(d))
    .map((p) => (p.fill && p.fill !== 'none' && (!p.stroke || p.stroke === 'none') ? `<path d='${tidy(p.d)}' fill='#000' stroke='none'/>` : `<path d='${tidy(p.d)}'/>`))
    .join('');
  return enc(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><g fill='none' stroke='#000' stroke-width='${sw}' stroke-linecap='round' stroke-linejoin='round'>${body}${extra}</g></svg>`);
}

export function geom(radius) {
  const tight = radius > 0;
  const B = tight ? 4 : 6;
  const C = tight ? B + Math.max(radius, 4) : Math.max(B + 2, 14);
  return { B, C, S: 2 * C + L, outset: B - W / 2 };
}

/** 3: a solid blob with ragged edges, as a 9-slice with `fill`. */
export function blob(radius, seed) {
  const { B, C, S, outset } = geom(radius);
  const o = { stroke: 'none', fill: '#000', fillStyle: 'solid', seed, ...PRESET, roughness: 1.6 };
  const m = B + 1.5, w = S - 2 * m;
  const d = radius > 0 ? gen.path(rr(m, m, w, w, Math.max(radius - 1, 1)), o) : gen.rectangle(m, m, w, w, o);
  return { url: svg(S, S, [d]), C, outset };
}

/** 7: a marker swipe: ragged ends, slightly wavy long edges. */
export function marker(seed) {
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
 * Hatch strokes drawn the way a pen lays them down: nearly straight, one long gentle bow,
 * a per-stroke base width, and pressure that swells and thins along the stroke. Each stroke
 * is a filled ribbon so its width can change. Every variation is periodic in the tile size,
 * so strokes still continue exactly across tile seams.
 */
// gap must divide T, or the strokes would not line up across tile seams
// A bigger tile lets pressure (and bow) change over a longer stretch while staying seamless.
export function penHatchTile({ T = 192, gap = 6, seed }) {
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
 * Ragged edge strips for hatching. Each is a short band whose inner side is solid and whose
 * outer boundary wanders, repeated along one side of the box. Unioned with a solid centre and
 * intersected with the hatch tile, strokes end at uneven depths, some past the outline.
 */
export function edgeStrip({ len = 192, H = 12, minDepth = 1, maxDepth = H - 2, blur = 0.9, seed, side }) {
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

// 4 (known size): Rough.js-style hachure. Each stroke runs between where its line meets the
// box, with each end nudged to land between the outline's middle and 2px outside it. The stroke
// is a ribbon: perpendicular ends that taper over ~2.5px, slow pressure, one gentle bow.
export function exactHatch({ w, h, seed, gap = 6, OVER = HATCH_OVER, Wb = W, ends = 'taper' }) {
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

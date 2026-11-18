// Slider page for tuning the hatch presets (npm run tune:hatch). Runs the plugin's own
// drawHatchTile and option validation in the browser, so what it shows is what the plugin draws.
import { drawHatchTile } from '../../../src/draw/hatch';
import { drawNineSlice, geometryFor, nineSlicePlacement } from '../../../src/draw/stroke';
import { HATCH_DEFAULTS, HATCH_PRESETS, type HatchOptions, type HatchPreset, PRESETS, resolveOptions } from '../../../src/options';

type Numeric = Exclude<keyof HatchOptions, 'ends'>;

type Slider = { readonly key: Numeric; readonly label: string; readonly min: number; readonly max: number; readonly step: number };

/** The two the presets differ in first, then the rest of the hatch options. */
const SLIDERS: ReadonlyArray<Slider> = [
  { key: 'weight', label: 'weight (px)', min: 0.5, max: 16, step: 0.1 },
  { key: 'gap', label: 'gap (px)', min: 2, max: 40, step: 0.5 },
  { key: 'weightJitter', label: 'weight difference between lines, weightJitter (±px)', min: 0, max: 1.5, step: 0.05 },
  { key: 'pressure', label: 'pressure change, pressure (± ratio)', min: 0, max: 0.5, step: 0.005 },
  { key: 'pressureLength', label: 'pressure length, pressureLength (px)', min: 40, max: 320, step: 2 },
  { key: 'bow', label: 'bow (px)', min: 0, max: 2, step: 0.05 },
  { key: 'over', label: 'how far line ends reach outside the border, over (px, elements of known size)', min: 0, max: 10, step: 0.5 },
];

const PRESET_NAMES = Object.keys(HATCH_PRESETS) as ReadonlyArray<HatchPreset>;
const HATCH_SEED = 7; // the plugin's (src/index.ts)

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const state: { values: HatchOptions; color: string } = { values: { ...HATCH_DEFAULTS }, color: '#3b82f6' };

const round = (n: number): number => Math.round(n * 100) / 100;

/** The preset line to paste into HATCH_PRESETS in src/options.ts. */
const presetCode = (name: string, v: HatchOptions): string =>
  `  ${name}: { ...HATCH_DEFAULTS, weight: ${round(v.weight)}, weightJitter: ${round(v.weightJitter)}, gap: ${round(v.gap)}` +
  (['pressure', 'pressureLength', 'bow', 'over'] as const)
    .filter((key) => v[key] !== HATCH_DEFAULTS[key])
    .map((key) => `, ${key}: ${round(v[key])}`)
    .join('') +
  (v.ends === HATCH_DEFAULTS.ends ? '' : `, ends: '${v.ends}'`) +
  ' },';

const render = (): void => {
  const { values, color } = state;
  const check = resolveOptions({ hatch: values });
  const errors = check.diagnostics.map((d) => d.message);
  byId('errors').textContent = errors.join('\n');
  SLIDERS.forEach(({ key }) => {
    byId<HTMLInputElement>(`range-${key}`).value = String(values[key]);
    byId<HTMLInputElement>(`number-${key}`).value = String(values[key]);
  });
  byId<HTMLSelectElement>('ends').value = values.ends;
  if (errors.length > 0) return;
  const tile = drawHatchTile(color, values, HATCH_SEED);
  document.querySelectorAll<HTMLElement>('.hatched').forEach((el) => {
    el.style.backgroundImage = tile.url;
    el.style.backgroundSize = `${tile.size}px ${tile.size}px`;
  });
  // Elements of known size (M6c): the strokes drawn one by one into the border drawing.
  document.querySelectorAll<HTMLElement>('.exact').forEach((el, i) => {
    const request = {
      width: 2,
      radius: 12,
      color: '#1d2433',
      rough: PRESETS.normal,
      seed: [11, 23, 37][i % 3] ?? 11,
      fill: { kind: 'hatch' as const, color, width: el.offsetWidth, height: el.offsetHeight, hatch: values },
    };
    const placement = nineSlicePlacement(geometryFor(request), true);
    el.style.borderImage = `${drawNineSlice(request).url} ${placement.slice} / ${placement.width} / ${placement.outset} stretch`;
  });
  const share = Math.min(1, (values.weight * Math.SQRT2) / values.gap);
  byId('info').textContent = `tile ${tile.size}px · ink about ${Math.round(share * 100)}% · tile size ${(tile.url.length / 1024).toFixed(1)}KB (raw)`;
  const name = byId<HTMLSelectElement>('target').value;
  byId('code').textContent = presetCode(name, values);
  byId('option').textContent = `hatch: { weight: ${round(values.weight)}, gap: ${round(values.gap)} }`;
};

const setValue = (key: Numeric, raw: string): void => {
  const n = Number(raw);
  if (Number.isFinite(n)) {
    state.values = { ...state.values, [key]: n };
    render();
  }
};

const buildControls = (): void => {
  byId('sliders').innerHTML = SLIDERS.map(
    ({ key, label, min, max, step }) =>
      `<label class="slider"><span>${label}</span><input type="range" id="range-${key}" min="${min}" max="${max}" step="${step}"><input type="number" id="number-${key}" min="${min}" max="${max}" step="${step}"></label>`,
  ).join('');
  SLIDERS.forEach(({ key }) => {
    byId<HTMLInputElement>(`range-${key}`).addEventListener('input', (e) => setValue(key, (e.target as HTMLInputElement).value));
    byId<HTMLInputElement>(`number-${key}`).addEventListener('input', (e) => setValue(key, (e.target as HTMLInputElement).value));
  });
  byId('presets').innerHTML = PRESET_NAMES.map(
    (name) => `<button type="button" data-preset="${name}">${name} (${HATCH_PRESETS[name].weight} / ${HATCH_PRESETS[name].gap})</button>`,
  ).join('');
  byId('presets').addEventListener('click', (e) => {
    const name = (e.target as HTMLElement).dataset['preset'] as HatchPreset | undefined;
    if (!name) return;
    state.values = { ...HATCH_PRESETS[name] };
    byId<HTMLSelectElement>('target').value = name;
    render();
  });
  byId<HTMLSelectElement>('target').innerHTML = PRESET_NAMES.map((name) => `<option>${name}</option>`).join('');
  byId<HTMLSelectElement>('target').value = 'normal';
  byId('target').addEventListener('change', render);
  byId<HTMLSelectElement>('ends').addEventListener('change', (e) => {
    state.values = { ...state.values, ends: (e.target as HTMLSelectElement).value === 'taper' ? 'taper' : 'square' };
    render();
  });
  byId<HTMLInputElement>('color').addEventListener('input', (e) => {
    state.color = (e.target as HTMLInputElement).value;
    render();
  });
  byId('copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(byId('code').textContent ?? '');
  });
};

buildControls();
render();

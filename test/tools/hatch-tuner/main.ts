// Slider page for tuning the hatch presets (npm run tune:hatch). Runs the plugin's own
// drawHatchTile and option validation in the browser, so what it shows is what the plugin draws.
import { drawHatchTile } from '../../../src/draw/hatch';
import { HATCH_DEFAULTS, HATCH_PRESETS, type HatchOptions, type HatchPreset, resolveOptions } from '../../../src/options';

type Numeric = Exclude<keyof HatchOptions, 'ends'>;

type Slider = { readonly key: Numeric; readonly label: string; readonly min: number; readonly max: number; readonly step: number };

/** The two the presets differ in first, then the rest of the hatch options. */
const SLIDERS: ReadonlyArray<Slider> = [
  { key: 'weight', label: '굵기 weight (px)', min: 0.5, max: 16, step: 0.1 },
  { key: 'gap', label: '간격 gap (px)', min: 2, max: 40, step: 0.5 },
  { key: 'weightJitter', label: '선마다 굵기 차이 weightJitter (±px)', min: 0, max: 1.5, step: 0.05 },
  { key: 'pressure', label: '필압 변화 pressure (±비율)', min: 0, max: 0.5, step: 0.005 },
  { key: 'pressureLength', label: '필압 길이 pressureLength (px)', min: 40, max: 320, step: 2 },
  { key: 'bow', label: '휨 bow (px)', min: 0, max: 2, step: 0.05 },
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
  (['pressure', 'pressureLength', 'bow'] as const)
    .filter((key) => v[key] !== HATCH_DEFAULTS[key])
    .map((key) => `, ${key}: ${round(v[key])}`)
    .join('') +
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
  if (errors.length > 0) return;
  const tile = drawHatchTile(color, values, HATCH_SEED);
  document.querySelectorAll<HTMLElement>('.hatched').forEach((el) => {
    el.style.backgroundImage = tile.url;
    el.style.backgroundSize = `${tile.size}px ${tile.size}px`;
  });
  const share = Math.min(1, (values.weight * Math.SQRT2) / values.gap);
  byId('info').textContent = `타일 ${tile.size}px · 잉크 비율 약 ${Math.round(share * 100)}% · 타일 크기 ${(tile.url.length / 1024).toFixed(1)}KB (원본)`;
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

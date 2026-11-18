import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, run } from '../../src/cli';
import { planOf, reportLine, warningLine } from '../../src/report/format';

// The `sketchify` command (M9), run with fake standard streams in a fresh folder.

const CARD = '.card { border: 2px solid #1d2433; border-radius: 8px; }\n';
const DASHED = '.d { border: 2px dashed #000; }\n';

const folder = (files: Readonly<Record<string, string>> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sketchify-cli-'));
  Object.entries(files).forEach(([name, text]) => writeFileSync(join(dir, name), text));
  return dir;
};

const fake = (cwd: string, stdin = '', signal?: AbortSignal) => {
  const out: Array<string> = [];
  const err: Array<string> = [];
  const io: CliIo = { cwd, readStdin: async () => stdin, stdout: (t) => out.push(t), stderr: (t) => err.push(t), ...(signal ? { signal } : {}) };
  return { io, out: () => out.join(''), err: () => err.join('') };
};

describe('sketchify command', () => {
  it('converts one file to -o, with a size line and the warnings on stderr', async () => {
    const dir = folder({ 'a.css': CARD + DASHED });
    const t = fake(dir);
    expect(await run(['a.css', '-o', 'out/a.css'], t.io)).toBe(0);
    expect(readFileSync(join(dir, 'out/a.css'), 'utf8')).toContain('border-image: var(--sk)');
    expect(t.out()).toBe('');
    expect(t.err()).toMatch(/^a\.css:2:6 \[sketchify:style\] /m);
    expect(t.err()).toMatch(/^a\.css → out\/a\.css {2}gzip \+[\d.]+KB, 12 drawings \(0 combos\), 1 warning$/m);
  });

  it('converts several files into a folder, keeping their names', async () => {
    const dir = folder({ 'a.css': CARD, 'b.css': CARD });
    const t = fake(dir);
    expect(await run(['a.css', 'b.css', '-d', 'dist'], t.io)).toBe(0);
    expect(existsSync(join(dir, 'dist/a.css')) && existsSync(join(dir, 'dist/b.css'))).toBe(true);
  });

  it('reads standard input and writes standard output, or -o', async () => {
    const dir = folder();
    const t = fake(dir, CARD);
    expect(await run([], t.io)).toBe(0);
    expect(t.out()).toContain('border-image: var(--sk)');
    const u = fake(dir, CARD);
    expect(await run(['-o', 'piped.css'], u.io)).toBe(0);
    expect(readFileSync(join(dir, 'piped.css'), 'utf8')).toContain('border-image');
    expect(u.err()).toMatch(/^<stdin> → piped\.css /m);
  });

  it('--no-report leaves the size line out but keeps the warnings', async () => {
    const dir = folder({ 'a.css': DASHED });
    const t = fake(dir);
    expect(await run(['a.css', '-o', 'o.css', '--no-report'], t.io)).toBe(0);
    expect(t.err()).toContain('[sketchify:style]');
    expect(t.err()).not.toContain('→');
  });

  it.each([
    [['a.css', 'b.css'], '`-d <dir>`'],
    [['a.css', '-o', 'x.css', '-d', 'x'], 'cannot be used together'],
    [['a.css', '-o', 'a.css'], 'The output is the input file'],
    [['--watch'], 'needs input files'],
    [['a.css', '--watch'], 'needs an output (`-o` or `-d`)'],
    [['--loud'], "Unknown option '--loud'"],
    [['a.css', '-o', 'o.css', '--config', 'nope.js'], 'Config file not found'],
  ])('refuses %j with exit code 2', async (argv, message) => {
    const t = fake(folder({ 'a.css': CARD, 'b.css': CARD }));
    expect(await run(argv, t.io)).toBe(2);
    expect(t.err()).toContain(message);
  });

  it('exits 1 on a compile error, with where it is', async () => {
    const dir = folder({ 'bad.css': '.a { border: 1px solid currentColor; }\n' });
    const t = fake(dir);
    expect(await run(['bad.css', '-o', 'o.css'], t.io)).toBe(1);
    expect(t.err()).toMatch(/bad\.css:1:\d+: /);
  });

  it('reads sketchify.config.mjs in the folder, or the one given with --config (.cjs too)', async () => {
    const dir = folder({ 'a.css': DASHED, 'sketchify.config.mjs': "export default { quiet: ['style'] };\n", 'other.cjs': "module.exports = { quiet: [] };\n" });
    const t = fake(dir);
    expect(await run(['a.css', '-o', 'o.css'], t.io)).toBe(0);
    expect(t.err()).not.toContain('[sketchify:style]');
    const u = fake(dir);
    expect(await run(['a.css', '-o', 'o.css', '--config', 'other.cjs'], u.io)).toBe(0);
    expect(u.err()).toContain('[sketchify:style]');
  });

  it('reports wrong options from the config like the plugin does', async () => {
    const dir = folder({ 'a.css': CARD, 'sketchify.config.mjs': "export default { roughness: 'wild' };\n" });
    const t = fake(dir);
    expect(await run(['a.css', '-o', 'o.css'], t.io)).toBe(1);
    expect(t.err()).toContain('roughness must be');
  });

  it('prints help and the version', async () => {
    const t = fake(folder());
    expect(await run(['--help'], t.io)).toBe(0);
    expect(t.out()).toContain('Usage: sketchify');
    const u = fake(folder());
    expect(await run(['--version'], u.io)).toBe(0);
    expect(u.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('--watch converts again when the input changes, until stopped', async () => {
    const dir = folder({ 'a.css': CARD });
    const stop = new AbortController();
    const t = fake(dir, '', stop.signal);
    const running = run(['a.css', '-o', 'o.css', '--watch'], t.io);
    const until = async (ok: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 50));
    };
    await until(() => t.err().includes('Watching for changes'));
    writeFileSync(join(dir, 'a.css'), '.changed { border: 3px solid #b91c1c; }\n');
    await until(() => readFileSync(join(dir, 'o.css'), 'utf8').includes('.changed'));
    expect(readFileSync(join(dir, 'o.css'), 'utf8')).toContain('.changed');
    stop.abort();
    expect(await running).toBe(0);
  });
});

describe('command output', () => {
  it('plans paths against the working folder', () => {
    expect(planOf({ inputs: ['a.css'], out: 'o.css', watch: false }, '/w')).toEqual({ plan: { kind: 'files', pairs: [{ input: '/w/a.css', output: '/w/o.css' }] } });
    expect(planOf({ inputs: ['x/a.css', 'b.css'], dir: 'd', watch: false }, '/w')).toEqual({
      plan: { kind: 'files', pairs: [{ input: '/w/x/a.css', output: '/w/d/a.css' }, { input: '/w/b.css', output: '/w/d/b.css' }] },
    });
    expect(planOf({ inputs: [], watch: false }, '/w')).toEqual({ plan: { kind: 'pipe' } });
  });

  it('formats the lines', () => {
    expect(warningLine('a.css', { line: 3, column: 2, text: '[sketchify:style] …' })).toBe('a.css:3:2 [sketchify:style] …');
    expect(warningLine('a.css', { text: '[sketchify:budget] …' })).toBe('a.css [sketchify:budget] …');
    const report = { before: { raw: 0, gzip: 1024 }, after: { raw: 0, gzip: 3584 }, drawings: 24, comboRules: 2, comboDrawings: 0, top: [] };
    expect(reportLine('a.css', 'o.css', report, 0)).toBe('a.css → o.css  gzip +2.5KB, 24 drawings (2 combos), 0 warnings');
  });
});

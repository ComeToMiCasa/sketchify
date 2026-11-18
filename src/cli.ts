// The `sketchify` command (spec "Distribution and quality", M9): a thin layer over the plugin for sites
// without a build tool. Reads a shared `sketchify.config.js`; prints a size line and the warnings
// per file. With src/index.ts, the only place that reads and writes files and the console.
import { existsSync, readFileSync, realpathSync, watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import postcss from 'postcss';
import sketchify from './index';
import type { SketchifyOptions } from './options';
import type { SizeReport } from './report/budget';
import { HELP, type Plan, planOf, reportLine, warningLine } from './report/format';

/** What the command reads and writes, so tests can run it without a terminal. */
export type CliIo = {
  readonly cwd: string;
  readonly readStdin: () => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Ends `--watch`. */
  readonly signal?: AbortSignal;
};

const CONFIG_NAMES = ['sketchify.config.js', 'sketchify.config.mjs', 'sketchify.config.cjs'];

const version = (): string => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { readonly version?: string };
  return pkg.version ?? '0.0.0';
};

/** The config file to use: `--config`, or the first `sketchify.config.*` in the folder, or none. */
const configPath = (cwd: string, given: string | undefined): string | undefined =>
  given !== undefined ? resolve(cwd, given) : CONFIG_NAMES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));

const load = { count: 0 };

/** The options in a config file (its default export). Loaded fresh each time, for `--watch`. */
const loadConfig = async (path: string): Promise<SketchifyOptions> => {
  if (path.endsWith('.cjs')) {
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve(path)];
    return require(path) as SketchifyOptions;
  }
  load.count += 1;
  const mod = (await import(`${pathToFileURL(path).href}?v=${load.count}`)) as { readonly default?: SketchifyOptions };
  return mod.default ?? {};
};

type Converted = { readonly css: string; readonly warnings: ReadonlyArray<postcss.Warning>; readonly report: SizeReport | undefined };

const convert = async (css: string, from: string | undefined, options: SketchifyOptions): Promise<Converted> => {
  const result = await postcss([sketchify(options)]).process(css, { from });
  const report = result.messages.find((m) => m.type === 'sketchify-report') as unknown as SizeReport | undefined;
  return { css: result.css, warnings: result.warnings(), report };
};

/** A compile error as one block of text: the plugin's message already says where. */
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type Flags = { readonly report: boolean };

/** Converts every file of the plan once. Returns whether all of them worked. */
const convertAll = async (plan: Plan, options: SketchifyOptions, io: CliIo, flags: Flags): Promise<boolean> => {
  const show = (path: string | undefined): string => (path === undefined ? '<stdout>' : relative(io.cwd, path) || path);
  const tell = (label: string, output: string | undefined, converted: Converted): void => {
    converted.warnings.forEach((w) => io.stderr(`${warningLine(label, w)}\n`));
    if (flags.report) io.stderr(`${reportLine(label, show(output), converted.report, converted.warnings.length)}\n`);
  };
  if (plan.kind === 'pipe') {
    try {
      const converted = await convert(await io.readStdin(), undefined, options);
      if (plan.output === undefined) io.stdout(converted.css);
      else {
        await mkdir(dirname(plan.output), { recursive: true });
        await writeFile(plan.output, converted.css);
      }
      tell('<stdin>', plan.output, converted);
      return true;
    } catch (error) {
      io.stderr(`${errorText(error)}\n`);
      return false;
    }
  }
  const results = await Promise.all(
    plan.pairs.map(async ({ input, output }) => {
      const label = relative(io.cwd, input) || input;
      try {
        const converted = await convert(await readFile(input, 'utf8'), input, options);
        if (output === undefined) io.stdout(converted.css);
        else {
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, converted.css);
        }
        tell(label, output, converted);
        return true;
      } catch (error) {
        io.stderr(`${errorText(error)}\n`);
        return false;
      }
    }),
  );
  return results.every(Boolean);
};

/** Runs the command; resolves to the exit code (0 fine, 1 a file failed, 2 wrong arguments or config). */
export const run = async (argv: ReadonlyArray<string>, io: CliIo): Promise<number> => {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...argv],
        allowPositionals: true,
        options: {
          out: { type: 'string', short: 'o' },
          dir: { type: 'string', short: 'd' },
          watch: { type: 'boolean', short: 'w' },
          config: { type: 'string', short: 'c' },
          'no-report': { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
          version: { type: 'boolean', short: 'v' },
        },
      });
    } catch (error) {
      return errorText(error);
    }
  })();
  if (typeof parsed === 'string') {
    io.stderr(`${parsed}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${version()}\n`);
    return 0;
  }
  const planned = planOf({ inputs: positionals, out: values.out, dir: values.dir, watch: values.watch === true }, io.cwd);
  if ('error' in planned) {
    io.stderr(`${planned.error}\n\n${HELP}`);
    return 2;
  }
  const config = configPath(io.cwd, values.config);
  if (values.config !== undefined && (config === undefined || !existsSync(config))) {
    io.stderr(`Config file not found: ${values.config}\n`);
    return 2;
  }
  const flags: Flags = { report: values['no-report'] !== true };
  const once = async (): Promise<number> => {
    try {
      const options = config === undefined ? {} : await loadConfig(config);
      return (await convertAll(planned.plan, options, io, flags)) ? 0 : 1;
    } catch (error) {
      io.stderr(`Could not read the config file (${config}): ${errorText(error)}\n`);
      return 2;
    }
  };
  const first = await once();
  if (values.watch !== true || planned.plan.kind !== 'files') return first;

  // --watch: convert again when an input or the config changes, a burst of changes at a time.
  const files = [...planned.plan.pairs.map((pair) => pair.input), ...(config === undefined ? [] : [config])];
  io.stderr('Watching for changes. Press Ctrl+C to stop.\n');
  const pending: { timer?: ReturnType<typeof setTimeout> } = {};
  const watchers = files.map((file) =>
    watch(file, () => {
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        void once();
      }, 100);
    }),
  );
  await new Promise<void>((done) => {
    if (io.signal?.aborted) done();
    io.signal?.addEventListener('abort', () => done(), { once: true });
  });
  clearTimeout(pending.timer);
  watchers.forEach((watcher) => watcher.close());
  return 0;
};

/** The process wiring: standard streams, Ctrl+C, the exit code, and a closed pipe (`| head`). */
export const main = async (): Promise<void> => {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    readStdin: () => text(process.stdin),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: stop.signal,
  });
};

// Run when this file is the command itself (not when imported, as by the `sketchify` package or tests).
const invoked = process.argv[1];
if (invoked !== undefined && existsSync(invoked) && realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))) void main();

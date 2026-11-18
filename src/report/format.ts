// What the CLI prints and where it writes (M9). Pure: the CLI (src/cli.ts) does the reading and
// writing; this decides the plan and the text.
import { basename, join, resolve } from 'node:path';
import type { SizeReport } from './budget';

/** Where the CSS goes: from files or standard input, to a file, a folder or standard output. */
export type Plan =
  /** Standard input to `output`, or to standard output. */
  | { readonly kind: 'pipe'; readonly output?: string }
  | { readonly kind: 'files'; readonly pairs: ReadonlyArray<{ readonly input: string; readonly output: string | undefined }> };

export type CliArgs = {
  readonly inputs: ReadonlyArray<string>;
  readonly out?: string;
  readonly dir?: string;
  readonly watch: boolean;
};

/** The plan for the arguments, or the reason they do not fit together. Paths are resolved against `cwd`. */
export const planOf = (args: CliArgs, cwd: string): { readonly plan: Plan } | { readonly error: string } => {
  if (args.out !== undefined && args.dir !== undefined) return { error: '`-o` and `-d` cannot be used together.' };
  if (args.inputs.length === 0) {
    if (args.watch) return { error: '`--watch` needs input files (standard input cannot be watched).' };
    if (args.dir !== undefined) return { error: '`-d` needs input files.' };
    return { plan: args.out === undefined ? { kind: 'pipe' } : { kind: 'pipe', output: resolve(cwd, args.out) } };
  }
  if (args.inputs.length > 1 && args.dir === undefined) return { error: 'Several input files need an output folder: `-d <dir>`.' };
  if (args.watch && args.out === undefined && args.dir === undefined) return { error: '`--watch` needs an output (`-o` or `-d`).' };
  const pairs = args.inputs.map((input) => {
    const from = resolve(cwd, input);
    const to = args.dir !== undefined ? join(resolve(cwd, args.dir), basename(input)) : args.out !== undefined ? resolve(cwd, args.out) : undefined;
    return { input: from, output: to };
  });
  const same = pairs.find((pair) => pair.output === pair.input);
  if (same) return { error: `The output is the input file: ${same.input}. Give another path so the original is not overwritten.` };
  return { plan: { kind: 'files', pairs } };
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)}KB`;

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** One line per file: `a.css → out/a.css  gzip +12.3KB, 120 drawings (3 combos), 2 warnings`. */
export const reportLine = (input: string, output: string, report: SizeReport | undefined, warnings: number): string => {
  const size = report ? `gzip +${kb(report.after.gzip - report.before.gzip)}, ${count(report.drawings, 'drawing')} (${count(report.comboRules, 'combo')})` : '';
  return `${input} → ${output}  ${[size, count(warnings, 'warning')].filter((part) => part !== '').join(', ')}`;
};

/** A warning with its place: `a.css:12:3 [sketchify:style] …`. */
export const warningLine = (file: string, warning: { readonly line?: number; readonly column?: number; readonly text: string }): string =>
  `${file}${warning.line === undefined ? '' : `:${warning.line}:${warning.column ?? 1}`} ${warning.text}`;

export const HELP = `Usage: sketchify <files…> [-o out.css | -d outdir] [--watch] [--config path] [--no-report]

  sketchify style.css -o style.sketch.css   one file
  sketchify a.css b.css -d dist             several files into a folder (same names)
  cat style.css | sketchify > out.css       standard input to standard output
  sketchify style.css -o out.css --watch    convert again on every change

  -o, --out <file>      output file (one input)
  -d, --dir <dir>       output folder (several inputs)
  -w, --watch           convert again when an input or the config changes
  -c, --config <path>   config file (default: sketchify.config.js, .mjs or .cjs in the current folder)
      --no-report       leave out the size line per file (warnings stay)
  -h, --help            this help
  -v, --version         the version

The config file's default export is the plugin options (export default { roughness: 'messy' }).
`;

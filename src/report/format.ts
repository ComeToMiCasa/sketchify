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
  if (args.out !== undefined && args.dir !== undefined) return { error: '`-o`와 `-d`는 함께 쓸 수 없습니다.' };
  if (args.inputs.length === 0) {
    if (args.watch) return { error: '`--watch`에는 입력 파일이 필요합니다(표준 입력은 감시할 수 없음).' };
    if (args.dir !== undefined) return { error: '`-d`에는 입력 파일이 필요합니다.' };
    return { plan: args.out === undefined ? { kind: 'pipe' } : { kind: 'pipe', output: resolve(cwd, args.out) } };
  }
  if (args.inputs.length > 1 && args.dir === undefined) return { error: '입력 파일이 여러 개면 출력 폴더 `-d <폴더>`가 필요합니다.' };
  if (args.watch && args.out === undefined && args.dir === undefined) return { error: '`--watch`에는 출력(`-o` 또는 `-d`)이 필요합니다.' };
  const pairs = args.inputs.map((input) => {
    const from = resolve(cwd, input);
    const to = args.dir !== undefined ? join(resolve(cwd, args.dir), basename(input)) : args.out !== undefined ? resolve(cwd, args.out) : undefined;
    return { input: from, output: to };
  });
  const same = pairs.find((pair) => pair.output === pair.input);
  if (same) return { error: `출력이 입력 파일과 같습니다: ${same.input}. 원본을 덮어쓰지 않도록 다른 경로를 주세요.` };
  return { plan: { kind: 'files', pairs } };
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)}KB`;

/** One line per file: `a.css → out/a.css  gzip +12.3KB, 그림 120장(조합 3), 경고 2`. */
export const reportLine = (input: string, output: string, report: SizeReport | undefined, warnings: number): string => {
  const size = report ? `gzip +${kb(report.after.gzip - report.before.gzip)}, 그림 ${report.drawings}장(조합 ${report.comboRules})` : '';
  return `${input} → ${output}  ${[size, `경고 ${warnings}`].filter((part) => part !== '').join(', ')}`;
};

/** A warning with its place: `a.css:12:3 [sketchify:style] …`. */
export const warningLine = (file: string, warning: { readonly line?: number; readonly column?: number; readonly text: string }): string =>
  `${file}${warning.line === undefined ? '' : `:${warning.line}:${warning.column ?? 1}`} ${warning.text}`;

export const HELP = `사용법: sketchify <파일…> [-o 출력.css | -d 출력폴더] [--watch] [--config 경로] [--no-report]

  sketchify style.css -o style.sketch.css   파일 하나
  sketchify a.css b.css -d dist             여러 파일을 폴더로(이름 그대로)
  cat style.css | sketchify > out.css       표준 입력 → 표준 출력
  sketchify style.css -o out.css --watch    바뀔 때마다 다시 변환

  -o, --out <파일>      출력 파일 (입력이 하나일 때)
  -d, --dir <폴더>      출력 폴더 (입력이 여럿일 때)
  -w, --watch           입력·설정 파일이 바뀌면 다시 변환
  -c, --config <경로>   설정 파일 (기본: 현재 폴더의 sketchify.config.js, .mjs, .cjs)
      --no-report       파일마다의 크기 보고 줄을 끔 (경고는 그대로)
  -h, --help            이 도움말
  -v, --version         버전

설정 파일은 플러그인 옵션 객체를 기본으로 내보냅니다(export default { roughness: 'messy' }).
`;

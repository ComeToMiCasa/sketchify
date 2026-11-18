// CSS size report and budget (spec "Size budget", M8). Pure: strings and numbers in, a report out.
// Compression is only measured (node:zlib), nothing is read or written. gzip only: brotli at its
// usual quality takes 250–400ms on a large output, on every build.
import { gzipSync } from 'node:zlib';

export type Sizes = { readonly raw: number; readonly gzip: number };

export const sizesOf = (css: string): Sizes => {
  const bytes = Buffer.from(css);
  return { raw: bytes.length, gzip: gzipSync(bytes).length };
};

/** What the transform added to one rule (or wrote as a new rule), and the drawings it refers to. */
export type RuleGrowth = {
  readonly selector: string;
  /** `line:column` of the rule, or '' for a rule the plugin wrote. */
  readonly at: string;
  /** Bytes added to the rule's own text (all of it for a rule the plugin wrote). */
  readonly added: number;
  /** Drawing variables (`--sk-…`) the rule refers to, in order. */
  readonly drawings: ReadonlyArray<string>;
  /** A combination rule (M4) the plugin wrote after a rule. */
  readonly combo: boolean;
};

export type Contribution = { readonly selector: string; readonly at: string; readonly bytes: number };

export type SizeReport = {
  readonly before: Sizes;
  readonly after: Sizes;
  /** Drawings stored in the file, and how many of them only combination rules use. */
  readonly drawings: number;
  readonly comboRules: number;
  readonly comboDrawings: number;
  /** The rules that added the most (raw bytes, with the drawings they use first), largest first. */
  readonly top: ReadonlyArray<Contribution>;
};

/**
 * The size report. A drawing's bytes count for the first rule (in source order) that uses it, so
 * shared drawings are counted once and the rule that brought them in carries them.
 */
export const sizeReport = (before: string, after: string, growth: ReadonlyArray<RuleGrowth>, drawingSizes: ReadonlyMap<string, number>, top = 5): SizeReport => {
  const owner = new Map<string, number>();
  growth.forEach((rule, i) => rule.drawings.forEach((name) => (owner.has(name) ? undefined : owner.set(name, i))));
  const contributions = growth.map((rule, i) => ({
    selector: rule.selector,
    at: rule.at,
    bytes: rule.added + rule.drawings.filter((name) => owner.get(name) === i).reduce((sum, name) => sum + (drawingSizes.get(name) ?? 0), 0),
  }));
  const comboOnly = [...drawingSizes.keys()].filter((name) => {
    const users = growth.filter((rule) => rule.drawings.includes(name));
    return users.length > 0 && users.every((rule) => rule.combo);
  });
  return {
    before: sizesOf(before),
    after: sizesOf(after),
    drawings: drawingSizes.size,
    comboRules: growth.filter((rule) => rule.combo).length,
    comboDrawings: comboOnly.length,
    top: [...contributions].filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, top),
  };
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)}KB`;

/** The budget warning's text, when the added gzip size is over `budgetKb`; otherwise undefined. */
export const overBudget = (report: SizeReport, budgetKb: number): string | undefined => {
  const added = report.after.gzip - report.before.gzip;
  if (added <= budgetKb * 1024) return undefined;
  const top = report.top.map((c) => `${c.selector}${c.at ? ` (${c.at})` : ''} ${kb(c.bytes)}`).join(', ');
  return (
    `[sketchify:budget] The sketches added ${kb(added)} gzip to the CSS (budget ${budgetKb}KB). ` +
    `Raw ${kb(report.before.raw)} → ${kb(report.after.raw)}, ${report.drawings} drawings (${report.comboDrawings} of them for ${report.comboRules} combination rules). ` +
    `Rules that added the most (in the source): ${top}. Change the budget with the option \`budget: { gzip: KB }\`, or turn it off with \`budget: false\`.`
  );
};

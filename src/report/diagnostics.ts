import type { Node } from 'postcss';

/** A problem found while compiling. Errors fail the build in index.ts; warnings are reported. */
export type Diagnostic =
  | { readonly severity: 'error'; readonly message: string; readonly node?: Node }
  | { readonly severity: 'warning'; readonly message: string; readonly node?: Node };

/** What core functions return instead of throwing. */
export type Result<T> = {
  readonly value: T;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
};

export const ok = <T>(value: T): Result<T> => ({ value, diagnostics: [] });

export const isError = (diagnostic: Diagnostic): boolean => diagnostic.severity === 'error';

/** `line:column` of the node's start, or an empty string when the node has no source. */
export const position = (node: Node | undefined): string => {
  const start = node?.source?.start;
  return start ? `${start.line}:${start.column}` : '';
};

# postcss-sketchify

A PostCSS plugin that turns plain CSS into a hand-drawn style while leaving the layout as it is.

- Spec: docs/spec.md (what we are building; the reference document)
- Implementation plan: docs/plan.md (module structure, milestones M0–M9)
- Progress: docs/progress.md (where we are now; local only, not in git)
- Prototype code: prototypes/ (reference for the drawing functions and measuring scripts. Do not import it as is; port and rewrite it)

## Commands

- `npm run lint`: type check (tsc) + ESLint (enforces the coding conventions below)
- `npm test`: unit tests + output snapshots + lint rule checks
- `npm run test:browser`: layout-invariance and pixel tests (Playwright, Chromium, Firefox and WebKit)
- `npm run build`: package build

## Rules

- Core promise: every element must have the same position and size before and after conversion. Never make a change that breaks this, for any reason.
- Before saying something is done, pass `npm run lint`, `npm test` and `npm run test:browser`.
- Do not change tests to make them pass. If a test seems wrong, stop and ask.
- If behaviour the spec does not cover needs deciding, do not invent it; stop and ask. Record decisions in docs/spec.md.
- One milestone at a time. Write out-of-scope work under "Next" in docs/progress.md.
- When a milestone ends, write what was done, what was decided and what is left in docs/progress.md.
- The "Implementation pitfalls" table in docs/spec.md lists bugs actually hit. Read it before writing related code.

## Coding conventions

TypeScript, functional style. ESLint enforces the rules below.

- Functions only as `const f = (...) => ...`. No `function` declarations and no `class`.
- Pure core, side effects at the edges:
  - `read/`, `gather/`, `draw/` hold pure functions only. They do not change their inputs and do not modify PostCSS nodes.
  - PostCSS AST changes only in `emit/`; file and console I/O only in `cli.ts` and `index.ts`.
- Immutable data: `readonly` types, `ReadonlyArray` for arrays, `const` for variables.
  - Exception: where a numeric loop reads better, as in `draw/` coordinate math, local variables used only inside the function may change. They must not leak out.
- Define data with `type`. Values that come in kinds (fill mode, border side and so on) are discriminated unions, and every `switch` handles them exhaustively with a `never` check.
- Errors are returned as values, not thrown. Core functions return `{ value, diagnostics }`; `index.ts` collects the diagnostics and fails the compile once.
- Deterministic output: no `Math.random` or `Date`. Random numbers only from seeded generators.
- Named exports only. Only the plugin entry point PostCSS requires is a default export.
- No functional libraries such as fp-ts. Standard TypeScript is enough.
- tsconfig has `strict` and `noUncheckedIndexedAccess` on.

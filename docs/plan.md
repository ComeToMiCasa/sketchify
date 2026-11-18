# Implementation plan

The compiler is rewritten from scratch against the spec (docs/spec.md). The first goal is a single rule's border working end to end; the biggest risk is the cascade across rules.

## Stages

The plugin processes one CSS file in five stages. The draw stage is pure, so the same input always gives the same SVG.

1. **Read**: from each rule, extract borders, radius, background colour, px sizes and the `--sketch-*` controls, and analyse the selector (base selector, state pseudo-classes, the parent of a compound selector). Output: facts per rule.
2. **Gather**: group the rules that apply to the same element into complete border states. State, media and modifier rules take missing values from their parent; colours are resolved; modifier combinations are expanded. Rules that could only be guessed from names and colours that cannot be resolved fail here. Output: drawing requests, and which selector uses which drawing.
3. **Draw**: turn drawing requests into SVG. Requests are deduplicated by key, so the same shape and colour are drawn once.
4. **Emit**: put each drawing into a CSS variable once, and write transparent borders, `border-image` and backgrounds into the rules. Variant picking rules (`:nth-child`), combination rules and the `@sketchify base` expansion are made here too.
5. **Report**: report errors and warnings with line numbers, and compare the added size (raw, gzip) and the share added by combinations against the budget.

## Modules

Folders map 1:1 to the stages. `draw/` holds only pure functions that know nothing of PostCSS, so Houdini or other inputs (Tailwind) can reuse them as is.

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point, wiring the stages |
| `src/options.ts` | Option defaults, roughness presets, hatch options, validation |
| `src/read/selectors.ts` | Selector analysis: base selector, state pseudo-classes, the parent of a compound selector |
| `src/read/values.ts` | Parsing `border`, `border-radius`, background and colour values |
| `src/read/collect.ts` | Rules → facts per rule, removing the `--sketch-*` controls |
| `src/gather/colors.ts` | Literal and `var()` resolution, theme values per media query, unresolvable errors |
| `src/gather/cascade.ts` | Filling state, media and modifier rules from their parent, name-guess errors |
| `src/gather/combos.ts` | Modifier groups and expanding combinations |
| `src/draw/svg.ts` | SVG strings, number formatting, data URI encoding, flips with `<g transform>` |
| `src/draw/stroke.ts` | 9-slice borders, one-sided lines |
| `src/draw/fill.ts` | Rough solid, marker (drawn with the border) |
| `src/draw/hatch.ts` | Repeating hatch pattern, exact hatch on elements of known size |
| `src/draw/controls.ts` | Checkbox, radio, select arrow, underline |
| `src/emit/emit.ts` | Drawing variables, border and background declarations, redeclaring after the `border` shorthand |
| `src/emit/variants.ts` | Mixing by own, parent and grandparent index |
| `src/emit/base.ts` | The `@sketchify base` expansion (`@layer`, `:where()`) |
| `src/report/diagnostics.ts` | Error and warning text with suggested fixes |
| `src/report/budget.ts` | Size measurement and the budget warning |
| `src/cli.ts` | CLI, loading `sketchify.config.js` |

## Order of work

Set up testing first, make the single-rule border (M1) work end to end, then add features. Each milestone starts after the previous one is done. Size is relative effort (S < M < L).

| Milestone | Scope | Done when | Size |
| --- | --- | --- | --- |
| M0 Setup | TypeScript, tsup, vitest, Playwright browser tests, test pages | The layout-invariance test runs against an empty plugin | S |
| M1 Single-rule border | Four-sided `border`, square and rounded corners, literal colours, 9-slice `border-image`, roughness presets, redeclaring after the `border` shorthand | 0px layout difference on the example pages; identical output on every build | M |
| M2 Neighbour variants | 3 seeds, flips inside the SVG, mixing by own/parent/grandparent index, deduplicated drawing variables | Neighbouring elements get different drawings. Compressed size of the flips checked (open question) | S |
| M3 Colour resolution | `:root` variables, media query themes, `currentColor`/unresolvable/class theme errors | Dark-mode variants appear; error messages suggest fixes | M |
| M4 Cascade | Filling state, media and compound selector rules, name-guess errors, generating modifier combinations | Every combination correct on a design-system-style test CSS (size and colour modifiers, hover, responsive) | L |
| M5 One-sided lines | One-sided `border`, `hr` (underlines moved to M6d) | Dividers reach the ends even in long lists | S |
| M6a Fills: rough solid and marker | The `--sketch-fill` control, solid as is, rough solid and marker (with the border), fills without a border | On the fills page the inside is painted and the marker reaches outside | M |
| M6b Fills: repeating hatch | Seamless hatch tiles for elements of unknown size, hatch options (`gap`, `weight` and so on) | Same result as the fill comparison page | M |
| M6c Fills: exact hatch | Per-line hatching on elements of known size (px `width`/`height`, `--sketch-size`), end shapes, 4px outside the border | Same result as the fill comparison page | M |
| M6d Underlines | `text-decoration` underlines as one-sided line drawings (`border-image` without a border, inline elements), colour resolution | A multi-line link gets an underline on each line | S |
| M7a Forms and base | `@sketchify base`, input, textarea, select (arrow), checkbox, radio, hr, base colours and dark mode | User styles always beat base, the focus ring is visible, default sizes ±4px | M |
| M7b Base polish | The checked radio's dot, the textarea resize grip, the default link underline, buttons | Looks like the prototype; user styles win | S |
| M8 Diagnostics and budget | The full warning list, the size report, the combination share, calibrating the default budget | Budget numbers settled with 2–3 real pages | S |
| M9 Release prep | CLI, config file, README, package checks, getting 0.1.0 ready to publish (the user publishes) | Plugin and CLI both work when installed into an empty project | S |

After M1, single-rule borders alone can be tried on real pages. M4 is the largest and most error-prone milestone, so its test CSS comes first.

## Testing strategy

The core promise, "layout stays put", is measured in the browser. Most bugs found while building the demos were invisible in the code and showed only when rendered.

- **Unit tests**: value parsing, selector analysis, colour resolution, cascade filling, combination expansion. All pure functions, so fast.
- **Output snapshots**: the output of the test CSS is stored and checked on every build, so drawings do not change by accident.
- **Layout-invariance tests**: the same HTML is rendered with the original CSS and with the converted CSS, and every element's position and size are compared. Includes the mega menu and tooltip scenarios.
- **Pixel tests**: with easy-to-judge drawings like the edge test page, read the pixels where something should and should not be drawn.
- **Browsers**: Chromium, Firefox and WebKit (Safari's engine), with Playwright, in CI (Firefox added 2026-11-18).

## Risks

| Risk | Response |
| --- | --- |
| Cascade filling picks the wrong parent for real-world selectors (`:is()`, `:where()`, selector lists, descendant combinators) | A parent counts only when it is literally contained in the selector. When unsure, make it an error; analyse selectors with postcss-selector-parser |
| Taking CSS nesting (`&`) as is misreads selectors | Document that the plugin runs after a nesting plugin; error if nesting remains |
| Design systems with many modifier combinations grow the size a lot | Show the combination share separately in the budget warning; measure with real design-system CSS in M8 |
| `currentColor` errors come up so often that first-time users give up | The error message explains that "a missing colour means `currentColor`" and shows the line to fix |
| Things drawn differently only in Safari or Firefox | Run WebKit tests locally and in CI from M0, Firefox tests since 2026-11-18 |

## What to take from the prototypes

The drawing code is ported from what the demos proved; the PostCSS plugin part is dropped. The prototype code is in `prototypes/`.

- **Take**: 9-slice border drawing and the corner slice rules, rough solid and marker drawing, the hatch pattern with pressure (the version that continues across tile edges), exact hatching on elements of known size, checkbox, radio, arrow and underline, SVG number formatting and encoding, the layout comparison and pixel measuring scripts
- **Drop**: the conversion logic of the 0.1.0 package prototype (pseudo-element + mask, font replacement, stretching one whole SVG), the code that cuts hatch ends with a band, fades
- **Reuse the package setup**: the tsup dual build (ESM and CJS), using it directly with `require()` from CJS, the CLI's closed-pipe handling

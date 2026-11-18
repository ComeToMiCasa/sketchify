# postcss-sketchify

A PostCSS plugin that turns the borders, fills and underlines of plain CSS into hand-drawn sketches, **without moving a single pixel of layout**.

```css
/* your CSS */
.card { border: 2px solid #1d2433; border-radius: 12px; }

/* after postcss-sketchify: the same border box, drawn by hand */
.card { border: 2px solid #1d2433; border-color: transparent; border-image: var(--sk) 16 / 16px / 3px stretch; … }
```

- **Layout stays put.** Every element keeps its position and size. Borders keep their width and style; only their colour turns transparent and a drawing takes its place (`border-image`). This is tested in Chromium, Firefox and WebKit on every change.
- **No JavaScript at runtime.** The drawings are SVGs written into the CSS at build time ([Rough.js](https://roughjs.com) style, deterministic: the same CSS always gives the same output).
- **Neighbours differ.** Elements next to each other get different drawings (3 seeds × 4 mirrorings), so a list of cards does not look stamped.
- **Hover, focus and dark mode** keep the same shape in another colour. Colours from `var()` are resolved at build time, including `@media (prefers-color-scheme: dark)` themes.

## Install

```sh
npm install --save-dev postcss-sketchify postcss
```

Node 20 or later. Supported browsers: Chromium-based browsers (Chrome, Edge, Samsung Internet), Firefox and Safari, on desktop and mobile.

## Use with PostCSS

Vite, Next.js, webpack and Parcel read `postcss.config.js`:

```js
// postcss.config.js
import sketchify from 'postcss-sketchify';

export default {
  plugins: [sketchify({ roughness: 'normal' })],
};
```

CommonJS works too: `require('postcss-sketchify')` returns the plugin.

To share options with the command line tool, keep them in `sketchify.config.js` and import them:

```js
// sketchify.config.js
export default { roughness: 'messy', hatch: 'bold', quiet: ['style'] };

// postcss.config.js
import sketchify from 'postcss-sketchify';
import options from './sketchify.config.js';
export default { plugins: [sketchify(options)] };
```

## Command line

For static sites without a build tool, or to try it out:

```sh
npx sketchify style.css -o style.sketch.css    # one file
npx sketchify a.css b.css -d dist              # several files into a folder (same names)
cat style.css | npx sketchify > out.css        # standard input to standard output
npx sketchify style.css -o out.css --watch     # convert again on every change
```

Options: `-o, --out <file>`, `-d, --dir <folder>`, `-w, --watch`, `-c, --config <path>` (default: `sketchify.config.js`, `.mjs` or `.cjs` in the current folder), `--no-report`, `-h, --help`, `-v, --version`. The CSS goes to the file or standard output; a size line and the warnings go to standard error. A compile error exits with code 1.

The `sketchify` package is the same command on its own (`npx sketchify …` without installing anything).

## What gets drawn

| You write | You get |
| --- | --- |
| `border` on all four sides, solid, px width, one colour, radius up to 32px | A hand-drawn box (9-slice `border-image`) |
| A single side (`border-bottom`), or `hr { border-top: … }` | A hand-drawn line whose ends reach the element's ends |
| `text-decoration: underline` on an inline element (`a`, `span`, …) | A hand-drawn line just below each line of text |
| `--sketch-fill: rough \| marker \| hatch` with a `background-color` | A rough solid fill, a highlighter swipe, or hatching |

Rules that build on each other are understood as the browser would apply them: a `.btn` with `.btn--primary`, `:hover`, and the same selector inside `@media` all get the drawing that the original CSS would show, including combinations (`.btn.btn--primary:hover`). A modifier is recognised when its selector contains the parent's (`.btn.btn--lg`, not a lone `.btn--lg`).

### Controls

| In a rule | Effect |
| --- | --- |
| `--sketch: off` | Leave this rule exactly as written (no drawing, no warning). |
| `--sketch-fill: rough \| marker \| hatch \| solid` | Draw the background. `solid` keeps the original. |
| `--sketch-size: 240 160` | The element's border-box size, for an exact hatch whose strokes end unevenly at the outline. Without it, px `width` and `height` (with `box-sizing`) are used; otherwise the hatch is a repeating pattern. |

The plugin removes these from the output.

### `@sketchify base;`

One line puts hand-drawn defaults for elements you did not style: text fields, textarea (and its resize grip), select (with its arrow), checkboxes, radios, buttons, links and `hr`, with a hand-drawn focus ring.

```css
@sketchify base;
```

The defaults go in a cascade layer under `:where()`, so your own styles always win. They replace the browser's look of form controls, so they stay within a few pixels of the browser's sizes rather than keeping them exactly. Put the line first if you use `@layer` yourself.

## Options

| Option | Default | |
| --- | --- | --- |
| `roughness` | `'normal'` | `'subtle'`, `'normal'`, `'messy'`, or a number from 0. |
| `hatch` | `'normal'` | `'fine'` (pen), `'normal'`, `'bold'` (marker), or `{ preset, gap, weight, weightJitter, pressure, pressureLength, bow, ends, over }`. Numbers are px without a unit. |
| `base` | `{ ink: '#1d2433', accent: '#2563eb' }` | Colours of `@sketchify base`; add `dark: { ink, accent }` for `prefers-color-scheme: dark`. Literal colours only. |
| `quiet` | `[]` | Warning kinds to leave out, such as `['style', 'clip']`. |
| `budget` | `{ gzip: 30 }` | Warn when the drawings add more than this many KB (gzip) to a file; `false` to turn off. |

## Errors and warnings

Each message points at the declaration and says how to fix it.

**Errors** stop the build, because the drawing would be wrong otherwise:

- A colour not known at build time: `currentColor`, a border without a colour, a `var()` defined in another file (combine files first, e.g. with postcss-import) or changed by a class (`html.dark { --ink: … }`; use a `prefers-color-scheme` media query instead).
- A rule that changes part of a border (`border-color: red`) without a parent rule in its selector to take the rest from.
- More than 16 modifiers, states and conditions on one parent rule.

Add `--sketch: off` to a rule to leave it out.

**Warnings** tell you what is left as plain CSS or may not look right. Each has a name you can pass to `quiet`:
`style` (dashed, dotted…), `mixed` (sides with different colours), `sides` (two or three sides), `radius` (over 32px, %, elliptical), `unit` (non-px width), `combo` (a combination that cannot be drawn), `collapse` (collapsed table borders), `transition` (border colour transitions jump), `clip` (a parent's `overflow` may cut lines that reach outside), `underline-color`, `fill-image`, `link-color`. A `budget` warning lists the rules that added the most.

The full size report is always available as a PostCSS message of type `sketchify-report` (sizes before and after, number of drawings, the largest rules).

## Limits

- **Your own CSS only.** CSS frameworks (Bootstrap, Pico…) rely on attribute themes and component variables changed by classes, which cannot be resolved at build time; most of their rules end in errors.
- The compiler does not know the HTML. Element sizes are known only from px `width`/`height` or `--sketch-size`; parents only from selectors.
- Firefox: when a hover swaps the drawing, the border can go blank for one frame (a brief flicker). Chromium and Safari do not do this.
- Drawings are fixed SVGs, so files grow: typically 2–11KB gzip per page, more with many combinations or exact hatches. The `budget` warning tells you when.

## License

MIT

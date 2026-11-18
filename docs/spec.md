# postcss-sketchify MVP spec

Written 2026-10-21 · Daniel Jung

## Overview

postcss-sketchify is a build-time compiler that reads plain CSS and turns borders and fills into hand-drawn sketches while leaving the layout alone. It is not a ready-made UI kit; it converts the style definitions the user wrote.

- **Audience**: front-end developers building real product pages with a hand-drawn look. The sketch style is always on; there is no toggle.
- **Layout stays put**: the original border keeps its width and style; only its colour becomes transparent. No element moves or changes size by even 1px. This promise applies to converted user CSS, not to the base layer.
- **Zero client JS**: every drawing is made as SVG at build time and written into the CSS.
- **Performance first**: the only remaining costs are CSS size and rendering. Choices that grow the size (number of variants, pressure length, hatching on elements of known size, colour and modifier combinations) state their cost in the docs.

## Input and extension plan

The MVP input is plain CSS; Tailwind comes in a later step.

- Sass and CSS Modules are already plain CSS by the time they reach PostCSS, so they work as is.
- With Tailwind, an element's border, radius and background are spread over several classes. So the internals are split into three stages: **read → gather sketch information per element → emit**. The MVP gather stage assumes "one rule = one element"; the Tailwind extension swaps out only this stage.
- CSS-in-JS that builds styles at runtime (styled-components and the like) is out of scope.
- The recommended use is a PostCSS plugin in the build pipeline, because the dev server must look the same as production. Distribution is described under "Distribution and quality" below.

## What is converted

Borders, fills, one-sided lines and form controls become hand-drawn; fonts and shadows do not change.

| Target | Treatment |
| --- | --- |
| `border` (all four sides) | Rough.js 9-slice border |
| One side such as `border-top`, `hr` | A hand-drawn line with fixed ends |
| `border-radius` | Reflected in the border shape and the corner slice size |
| `background-color` | One of four fills |
| Underline (`text-decoration`) | An inline element's underline as a hand-drawn line like a one-sided border (M6d) |
| Input, textarea, select | Border on the element itself, fixed colour |
| Checkbox, radio | Box/circle and tick/dot as a background, fixed colour |

- **No font replacement.** Handwriting web fonts are heavy, and a late load changes glyph widths and shifts the layout (CLS). Users pick fonts and their loading strategy themselves.
- **No box-shadow.** It stays as written.

## Borders

Rough.js draws a small rectangle once, used as the 9-slice source, and the element's own `border-image` draws it (approach A). Corners stay fixed; sides stretch only along their length (`stretch`). No pseudo-elements, `position` or `isolation`.

- **Why approach A**: drawing on a pseudo-element requires `position: relative` and `isolation: isolate` on the element. That changes the containing block of `absolute` children positioned against an outer ancestor (mega menus and the like), and keeps tooltips from rising above neighbouring elements. Both actually broke on the comparison page; approach A matched the original.
- **Why 9-slice**: stretching one whole SVG to the element's size squashes the corners and exaggerates the wobble vertically. Repeating a short piece makes the line wave periodically, which does not look hand-drawn.
- **Corner slice size**: a rounded corner uses just enough for the curve (4px margin + radius). A square corner leaves room for the lines that cross and overshoot (at least 14px). This keeps the browser from shrinking the corners on small elements.
- **Stroke width**: the user's `border-width` is drawn as is. Rough.js strokes each line twice, which looks thicker, so one pass is 0.85× as wide. 4px and up looks like a marker; no extra correction.
- **Layout**: the original border keeps its width and style with a transparent colour. Parts of the line outside the box are drawn with `border-image-outset`, which does not affect layout.
- **Colour**: the colour is fixed in the SVG. The compiler makes an SVG for each colour used in the CSS. A `var()` colour works only when the compiler can find its value (see "Colour resolution" below).
- **State rules**: rules such as `:hover` and `:focus` that change only the colour swap `border-image-source` to an SVG with the same shape in that colour. The shape stays, so the line does not jump. Confirmed: the border does not go blank on the first change.
- **Colour resolution**: literal colours are used as is. A `var()` is looked up in `:root` and so on in the same file; when a media query (dark mode and so on) changes the value, a separate variant SVG goes inside it. A colour not known at build time is a compile error (see "Limits and errors").
  - **Where variables are looked up**:
    - Rules in the same file whose selector is `:root`, `html`, or a list of only those (root rules). Inside `@layer` they are read the same as outside, following source order only. `:host` is not a root.
    - The rule that writes the border itself. This definition beats the root value (an element's own value beats an inherited one).
    - Modifiers and states whose selector contains that rule (the parent) (`.btn.btn--primary { --ink: … }`). Decided by the cascade of "Borders across rules" (M4).
    - A variable changed by any other rule (`html.dark`, `.theme-x` and so on) is treated as a class theme: compile error.
  - **What is resolved**: `var()` is resolved not only in colours but in every border declaration (`border*`, `border-radius`). With a variable in a shorthand like `border: 1px solid var(--ink)`, resolving it is the only way to know the width and style. Fallbacks (`var(--x, red)`) and variables inside variables are resolved too.
  - **Condition variants**: when a root rule inside `@media` or `@supports` changes a value, each condition is resolved separately (that condition's values over the defaults).
    - Only when the resulting drawing differs from the default, an override rule wrapped in the same condition goes right after the drawn rule. Example: `@media (prefers-color-scheme: dark) { .card { <12 slot variables>; border-image: … } }`
    - It has the same selector and comes later in the source, so it wins only when the condition holds. If the original rule is inside `@media`, it is nested inside that.
    - The shape (seed, flip slot) is the same; only the colour differs.
    - If the colour becomes `transparent` under the condition, the override is `border-image: none`.
  - **Known limits**:
    - Overlap when two conditions hold at once (dark + high contrast and so on) is not resolved; each condition is resolved on its own.
    - `@layer` priority is ignored when deciding variable values.
    - Variables in other files are not looked up. Combine the files first (postcss-import and so on).
- **Output**: the original border declarations stay. Right after the rule's last border declaration (the one that sets width, style or colour) come `border-color: transparent`, 12 neighbour-variant slot variables (`--sk-{seed}-{flip}: var(--sk-<drawing>)`) and `border-image: var(--sk) C / Cpx / <outset>px stretch`. If any of the original declarations is `!important`, all added ones are `!important` too. The drawings themselves and the picking rules appear once at the top of the file (see "Neighbour variants").
- **Trade-off**: theme features that change colour variables with JS at runtime do not reach the borders. SVGs multiply with colours, but SVGs that differ only in colour compress well, so the difference in transfer size (brotli) is small.

### Borders drawn and borders left alone

A border is drawn when the rules on an element (one rule, or a parent with its modifiers and states as in "Borders across rules") give the width, style and colour of all four sides and the radius. When they cannot be known or expressed, the original CSS stays. Warnings (see "Limits and errors") came in M8.

| Case | Treatment |
| --- | --- |
| Four sides with the same px width (including `thin`, `medium`, `thick` = 1, 3, 5px), all `solid`, all the same literal colour | Drawn |
| The above written with `var()` and resolvable in the same file ("Colour resolution") | Resolved and drawn; condition variants too when a condition changes the values |
| All the above except the colour is `currentColor` (including a shorthand without a colour), or a `var()` in a border declaration cannot be resolved | Compile error ("Limits and errors") |
| `--sketch: off` in the rule | Left alone, no error, the declaration is removed from the output |
| Width left out of the `border` shorthand | Drawn as `medium` (3px), as CSS says |
| The same property several times in one rule | The later declaration wins, as in CSS |
| Rules inside `@media`, `@supports`, `@layer` | Drawn like ordinary rules |
| `border-radius` the same px on all four corners, 32px or less | Drawn with that radius; square corners without a radius |
| Radius over 32px (pills, circles) | Not drawn; the original CSS border shows. The element's size is unknown, so the corner slices would outgrow the element and the drawing would almost vanish (decided in M4). Sketched pills and circles are later work |
| A style other than `solid` (dashed, dotted, double, groove, ridge, inset, outset) | Left alone |
| Radius in %, different per corner, elliptical (`/`) | Left alone |
| Width 0, `none`/`hidden`, colour `transparent` | Left alone (no line to draw) |
| Global keyword colours (`inherit` and so on) | Left alone |
| A line on exactly one side (`border-bottom`, an `hr`'s `border-top` and so on) | Drawn as a one-sided line ("One-sided borders, hr, underlines"). If both corners touching that side are rounded, the original CSS border stays |
| Lines on two or three sides (top + bottom, an L shape and so on) | The original CSS border stays. Warning in M8 |
| A rule that changes part of a border (partial rule) | Drawn per "Borders across rules" if its selector contains a parent; otherwise a compile error. A rule that changes only the radius is left alone without a parent |
| Widths in em, rem or other non-px units, different values per side, logical properties (`border-inline-*` and so on) | Left alone |
| A rule that already uses `border-image*`, inside `@keyframes` | Left alone |

## One-sided borders, hr, underlines

A single-line element follows the same principle as a border: the ends stay fixed and only the middle stretches along the length.

- **One-sided borders and hr**: a short Rough.js line is the source, and only that side gets a `border-image` width. 16px at each end stays fixed and only the middle stretches. Stretching the whole source proportionally would stretch the end margins too, and in a long list the dividers would come up 13px short at each end.
- `border-image-outset` cancels the remaining margin so the line reaches the element's ends.
- **Scope** (M5): a border with a line on exactly one side (width > 0, `solid`, a literal colour, variables resolved) and no line on the other three (width 0, `none`/`hidden`, or not set).
  - Both block and inline elements. An inline element that wraps over several lines (a link's `border-bottom`) follows the default `box-decoration-break: slice`: one line split across the line fragments.
  - If both corners touching that side are rounded, it is not drawn and the original CSS border stays. A tab rounded only on the other side (`border-radius: 6px 6px 0 0` + `border-bottom`) is drawn.
  - Borders on only two or three sides keep the original CSS border.
  - `hr` is drawn only when the user's CSS writes it as a one-sided border (`hr { border: 0; border-top: 1px solid … }`). The browser's default `hr` is handled by `@sketchify base` (M7).
- **Output**: the source is one line 152px long (16 at each end + 120 in the middle) and W + 10px thick. The bow is 1.5× a border's. For `border-bottom`:
  - `border-image: <drawing> 0 16 H 16 / 0 16px Hpx 16px / Hpx 3px ((H−W)/2)px 3px stretch`
  - The 3px left and right outset puts the line ends at the element's ends.
  - The bottom outset centres the line on the original border.
  - The top outset H (the side without a drawing) enlarges the area so the drawing does not shrink on thin elements.
  - Other sides work the same way. Neighbour variants (3 seeds × 4 flips) and combination rules (e.g. `.list li:hover { border-bottom-color }`) are the same as for borders.
- **Underlines** (M6d, 2026-11-15): a `text-decoration` underline becomes the same drawing as a one-sided line. The first plan was a background (spec draft, prototype), but a background stays inside the text box, which left the line about 3px of vertical room below the baseline. More wobble cut through the glyphs (Korean final consonants in particular); less looked almost straight. The user decided to switch to `border-image`.
  - **How**: only `border-image`, with no real border. Width and outset are given in px, so it is drawn without a border (confirmed in Chromium and Safari) and the layout stays. The drawing is the same as a one-sided line (`border-bottom`), with the line's centre half its width below the bottom of the text box.
    - `text-decoration-line: none; border-color: transparent; border-image: <drawing> 0 16 H 16 / 0 16px Hpx 16px / Hpx 3px (H/2 + W/2)px 3px stretch` (H = W + 10).
    - An inline element wrapping over several lines gets a line with its own ends on each fragment. Neighbour variants (3 seeds × 4 flips), hover colours and dark-mode condition overrides are the same as for borders.
    - The width is a px `text-decoration-thickness`, or 1.5px. `text-underline-offset` is not reflected.
    - The drawing area is outside the text box, so a parent's `overflow: hidden` can cut the bottom (the same warning as one-sided lines, M8).
  - **Scope** (user decision): inline elements only.
    - The selector's subject type must be an inline-by-default element (`a`, `abbr`, `b`, `cite`, `code`, `dfn`, `em`, `i`, `ins`, `kbd`, `label`, `mark`, `q`, `s`, `samp`, `small`, `span`, `strong`, `sub`, `sup`, `time`, `u`, `var`), or the cascade must give `display: inline`.
    - Other displays and class-only selectors (`.link`) keep the original underline. On a block, the drawing would be one line at the very bottom of the box.
    - Drawn only when the line is `underline` alone and the style is solid (or left out). Double lines, `line-through`, dotted, dashed, double and wavy stay as written.
    - If the same element uses a border drawing (border, fill) or its own `border-image`, the original underline stays (there is one drawing slot). It can go together with a background image or a repeating hatch.
    - Browser default styles (the default underline of `a`) are not read. Only rules that write an underline in CSS are drawn. Defaults are handled by `@sketchify base` (M7).
  - **Colour** (user decision): `text-decoration-color`, or the cascaded `color` when it is missing or currentColor. If neither is known at build time, the original underline stays; no error (an M8 warning candidate). If a condition (dark mode) makes the colour unknown, it is a compile error, as with borders.
  - **Cascade (M4)**: a rule that writes an underline is also a group parent. Rules that change `text-decoration*`, `color` or `display` become members.
    - A hover colour change gets a drawing in that colour; `text-decoration: none` removes the drawing (`border-image: none`).
    - On elements that can no longer be drawn (inherited colour, dotted, their own border), the drawing is removed and `text-decoration-line: underline` brings back the browser underline. A non-underline line (`line-through`) or none is written back as it was.
    - A group with only underlines and more than 16 members keeps the original underline instead of an error (an `a` rule gathers many `… a` rules).

## Fills

The MVP has four fills: solid, rough solid, hatch and marker. Solid keeps the original `background-color`, so `var()` colours keep working. The others fix the colour in the SVG.

| Fill | Implementation (approach A) | Notes |
| --- | --- | --- |
| Solid | The original `background-color` | No SVG, variable colours work |
| Rough solid | A bumpy fill drawn into the same SVG as the border, applied with `border-image`'s `fill` | An SVG per border + fill colour pair |
| Hatch | A repeating pattern as `background-image`, `background-clip: padding-box` | The most hand-made look; can be busy behind text |
| Marker | Drawn into the same SVG as the border, applied with `border-image`'s `fill`, with outset for the parts outside | Odd on large areas |

A fill that must reach outside the element cannot be a background (backgrounds paint only inside the border box), so it is merged into the border's `border-image` SVG.

Each rule picks its fill with `--sketch-fill: solid | rough | hatch | marker`. Without it, solid. Elements with a fill and no border (the inner bar of a progress bar and so on) are handled like any other element.

**Rough solid and marker (decided in M6a)**
- **`--sketch-fill`**:
  - A per-rule value. A value set by another rule is also decided by the cascade of "Borders across rules" (`.btn.btn--hl { --sketch-fill: marker }`). It is not inherited from parent elements (the compiler does not know the DOM).
  - Removed from the output.
  - Values other than `solid`, `rough`, `marker`, `hatch` are a compile error.
- **Fill colour**: the cascaded `background-color`, including the colour of the last layer of a `background` shorthand. Variable resolution, condition (dark mode) variants and errors are the same as for borders. `currentColor` is a "fill colour not known" error.
  - A `transparent` or missing colour means no fill.
  - If the background has an image or gradient, the fill stays as written and only the border is drawn (warning in M8).
- **Output**: border and fill go into one SVG (fill first, line on top). `border-image` gets the `fill` keyword, and `background-color: transparent` is added where the drawing goes to hide the original background. The original declarations stay.
  - A rule in the same group that turns the fill off (`.btn.flat { --sketch-fill: solid }`) or a combination where the fill cannot be drawn gets the original background colour back as written (including `var(--fill)`).
- **Rough solid**: a bumpy rectangle (a rounded rectangle for a rounded border) that fills up to just inside the border line (under the line). Without a border it ends 1.5px inside the element's edge.
- **Marker**: a band with ragged ends. It reaches up to 6px outside the element left and right and 2px up and down (outset), with opacity 0.55 so text and lines show through.
- **Elements without a border**: drawn by giving `border-image-width` in px (confirmed in Chromium and Safari). Without a border, the corner slices are only as big as the fill's corners (rough solid: 2px margin + radius (at least 3); marker: 10px). So a 12px-tall bar or a one-line highlight does not shrink.
- **Not drawn together**: when the border cannot be drawn (dotted, large radius, two or three sides) or is a one-sided line, the fill stays as written too (the drawing shapes differ and cannot be merged).
- **Groups**:
  - A rule that changes the background (`.btn:hover { background-color }`) joins a group, and its combinations, only when some rule of that group draws a fill. Other background rules are left alone and are not an error without a parent.
  - A rule that sets `rough`/`marker` can be a parent without a border.
  - Fills use the same slots as borders (3 seeds × 4 flips), so the shape stays when hover changes the colour.

A hatch draws lines only, without a background colour. The lines are nearly straight, each a little different in weight and bow, with the pressure changing slowly along each line. No change in darkness.

- **Elements of known size**: like Rough.js, each line's two meeting points with the element's outline are computed and the line is drawn between them. The ends are perpendicular to the direction, either `taper` (narrowing) or `square`, default square. Each line ends somewhere between the centre of the border line and 4px outside. Since they reach outside, border and hatch are drawn into one SVG applied with `border-image`. (Decided in M6c, 2026-11-15)
  - Scope: elements with a four-sided sketched border or no border (the same scope as rough solid and marker). With a one-sided line or a border that is not drawn (radius over 32, dashed and so on), it is a repeating hatch. Over the size limit ("Element sizes"), or too small for the corner slices, it is a repeating hatch too.
  - Output: the 9-slice placement (`border-image: var(--sk) k fill / kpx / Opx stretch`) stays; only the source drawing is made at the element's size plus an outer margin (O). `background-color: transparent; background-image: none` hides the original background and other rules' repeating hatches.
    - When the real size equals the computed one, every slice is 1:1. When it differs (flex shrinking, min/max sizes, unknown UA default padding), the layout stays, the corners stay, and only the sides and middle stretch, so the hatch spacing and angle skew a little.
    - Outer margin O = `over` + half the heaviest line + 2px, rounded up to whole px (on the pixel grid, the border's anti-aliasing matches unhatched elements).
  - Border: the same square drawing as an unhatched element, pasted into the drawing the way the browser cuts 9-slice (corners as they are, sides stretched). So its border looks the same as neighbours of unknown size.
  - Line ends: each end of each line is a random value in [`over` outside, border width/2 inside] (without a border, [`over` outside, 0]). Rounded corners use the meeting point with a rounded rectangle of the outer radius.
  - Weight, jitter, pressure and bow follow the hatch options (presets); the pressure period is `pressureLength` ±15%. Points are placed every 24px along the line in relative coordinates (the lines are nearly straight, so this is enough, and the size drops to 1/3).
  - Neighbour variants: 3 seeds × 4 flips = 12 drawings, as for borders. Flips apply only to the border (a flipped hatch would lean as `\` and disagree with the repeating hatch); the hatch gets a different seed per slot.
  - Colours, variables, dark mode, hover and M4 groups are the same as rough solid (a colour change redraws the same shape in that colour). An element whose size is known by default but unknown under a condition is a compile error.
- **Elements of unknown size**: a seamless long hatch laid as a background, visible only inside the padding box. It does not reach outside the border and has no fade-out. (Decided in M6b)
  - Output: `background-color: transparent; background-image: var(--sk-<tile>); background-size: Tpx Tpx; background-repeat: repeat; background-clip: padding-box; background-position: var(--skh, 0 0)`.
    - Only paint properties change, so the layout stays.
    - It is drawn apart from the border drawing (`border-image`), so it goes with four-sided, one-sided or no borders.
  - Tile:
    - Size T = 2 × gap × round(pressureLength / (√2 × gap)). For the default (normal, gap 16), fine (gap 6) and bold (gap 24) it is 192px, and gap always divides T.
    - The lines are x + y = c diagonals. Each line's weight, bow and pressure phase come from a hash that depends only on c mod T, so the same line continues across seams.
    - The pressure swells and thins once every T/√2 (≈ pressureLength) along the line. `gap` is the horizontal spacing of the diagonals (the perpendicular spacing is gap/√2).
  - Neighbour variants:
    - One tile per colour (fine is about 25KB raw, 7KB brotli, so not one per seed; marker presets have fewer lines, about 7–9KB).
    - Neighbours differ only in their start position (0, 61, 127px). The position is set in `--skh` by `:where()` rules using the same index formula as M2 (1 default + 18).
    - These rules go only into files that use a hatch. Custom properties inherit, so every element gets the default first.
  - Colours, variables, dark mode, the `currentColor` error, image backgrounds and M4 groups are the same as rough solid. Condition overrides change only `background-image`.
- The pen ends of hatching on elements of unknown size will be improved with Houdini `paint()` in a later version.

Tried and dropped: offset solid, cross-hatch, dots, hatch over a pale background colour, short broken hatching, fades that blur the ends, tiles stretched to fit the element (`round`, which makes seams and ripples).

## Form controls and @sketchify base

Form controls are drawn with the same approach A (the element's own `border-image`) as other elements. The differences that came from elements that cannot take pseudo-elements are gone.

- **Input, textarea, select**: the border is drawn with the element's own `border-image`. When `:focus` changes the colour, one more SVG with the same shape in the new colour is made.
- **select**: `appearance: none` removes the default arrow and a hand-drawn arrow is drawn. The dropdown list keeps the browser's look.
- **Checkbox, radio**: `appearance: none` removes the default look, and the box/circle and tick/dot are drawn in the background. `:checked` changes the background.
- **Keep the focus ring**: the focus indicator must not be hidden, for keyboard users.
- **`@sketchify base;`**: this one line is replaced by the default sketch styles for form controls and hr. `@layer` and `:where()` make their specificity 0, so user styles always win wherever they are.
- Base does not convert user CSS but replaces the browser's look, so for layout it promises only "as close as possible to the browser's default sizes".

M7 was split into M7a (the base mechanism and default elements) and M7b (polish, the default link underline, buttons) (user decision, 2026-11-15). Decided in M7a:

- **The line**: `@sketchify base;` is replaced by `@layer sketchify-base { … }`. Without it, nothing is added. Writing it twice, or an unknown `@sketchify …`, is a compile error. If the user CSS uses `@layer`, put this line at the top of the file (layer order is the order of first appearance).
- **Colours** (user decision): option `base: { ink, accent, dark?: { ink, accent } }`, default ink `#1d2433` and accent `#2563eb`. `dark` overrides under `@media (prefers-color-scheme: dark)`. Literal colours only.
  - Inside base they are the variables `:root { --skb-ink; --skb-accent }`. Border rules get dark variants through M3 colour resolution. `--sketch-*` names are for controls, so these use `--skb-`.
- **Inputs, textarea, select**: `:where(type) { border: 1px solid var(--skb-ink); border-radius: 4px }`, converted like an ordinary rule and drawn as 9-slice.
  - Inputs are `input` except checkbox, radio, range, color, file, image, hidden and the button types. A selector list inside one `:where()` would be M4's "`:where()` with several candidates", so each type is written separately.
  - Changing the border drops Safari's default text field padding (2px 5px), making it 10px narrower. So text fields get `padding: 2px 4px` and select `2px 28px 2px 4px` (the right side for the arrow). Within 4px of Chrome's and Safari's default sizes.
- **select**: `appearance: none`, a hand-drawn arrow (a 16×14 drawing at 12×10px, 8px from the right). The arrow drawing's `url()` is written into the rule (as a variable, drawing the select border would try to resolve a drawing variable not stored yet, an error).
- **Checkbox, radio**: `appearance: none`, 13×13px, margins as Chrome's defaults (checkbox `3px 3px 3px 4px`, radio `3px 3px 0 5px`). Box/circle (ink) and tick/dot (accent) in the background. `:checked` uses the drawing with the tick/dot.
  - Neighbour variants use the same 12 slots and picking rules as borders (`background-image: var(--sk)`). Flips apply only to the box/circle (no upside-down ticks).
- **hr**: `:where(hr) { border: 0; border-top: 1px solid var(--skb-ink) }`, drawn as a one-sided line. 1px thinner than the browser default (2px).
- **Focus ring** (user decision 2026-11-15, replacing the first "keep the outline"): the browser focus outline of base elements becomes a hand-drawn ring. Text fields are `:focus-visible` even on click, and a straight blue ring did not suit the sketched border.
  - Inputs, textarea, select: on `:focus-visible` the border turns the accent colour, with one more 1.5px sketched ring 2px outside it. Both are in one `border-image`, the ring in the outset, so the layout stays. The border is the same square drawing as before focus, kept inside (in a square larger by the ring's room), so the shape does not jump on focus. 12 neighbour slots.
  - Checkbox, radio: a sketched square/circle ring 2px outside the 13px control (`border-image` without a border, `0 fill / 0 / 5px`).
  - Base writes the focus rules with their drawings complete and uses `--sketch: off` so the compiler does not redraw them.
  - The browser outline is turned off with `outline-style: var(--skb-outline, none)`. If a user rule draws the same element's border itself (its drawing covers the base ring), the focus indicator would disappear; so in files with base, the compiler adds `--skb-outline: auto` to the user rules it draws, keeping the browser outline. `--skb-outline` is registered with `@property` as non-inheriting (outside the layer, right before base).
  - An `outline` written in user CSS is not changed (user decision: base elements only).
  - Depending on macOS settings, Tab in Safari does not stop on checkboxes.
- **Relation to user CSS**: base rules are `:where()` (specificity 0) inside a layer, so user rules outside layers always win. User border rules are converted as before. The compiler's cascade does not compute `@layer` priority, but base selectors are only `:where(type)`, so they never form a group with user rules.
- **Layout tests**: pages with base are left out of the layout-invariance tests and measured separately to be within ±4px of the browser's default sizes.

Decided in M7b (2026-11-15):

- **Links** (user decision): `:where(a:any-link)` gets the accent colour as its text colour and a hand-drawn underline of the same colour. Dark uses the dark accent.
  - Visited links have the same colour (`:visited` cannot change images; browser privacy protection).
  - The underline is the same drawing as M6d (a one-sided line, `border-image` without a border, right below the text box), one drawing. Base writes the rule complete (`--sketch: off`).
  - The drawing is read through the non-inheriting variable `--skb-link`. In files with base, when a rule outside base writes `text-decoration` (or `-line`), the compiler adds `--skb-link: none` to that rule to remove the base underline. Examples: `.nav a { text-decoration: none }`, dotted, a solid underline drawn by M6d (it has its own drawing).
  - Limits: if a page changes only the link text colour, the underline stays in the accent colour (writing `text-decoration: underline` in that rule makes M6d draw it in that colour). A link turned into a block has its underline as one line at the bottom of the box.
- **Buttons** (user decision): `button`, `input[type=submit|button|reset]`.
  - `appearance: none`, a 1px ink border (6px rounded, converted and drawn like an ordinary rule), `padding: 2px 7px` (the same outer size as the browser default 2px border + 1px 6px).
  - Background `color-mix(in srgb, var(--skb-ink) 6%, transparent)`, 10% on hover, 16% when pressed, so dark mode follows. Focus is the same sketched ring as inputs (6px radius).
- **Radio dot**: diameter 6 (on an 18 canvas), 0.3× the wobble. At this size the circle tangles like a loop, so 0.46× the border roughness and an overshoot of at most 0.8 (picked by comparison).
- **Textarea grip**: two hand-drawn diagonals in ink on the `::-webkit-resizer` background (Chromium and Safari, a 15×15 drawing). Dark via `@media`. Firefox keeps its default grip.

## Neighbour variants

Even with the same selector, neighbouring elements, and similar elements elsewhere, must look different. The source is picked by (own index + parent index + grandparent index) and mixed with `:nth-child`.

- There are 3 sources with different seeds (11, 23, 37). Flipping the element itself would flip its text too, so flipped variants (none, horizontal, vertical, both) are made inside the SVG with `<g transform>`. One drawing becomes 12.
- Each source drawing goes into a CSS variable once; the picking rules only decide which variable to use. Even dozens of picking rules add almost nothing to the size.
- **Output structure**:
  - At the top of the file (after `@charset`, `@import` and `@layer a, b;` statements), `:root { --sk-<hash>: url(…); … }` holds each drawing once.
  - Then 22 picking rules:
    - one default `:where(*)`
    - 3 rules picking the flip by own index mod 4
    - 18 `:nth-child(3n+…)` rules picking the seed by (own + parent + grandparent index) mod 3
  - A drawn rule puts its 12 drawings into the slot variables `--sk-{seed}-{flip}` and draws with `border-image: var(--sk)`.
  - The picking rules know no selectors; they only set "which slot" on every element. The `var()` in a variable resolves per element, so each element gets its own rule's drawing. Complex selectors, state rules and rules inside media queries mix without special handling.
  - A complete state rule (`.btn:hover { border: … }`) uses the other-coloured drawing in the same slot, so the shape stays.
  - Shallow elements without a grandparent use the default (seed 0, no flip).
- **Drawing variable names**: `--sk-` followed by 8 hex digits of the FNV-1a 32-bit hash of the drawing. Index-based names would collide between separately compiled CSS files and overwrite each other. Slot and pick variables are `--sk`, `--sk-0` to `--sk-2`, `--sk-{0..2}-{0..3}`.
- **Pseudo-elements**: rules targeting `::before` and other pseudo-elements are not mixed; they write the seed-0 unflipped drawing straight into `border-image`. Pseudo-elements are not matched by picking rules, and inheriting the element's pick could give the wrong drawing.
- A file with no drawn rules gets nothing added.
- **Size** (measured in M2, 5 test pages in total, KB, raw / gzip / brotli):
  - 1 drawing: 24.9 / 6.7 / 5.3
  - 3 seeds: 64.5 / 13.6 / 10.6
  - 3 seeds × 4 flips: 219.1 / 18.5 / 13.5
  - The 4 flips add 27% brotli (+2.9KB) over 3 seeds. A page with many border kinds grew up to +42% (+1.3KB). Uncompressed, 3.4×. Part of the growth is not drawings but the slot variables on each rule (hash names that compress poorly). The absolute amount is small, so the 4 flips stay; revisited in the M8 size report.
- The same rules apply not only to borders but to inputs, select, textarea, checkboxes, radios and avatars (circles).
- Variant rules are wrapped in `:where()` and add no specificity. Per-element exact rules (hatching on elements of known size and so on) must always beat the variant rules.
- A unique seed per element is outside the MVP. Later via a JSX plugin or SSR.

## Options

Options are global only. Per-rule overrides are outside the MVP.

**Silencing warnings** (`quiet`, M8): an array of warning names (the "Limits and errors" table). Unknown names are a compile error.

**Size budget** (`budget`, M8): `{ gzip: KB }` (greater than 0) or `false`. Default gzip +30KB ("Distribution and quality").

**Base colours** (`base`, M7a): `{ ink, accent, dark?: { ink, accent } }`. Default `#1d2433` and `#2563eb`; `dark` only when given. A non-literal colour or an unknown name is a compile error ("Form controls and @sketchify base").

**Roughness** (`roughness`) takes a preset name or a number from 0; default `normal`. A number is used as `roughness`, and the bow and overshoot are interpolated linearly between the presets. 0.6, 1.3 and 2.4 equal subtle, normal and messy exactly; outside this range the slope of the end segment continues, never below 0. Other values are a compile error.

| Preset | roughness | bowing | Overshoot |
| --- | --- | --- | --- |
| subtle | 0.6 | 0.6 | 1.2 |
| normal (default) | 1.3 | 1.2 | 2 |
| messy | 2.4 | 2.2 | 3 |

**Hatch** defaults:

| Option | Default | Meaning |
| --- | --- | --- |
| `gap` | 16px | Line spacing |
| `weight` | 6px | Median line weight |
| `weightJitter` | ±0.15px | Weight difference between lines |
| `pressure` | ±4% | Range of the pressure change within a line |
| `pressureLength` | 136px | Length over which the pressure swells and thins once |
| `bow` | 0.5px | Gentle bow of a line |
| `ends` | square | Line ends on elements of known size: `taper` or `square` |
| `over` | 4px | How far line ends may reach outside the border on elements of known size |

- `gap` must divide the internal repeating drawing's size for the lines to connect. With a value that does not fit, the compiler adjusts the repeat size.
- **Presets** (added at the user's request after M6b): `hatch: 'fine' | 'normal' | 'bold'`. Heavier lines get wider gaps, keeping the line-to-gap ratio close to `normal`. Values settled on 2026-11-15. They live in `HATCH_PRESETS` in `src/options.ts`; to change them, use the slider page (`.tuner/hatch.html`) made by `npm run tune:hatch`. `test/browser/hatch-presets.spec.ts` reads this table and measures the real weight and gap of the drawings.

  | Preset | weight | gap | weightJitter | Rest |
  | --- | --- | --- | --- | --- |
  | `fine` (pen) | 1.9 | 6 | 0.25 | pressure 0.16, rest default (the first spec's default hatch) |
  | `normal` (default, marker) | 6 | 16 | 0.15 | pressure 0.04, rest default |
  | `bold` (marker) | 9 | 24 | 0.2 | same as default (pressure 0.04) |

  - User decision 2026-11-09: the first default (1.9/6) moved to `fine`, and the default without options became the heavier `normal` (3/9). (The `normal` and `bold` values then, 3/9 and 4/12, were provisional and changed with the decision below.)
  - User decision 2026-11-15: `normal` and `bold` look as if drawn with a thick marker. Of the candidates compared, A (normal 6/16, bold 9/24, half line and half gap), with less weight variation (`weightJitter` between lines, `pressure` within a line) so the weight is almost even. `fine` keeps the pen feel (pressure ±16%). These values are final.

  - As an object, part of a `preset` can be changed (`hatch: { preset: 'bold', gap: 10 }`). Without `preset`, `normal` is the base. An unknown preset name is a compile error.
- **Form** (decided in M6b): plugin option `hatch: { gap, weight, weightJitter, pressure, pressureLength, bow, ends, over }`.
  - Numbers are px without a unit; `pressure` is a ratio (0.16 = ±16%).
  - Ranges: gap at least 2, weight greater than 0, weightJitter, bow and over at least 0, pressure 0 to 0.9, pressureLength greater than gap.
  - Values out of range or unknown names are a compile error.
- A larger `pressureLength` makes the repeating drawing larger and the CSS bigger. The docs mention this cost.
- Option docs describe what is visible in the result (spacing, pressure length), not internal concepts such as "tile".

## Element sizes

The compiler does not know an element's real size. So most things use structures that draw the same regardless of size, and only elements of known size are drawn exactly.

- **Borders, one-sided lines, rough solid and marker fills**: 9-slice keeps the texture even regardless of size.
- **Hatch (elements of unknown size)**: a drawing of about 192px (all presets are 192px) tiled like a checkerboard. Spacing, bow and pressure follow the repeat period so lines cross the tile edges without breaks.
- **Elements of known size**: a rule with px `width` and `height` (border-box) or a `--sketch-size: W H` hint counts as known. This is used to draw the hatch exactly, line by line. Each element gets its own SVG, which adds size. (Decided in M6c, user decision 2026-11-15)
  - Size computation: the `width`, `height`, `padding` and `box-sizing` given by the cascade (M4).
    - With `box-sizing: border-box`, width and height are the size. Universal rules in the same file (`*`, `*, ::before, ::after`) join the cascade too.
    - Otherwise (the default content-box), px padding (0 if missing) and border widths (0 for sides without a line, 3px when only a style is given) are added.
    - If any of them is not px (`%`, `em`, `auto`, `calc()`, `inherit`, logical properties such as `padding-inline`), the size is unknown. The `box-sizing: inherit` pattern is unknown too.
  - `--sketch-size: W H` (or `W` for a square): the border-box size, unitless numbers or px, greater than 0. It takes precedence over the computation. A malformed value is a compile error; it is removed from the output.
  - Size rules join a group only when some rule of the group draws a hatch (like background rules). Modifiers must include the parent class (`.card.card--wide { width }`). A separate `.card--wide` cannot be known to be the same element, so it is outside the group and the drawing stretches on that element.
  - Limit: over an area of 480×320px² (153,600), a repeating hatch is drawn. Measured (2026-11-15, one colour, 12 drawings, brotli): 220×120 is normal 6.4KB, fine 14.3KB, bold 4.9KB; 480×320 is normal 17.4KB, fine 42.8KB, bold 13.2KB; 640×480 is 26.9KB, 68.2KB, 20.2KB. The repeating pattern is about 3KB. Each colour (dark, hover) costs as much again.
- Measuring real sizes with a headless browser is outside the MVP.

## Distribution and quality

The PostCSS plugin is the core; the CLI is a thin layer on top. Supported browsers are Chromium-based browsers and Safari.

- **PostCSS plugin**: the default way of use, because the dev server must look like production. Vite, Next.js, webpack and Parcel read `postcss.config.js`, so there are no tool-specific plugins.
- **CLI**: a thin tool around the plugin, for static sites without a build tool and quick tries. It shares the plugin's config file (`sketchify.config.js`). The font options of the prototype are gone. (Decided in M9, 2026-11-16)
  - Usage: `sketchify <files…> [-o out | -d dir] [--watch] [--config path] [--no-report]`, `--help`, `--version` (user decision: including several files and watch mode).
    - One file with `-o`, several with `-d` (same names).
    - Without inputs it reads standard input; without an output it writes standard output.
    - The same path for input and output is an error (protects the original).
  - Output: standard output gets only CSS. Standard error gets the warnings (`file:line:column [sketchify:kind] …`) and one report line per file (`a.css → out/a.css  gzip +1.6KB, 12 drawings (0 combos), 1 warning`). `--no-report` turns off only the report line.
  - Exit codes: 0 success, 1 compile error (with place and message), 2 argument or config file error.
  - `--watch`: converts again when an input or the config file changes, in 100ms bursts. Keeps watching after errors. Needs an output.
  - A closed pipe (`| head`) ends without an error. CLI text is English, like the diagnostics.
- **Config file**: the first of `sketchify.config.js`, `.mjs`, `.cjs` in the current folder, or `--config`. Its default export is the options object. Re-read on every change while watching. The plugin does not read the config file itself; `postcss.config.js` imports it and passes it on (README example).
- **Two packages** (user decision, 2026-11-16):
  - `postcss-sketchify`: the plugin (ESM and CJS), bin `sketchify`, `postcss-sketchify/cli` (`run`, `main`), README (English, user decision), LICENSE (MIT).
  - `sketchify` (`packages/sketchify/`): a small package calling the same CLI, for `npx sketchify` directly. A package that only holds a name can be reclaimed under npm policy, so it was published as a CLI package that is actually used.
  - Both are 0.1.0. The user publishes them, postcss-sketchify first, then sketchify. Remote repository and CI were outside M9 (user decision).
- **Deduplication**: PostCSS processes CSS files one at a time. The MVP reuses the same drawing through a CSS variable within one file only. Deduplication across files is later work.
- **Supported browsers**: Chromium-based (Chrome, Edge, Samsung Internet and so on) and Safari. Confirmed working in Safari. Every browser on iOS uses WebKit, so Safari support covers iPhone and iPad. Firefox is out of scope.
- **Supported Node**: 20 and later (`engines: ">=20"`). Dev tools (tsup, vitest) use versions that run on Node 20, and CI runs Node 20.
- **Size budget** (M8): never fails the build. Only when the added gzip size exceeds the budget does it warn (`[sketchify:budget]`), with the size and the 5 rules that added the most (in the source; a drawing counts for the rule that used it first) (user decision 2026-11-15).
  - The report is always left as a PostCSS message: `{ type: 'sketchify-report', before, after (raw and gzip), drawings, comboRules, comboDrawings, top }` in `result.messages`. The CLI (M9) shows it. No brotli (250–400ms per large file at default quality, on every build).
  - The default budget is gzip +30KB per file. Change it with `budget: { gzip: KB }`; turn it off with `budget: false`.
  - Calibration (2026-11-15, public CSS frameworks and example pages, user decision):

    | CSS | Raw | Added gzip | Added brotli | Drawings |
    | --- | --- | --- | --- | --- |
    | Water.css 2.1.1 | 31.6 → 124.0KB | +6.8KB | +4.0KB | 121 |
    | Example pages (boxes, sketch, theme, base…) | | +1.5–11.4KB | | 12–156 |
    | design-system (25 combinations) | 4.7 → 491.5KB | +22.9KB | +9.5KB | 480 |
    | exact-hatch (12 exact hatches × colours) | 1.9 → 640.2KB | +86.2KB | +26.2KB | 158 |

    Ordinary pages add +2–11KB and the combination-heavy page +23KB. So 30KB lets these through and flags only large growth such as exact hatches.
  - Pico.css 2.0.6 and Bootstrap 5.3.3 could not be measured because of compile errors (127 and 554). Without the failing rules nothing is left to draw. The causes are noted in progress.md "Next".
- **Supported CSS** (user decision 2026-11-16): only hand-written (vanilla) CSS. CSS frameworks (Pico.css, Bootstrap and so on) are out of scope. They rely on attribute themes (`[data-theme]`), component variables changed by modifiers and reset rules that clear borders without a parent, so most of them end in compile errors.

## Limits and errors

A colour not known at build time fails the compile; cases `border-image` cannot express produce warnings.

| Case | Treatment |
| --- | --- |
| `currentColor` border or fill (including `border: 1px solid` without a colour) | Compile error |
| A `var()` whose value cannot be found statically | Compile error |
| A theme variable changed by a class (`html.dark { --ink: … }` and so on). Applies when a variable used by a border (including variables inside variables) is defined by a rule that is neither a root rule, nor the rule itself, nor a rule whose selector contains that rule (the parent) | Compile error |
| A rule changing part of a border without a parent in its selector ("Borders across rules") | Compile error |
| A partial rule's selector has `:is()` or `:where()` with several candidates | Compile error |
| More than 16 rules (modifiers, states, conditions) on one parent | Compile error |
| A border that cannot be drawn with the values changed inside a condition (`@media` and so on), e.g. no longer solid | Compile error |
| A `--sketch` value other than `off` | Compile error |
| A border that is not solid (dashed, dotted, double…) | Warning `style` |
| Different colour or width per side | Warning `mixed` |
| A border on two or three sides only | Warning `sides` |
| A radius over 32px, in %, different per corner or elliptical | Warning `radius` |
| A width not in px (em and so on) | Warning `unit` |
| Only a combination cannot be drawn (each rule can be, but not together) | Warning `combo` |
| Drawing the cells (`table`, `td`, `th`…) of a `border-collapse: collapse` table | Warning `collapse` |
| A `transition` (border, border-color, all) on a drawn rule (the drawing changes at once) | Warning `transition` |
| A parent's `overflow: hidden`, `auto` or `scroll` cuts lines that reach outside | Warning `clip` (only parents known from the front of the selector) |
| Underline colour not known at build time, browser underline kept (M6d) | Warning `underline-color` |
| A fill requested but not drawn because of a background image (M6a) | Warning `fill-image` |
| In a file with base, only the link text colour changes and the base underline no longer matches (M7b) | Warning `link-color` |

**Message language** (user decision 2026-11-18): all text of errors, warnings, option validation and the CLI is English. There is no language option.

**Warnings** (M8, user decision 2026-11-15: all on, silenced by kind): the text starts with `[sketchify:name]`, points at the declaration and says how to turn it off. The option `quiet: ['style', …]` silences kinds; `--sketch: off` leaves one rule out.
- Reasons for not drawing (`style` to `unit`) are reported once, on the group parent. Members report only when their reason differs from the parent's.
- `clip` catches only cases known from selectors (`.card .link` with `.card { overflow: hidden }`). Parents known only from the HTML structure are missed.
- `transition` looks only at `transition` in rules with the same selector as the drawn rule.
- The number of warnings per kind on each example page is guarded by a snapshot (`test/snapshot/__snapshots__/warnings.json`).

**Borders across rules.** `border-image` holds the width, corners and colour in one drawing. In the original CSS each property has its own winning rule, but the drawing is decided by one winning rule as a whole. So when a border is split across rules, the compiler computes the result ahead of time.

- **Principle: draw what the original CSS would show.** For each combination of rules that can apply to one element together (parent, modifiers, states, the same selector inside `@media`), each border property is decided by the original CSS cascade (importance → specificity → source order) and drawn. Custom properties are decided by the same cascade before `var()` is resolved.
- **Parent**: a rule P that sets its border completely (all four sides, or one side completely as in `border-bottom: 1px solid red`; no half-set side) is the parent of rule R when all of these hold (one-sided rules added in M5). Parents are decided by selectors only, never guessed from naming conventions (BEM and so on).
  - P's last compound selector (classes, types, attributes, pseudo-classes) is entirely contained in R's (`.btn` ⊂ `.btn.btn--lg:hover`).
  - P has no leading context, or the same as R. `.toolbar .btn` takes from `.btn`, and combination rules keep the context.
  - The pseudo-element is the same.
  - A P inside a condition (`@media` and so on) is a parent only of R inside the same condition.
  - Rules under the same parent form a "group". Selectors are analysed with postcss-selector-parser.
- **Partial rule**: a rule that sets only some of a side's width, style and colour (`border-color: red`, `border-width: 0`). A one-sided rule that sets the side completely with a side shorthand (`border-bottom: 1px solid red`) is not partial (M5).

| Case | Example | Treatment |
| --- | --- | --- |
| Same selector | `.btn:hover`, `@media { .btn { … } }` | Takes from the original rule |
| Selector contains the parent | `.btn.is-large`, `.btn.btn--large`, `.toolbar .btn` | Takes from the parent rule |
| Partial rule without a parent in its selector | `.btn--large`, `.w2 { border-width }`, `.x { border-color }` | Compile error. Names are not looked at |
| A rule changing only the radius, no parent | `.rounded { border-radius: 8px }` | Left alone (common on elements without a border) |
| Selector list | `.a:hover, .b:hover { border-color }` | Each selector takes separately. If the drawings differ, it is split into per-selector rules after the original |
| `:is()` or `:where()` with several candidates | `:is(.a, .b):hover { border-color }` | Compile error (suggests writing a list) |
| A variable in a rule whose selector contains the parent | `.btn.btn--primary { --btn-ink: blue }` | Treated like changing a border value, and taken |

- The error message suggests three fixes: include the parent in the selector (`.btn.btn--large`), write all border properties (width, style, colour, radius) in that rule, or `--sketch: off`.
- A rule with a `border` shorthand always gets `border-image` written again after it.
- **Combination rules are generated automatically.** Not only modifiers with each other, but states (`:hover` and so on) and same-selector rules inside `@media` combine too.
  - Made only when the currently winning drawing (each rule's drawing and combinations made earlier) differs from the original CSS's result. Examples:
    - Modifiers and states changing the same property (`.btn--primary` and `:hover`, both colour) are not combined. As in the original CSS, the later rule wins.
    - A size modifier and `:hover` are combined (`.btn.btn--lg:hover`).
    - `@media (…) { .btn { border-radius } }` and a colour modifier combine inside that condition (`@media (…) { .btn.btn--primary }`). A modifier that sets its own radius like `.btn--lg` wins in the original CSS too, so it is not combined.
  - The selector joins the member selectors, so its specificity is at least each member's. It goes right after the last member rule in the source, inside the same `@media`/`@layer`, wrapped in the other members' conditions (for nested rules, after the outermost rule with the full selector).
  - At equal specificity, the order of the last member decides, so when two states overlap the later rule wins as in the original CSS.
  - If any border declaration used in the result is `!important`, the combination is `!important` too. If the parent is `!important`, the parent's value wins as in the original CSS.
  - Combination rules also use the 12 slot variables, so the same element keeps its shape when modifiers and states change. Condition (dark mode) overrides are added too.
- **Combination results that cannot be drawn** (`border-style: none`, `dashed`, different colours per side, large radius and so on): the combination gets `border-image: none` and the resulting colour, showing it as the original CSS would. Warning in M8.
- More than 16 members on one parent is a compile error (combinations grow as 2^n).
- Drawings grow with the number of combinations. The size budget warning shows the drawings and size added by combinations separately (M8).
- **Known limits**:
  - Members with different leading contexts (`.toolbar .btn` and `.sidebar .btn`) are not combined.
  - Rules from different groups on one element (`.btn` and `.card`) cannot be known unless the selector names both, so they are not combined. M8 warning case.
  - `@layer` priority is not computed (source order only).

- Error messages come with line numbers and explain how to write an explicit colour or leave the rule out with `--sketch: off`. They also explain that a missing colour means `currentColor`.
  - Variable errors say where to define the variable (`:root`, `html`, the rule itself) and "combine other files with postcss-import".
  - Class theme errors give the place of the rule that changes the value and an example using a media query.
  - Errors are collected and reported at once. The position points at the first error; with several, each is listed with its `line:column`.
- **`--sketch: off`**: a rule with this declaration is not drawn and reports no errors. The declaration is removed from the output. There are no other values yet.
- **Known limits (not handled in the MVP)**: in Windows high contrast mode (`forced-colors`), border colours do not change to system colours; the drawing colours stay.

## Implementation pitfalls

Problems actually hit while building the demos. The compiler can hit them the same way, so they are kept as rules.

| Problem | Rule | With approach A |
| --- | --- | --- |
| The `border` shorthand resets `border-image` too. Later rules (e.g. `:hover { border: … }`) also erase the drawing | In every rule with a `border` shorthand, write `border-image` again after it | New (found in testing) |
| Stretching a line SVG to 100% width keeps its aspect ratio by default, drawing only the middle | `preserveAspectRatio="none"` or 3-slice | Applied (underline) |
| Chrome clips `hr` by default | `overflow: visible` on `hr` | Not applicable. The browser's default `overflow: hidden` does not clip `border-image` (M5, confirmed in Chromium and Safari). Only happened with pseudo-elements |
| On thin elements (a 2px-tall `hr`), when the drawing widths add up to more than the drawing area, the browser shrinks the drawing proportionally, thinning and shifting the line | Add the drawing's thickness as extra `border-image-outset` on the opposite side without a drawing | Applied (found in M5) |
| Repeating a large SVG per variant grew the CSS to 197KB | Put it in a CSS variable once and reuse it (down to 65KB) | Applied |
| PostCSS processes files separately, so index-named drawing variables (`--sk-1`) clash with other files' drawings of the same name and overwrite on `:root` | Name drawing variables by a hash of the drawing | Applied (found while designing M2) |
| `repeat: round` makes seams at tile edges because of fractional sizes | Never stretch repeating drawings | Applied |
| Variant rules override per-element exact rules | Per-element rules get equal or higher specificity and come later | Applied |
| If the hatch gap does not divide the repeat size, lines misalign at the edges | Decide the gap and repeat size together | Applied |
| Heavy hatches (8px and up) end before the tile seam, leaving white notches | Draw the lines past the tile by more than half the weight plus the bow (at least 6px). Line ends snap to points 6px apart, so leave one more point | Applied (found comparing marker weights) |
| `position: relative` for pseudo-elements changes the containing block of `absolute` children | No pseudo-elements | Solved |
| `isolation: isolate` traps tooltips under neighbouring elements | No pseudo-elements | Solved |
| `mask-border` and `mask-image` combine as a union, the `mask` shorthand resets `mask-border`, pseudo-elements cannot receive non-inherited variables | — | Not applicable; no masks |
| Rough solid and marker on elements without a border (`border: none`, width 0) | Drawn when `border-image-width` is given in px. Outer outset works too | Applied (M6a, confirmed in Chromium and Safari) |
| On small elements (a 12px bar, one line of text) the corner slices add up to more than the element and the drawing shrinks | Fills without a border take corner slices only as big as the fill's corners | Applied (found in M6a) |
| A parent's `overflow: hidden` or `auto` cuts lines that reach outside | Warning. Not cut when the parent has padding at least as large as the reach, or with `overflow: clip` + `overflow-clip-margin`. An element's own `overflow: hidden` does not cut its own drawing | Confirmed in Chromium; Safari to be checked |

## Open questions and later work

To finish the MVP spec, the items below had to be decided.

- [x] How to choose the fill: per element with `--sketch-fill`, solid by default
- [x] Elements with a fill and no border: handled like any other element
- [x] Default hatch ends: `square`
- [x] Distribution: PostCSS plugin core + thin CLI
- [x] Supported browsers: Chromium-based and Safari
- [x] Drawing structure: approach A (the element's own `border-image` and background, fixed colours)
- [x] Colours not known at build time: compile error
- [x] Cases `border-image` cannot express: warning
- [x] Whether the border goes blank when hover first swaps the drawing: no problem
- [x] `border-image` on elements without a border: works (Chromium)
- [x] Borders across rules: taken only when the parent is certain; a compile error when it can only be guessed from names
- [x] Combinations of modifiers: generated automatically, included in the size budget warning
- [x] Size of flip variants made with `transform` inside the SVG: brotli +27%, 4 flips kept ("Neighbour variants", size)
- [x] Default size budget: gzip +30KB per file (M8, calibrated with Water.css and the example pages)
- [x] Polish: the checked radio's dot, the textarea resize grip (M7b)

Later versions:

- Tailwind input
- Hatch ends on elements of unknown size: improve with Houdini `paint()`
- A unique seed per element: JSX plugin, SSR
- Measuring real sizes with a headless browser
- Per-rule roughness overrides
- Deduplicating drawings across CSS files
- Firefox support (approach A uses only `border-image`, so most of it likely works; decide on official support after checking). Known issue: when hover swaps the drawing, the border goes blank for one frame and flickers (not in Chrome or Safari).
- Drawing stability and versioning: shapes changing with class names or library updates
- High contrast mode (`forced-colors`)

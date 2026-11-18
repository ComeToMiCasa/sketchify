# M4 cascade test inputs

`test/pages/design-system/` is an example page holding only cases whose result the spec decides. Each rule's "expected" comment is the result M4 must give. This folder holds inputs that must fail. The cases that were open before M4 (states and `@media` × modifiers, descendant combinators, `:is()`, parentless rules, variable modifiers and so on) were decided and moved to docs/spec.md "Borders across rules".

## Inputs that must fail (decided by the spec)

| File | Case | Expected |
| --- | --- | --- |
| `name-only-width.css` | `.btn--large { border-width }`, no `.btn` in the selector | Compile error at 9:23, suggesting three fixes (parent in the selector, write all properties, `--sketch: off`) |
| `name-only-color.css` | `.card--active { border-color }` | Compile error at 6:17 |

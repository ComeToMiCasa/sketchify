# sketchify

Turns the borders, fills and underlines of plain CSS into hand-drawn sketches, without moving a single pixel of layout.

```sh
npx sketchify style.css -o style.sketch.css
npx sketchify a.css b.css -d dist --watch
```

This is the command line of [postcss-sketchify](https://www.npmjs.com/package/postcss-sketchify). To use it in a build (Vite, Next.js, webpack…), install `postcss-sketchify` as a PostCSS plugin instead. See its README for what gets drawn, the options (`sketchify.config.js`) and the messages.

MIT

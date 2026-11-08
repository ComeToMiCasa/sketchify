import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node20',
  // CJS users get the plugin from require('postcss-sketchify') directly, not from .default.
  cjsInterop: true,
  splitting: true,
});

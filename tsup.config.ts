import { defineConfig } from 'tsup';

export default defineConfig([
  // The plugin, for both module systems.
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node20',
    // CJS users get the plugin from require('postcss-sketchify') directly, not from .default.
    cjsInterop: true,
    splitting: true,
  },
  // The `sketchify` command (M9): ESM only, run as a script.
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
]);

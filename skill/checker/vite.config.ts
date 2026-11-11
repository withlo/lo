/**
 * The checker's bundle: one ESM file for Node 20 and later, `dist/checker.js`, with every package
 * it uses inlined, so it runs with Node alone, and `dist/THIRD_PARTY_NOTICES` for those packages.
 * It isn't minified, so it reads as its source does.
 */

import { defineConfig } from 'vite';

import { thirdPartyNotices } from './build/notices.ts';

export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      output: {
        format: 'es',
        entryFileNames: 'checker.js',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    target: 'node',
    // Everything but Node's own modules is bundled.
    noExternal: true,
  },
  plugins: [thirdPartyNotices()],
});

/**
 * The installer's bundle: one ESM file, `dist/install.js`, which the package exports as
 * `@withlo/overview/install` once it's published, with the skill built into it as in the checker's.
 * It holds no code of any package but Node's own, so it needs no notices of its own.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/install.ts',
    target: 'node20',
    outDir: 'dist',
    // The checker's bundle is built first, into the same folder.
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      output: { format: 'es', entryFileNames: 'install.js' },
    },
  },
  ssr: {
    target: 'node',
    noExternal: true,
  },
});

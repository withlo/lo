import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      // Everything main imports is bundled, so the app never loads anything from node_modules.
      externalizeDeps: false,
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      // A sandboxed page's preload is one script with nothing to import, in CommonJS: it can't
      // load modules, as an ES module or otherwise.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/window',
    plugins: [react()],
    build: {
      outDir: 'dist/window',
      rolldownOptions: {
        input: fileURLToPath(new URL('src/window/index.html', import.meta.url)),
      },
      // Fonts and images stay files, served from Lo's scheme. Inlined as data: addresses, the
      // content security policy would block them.
      assetsInlineLimit: 0,
    },
  },
});

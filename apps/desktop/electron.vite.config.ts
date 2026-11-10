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

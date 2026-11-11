import { fileURLToPath } from 'node:url';

import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      // The workspace's packages are TypeScript, and the syntax tokens' names JSON, so they're
      // bundled. The rest load from node_modules, as web-tree-sitter must to find its own
      // WebAssembly.
      externalizeDeps: { exclude: ['@lo/design', '@lo/diff', '@lo/syntax'] },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      // A sandboxed page's preload is one CommonJS script with nothing to import.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/window',
    build: {
      outDir: 'dist/window',
      rolldownOptions: {
        input: fileURLToPath(new URL('src/window/index.html', import.meta.url)),
      },
      // Fonts stay files on the harness's scheme. As data: addresses, the content security policy
      // would block them.
      assetsInlineLimit: 0,
    },
  },
});

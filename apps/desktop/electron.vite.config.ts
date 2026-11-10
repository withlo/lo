import { fileURLToPath } from 'node:url';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/** The fonts' licenses, shipped beside the window's files as the SIL Open Font License asks. */
function fontLicenses(): Plugin {
  const ui = createRequire(createRequire(import.meta.url).resolve('@lo/ui/styles.css'));
  const licenses = {
    'licenses/host-grotesk.txt': '@fontsource-variable/host-grotesk/LICENSE',
    'licenses/fragment-mono.txt': '@fontsource/fragment-mono/LICENSE',
  };
  return {
    name: 'lo:font-licenses',
    apply: 'build',
    generateBundle() {
      for (const [fileName, license] of Object.entries(licenses)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(ui.resolve(license)) });
      }
    },
  };
}

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
    plugins: [react(), tailwindcss(), fontLicenses()],
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

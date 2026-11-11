import { fileURLToPath } from 'node:url';

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';

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

/**
 * The syntax package's grammars and queries, and tree-sitter's own WebAssembly, beside the
 * background process's script, which loads them from its own folder: `syntax/dist/grammars`,
 * `syntax/queries` and `web-tree-sitter.wasm`, as the package and tree-sitter lay them out.
 */
function syntaxFiles(): Plugin {
  const syntax = dirname(dirname(createRequire(import.meta.url).resolve('@lo/syntax')));
  const treeSitter = join(
    dirname(createRequire(join(syntax, 'package.json')).resolve('web-tree-sitter')),
    'web-tree-sitter.wasm',
  );
  const files = (folder: string): string[] =>
    readdirSync(join(syntax, folder), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        posix.join(folder, posix.relative(join(syntax, folder), entry.parentPath), entry.name),
      );
  return {
    name: 'lo:syntax-files',
    apply: 'build',
    generateBundle(_options, bundle) {
      const folders = new Set(
        Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' && output.code.includes('web-tree-sitter.wasm')
            ? [posix.dirname(output.fileName)]
            : [],
        ),
      );
      for (const folder of folders) {
        const at = (name: string) => posix.join(folder, name);
        this.emitFile({
          type: 'asset',
          fileName: at('web-tree-sitter.wasm'),
          source: readFileSync(treeSitter),
        });
        for (const file of [...files('dist/grammars'), ...files('queries')]) {
          if (!/\.(?:wasm|scm)$/.test(file)) continue;
          this.emitFile({
            type: 'asset',
            fileName: at(posix.join('syntax', file)),
            source: readFileSync(join(syntax, file)),
          });
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [syntaxFiles()],
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

// A spec's page: built from its harness into a folder of its own, and opened in a copy of Electron,
// one window that's never shown. As a file, the page loads its script as a plain one: Chromium
// loads no module from a `file:` address.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { _electron as electron, test, type ElectronApplication } from '@playwright/test';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';
import { build } from 'vite';

const electronBinary: unknown = electronPackage;

/** Electron's side: one window, never shown, with the page. */
const MAIN = `
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  void window.loadFile(join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

/**
 * Builds the page `harness/<name>.tsx` (or `.ts`) draws into `#root`, titled `title`, with `style`
 * in its head, and says the folder it's in: one for each worker running at once. A worker started
 * again after a failure takes the place of the one before, and its folder, rather than a new one.
 */
export async function buildPage(entry: string, title: string, style = ''): Promise<string> {
  const name = entry.replace(/\.tsx?$/, '');
  const worker = test.info().parallelIndex;
  const folder = fileURLToPath(new URL(`../test-results/${name}-${worker}/`, import.meta.url));
  mkdirSync(folder, { recursive: true });
  await build({
    configFile: false,
    root: fileURLToPath(new URL('harness/', import.meta.url)),
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: folder,
      emptyOutDir: true,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'harness', fileName: () => `${name}.js` },
    },
  });
  const page =
    `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${style}</style>` +
    `<div id="root" class="lo-app"></div><script src="./${name}.js"></script>`;
  writeFileSync(`${folder}index.html`, page);
  writeFileSync(`${folder}main.cjs`, MAIN);
  writeFileSync(`${folder}package.json`, JSON.stringify({ main: 'main.cjs' }));
  return folder;
}

/** Opens the page `buildPage` built in `folder`, in a copy of Electron of its own. */
export async function launch(folder: string): Promise<ElectronApplication> {
  if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({
    args: [folder],
    executablePath: electronBinary,
    env,
    chromiumSandbox: true,
  });
}

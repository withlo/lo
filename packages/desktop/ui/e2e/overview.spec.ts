// The overview's terms in Chromium itself, where focus moves as it does for a reader: `Tab` from a
// term with its card open goes on to what follows it, as it does with the card closed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';
import { build } from 'vite';

const electronBinary: unknown = electronPackage;

/** Where the page is built, and the Electron main process that opens it. */
const harness = fileURLToPath(new URL('../test-results/harness/', import.meta.url));

/**
 * Electron's side: one window, never shown, with the page. As a file, the page loads its script as
 * a plain one: Chromium loads no module from a `file:` address.
 */
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

const PAGE =
  '<!doctype html><meta charset="utf-8"><title>Overview</title>' +
  '<div id="root" class="lo-app"></div><script src="./overview.js"></script>';

test.beforeAll(async () => {
  mkdirSync(harness, { recursive: true });
  await build({
    configFile: false,
    root: fileURLToPath(new URL('harness/', import.meta.url)),
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: harness,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: 'overview.tsx',
        formats: ['iife'],
        name: 'harness',
        fileName: () => 'overview.js',
      },
    },
  });
  writeFileSync(`${harness}index.html`, PAGE);
  writeFileSync(`${harness}main.cjs`, MAIN);
  writeFileSync(`${harness}package.json`, JSON.stringify({ main: 'main.cjs' }));
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open() {
  if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [harness],
    executablePath: electronBinary,
    env,
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.lo-ov');
  return page;
}

test('Tab goes from each term to the next link and back, its card opening and closing', async () => {
  const page = await open();
  await page.focus('#start');
  /** What has focus, and the open card's term, if a card is open. */
  const where = () =>
    page.evaluate(() => ({
      focus: document.activeElement?.textContent ?? '',
      // A card closing stays a frame, marked closed.
      card: document.querySelector('.lo-hovercard[data-open] .lo-hovercard__term')?.textContent,
    }));

  const forward = [
    { focus: 'bucket', card: 'Bucket' },
    { focus: 'tokens', card: 'Token' },
    { focus: 'the limiter', card: undefined },
    { focus: 'the docs', card: undefined },
    { focus: 'End', card: undefined },
  ];
  for (const stop of forward) {
    await page.keyboard.press('Tab');
    await expect.poll(where).toEqual(stop);
  }

  const back = [];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('Shift+Tab');
    back.push((await where()).focus);
  }
  expect(back).toEqual(['the docs', 'the limiter', 'tokens', 'bucket', 'Start']);
});

test('Esc closes a term’s card and leaves focus on the term, and Tab still goes on', async () => {
  const page = await open();
  await page.focus('#start');
  await page.keyboard.press('Tab');
  await expect(page.locator('.lo-hovercard')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lo-hovercard')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('bucket');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('tokens');
});

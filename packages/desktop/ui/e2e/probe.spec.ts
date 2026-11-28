// A probe, for one CI run only: how a window draws on Linux, shown or not, throttled or not, as
// what's on the page changes each frame or doesn't.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';
import electronPackage from 'electron';

import { test } from './electron.ts';

const binary: unknown = electronPackage;

const MAIN = `
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1200, height: 900, show: process.env.PROBE_SHOW === 'yes',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: process.env.PROBE_THROTTLING !== 'off' },
  });
  void window.loadFile(join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const LINES = Array.from(
  { length: 400 },
  (_, line) => `<div>line ${line} of the text, some words to draw</div>`,
).join('');

for (const show of ['no', 'yes']) {
  for (const throttling of ['on', 'off']) {
    test(`probe: shown ${show}, throttling ${throttling}`, async () => {
      test.setTimeout(120_000);
      const folder = fileURLToPath(
        new URL(`../test-results/probe-${show}-${throttling}/`, import.meta.url),
      );
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        `${folder}index.html`,
        `<!doctype html><meta charset="utf-8"><div id="box" style="width:100px;height:20px;background:red"></div><div id="text">${LINES}</div>`,
      );
      writeFileSync(`${folder}main.cjs`, MAIN);
      writeFileSync(`${folder}package.json`, JSON.stringify({ main: 'main.cjs' }));
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined) env[name] = value;
      }
      delete env.ELECTRON_RUN_AS_NODE;
      env.PROBE_THROTTLING = throttling;
      env.PROBE_SHOW = show;
      if (typeof binary !== 'string') throw new Error('No electron binary.');
      const app = await electron.launch({
        args: [folder],
        executablePath: binary,
        env,
        chromiumSandbox: true,
      });
      try {
        const page = await app.firstWindow();
        await page.waitForFunction(() => document.getElementById('box') !== null, undefined, {
          polling: 100,
        });
        const result = await page.evaluate(async () => {
          const visibility = document.visibilityState;
          const box = document.getElementById('box')!;
          const text = document.getElementById('text')!;
          const sample = (ms: number, change: (frame: number) => void) =>
            new Promise<{ frames: number; maxGap: number }>((resolve) => {
              let frames = 0;
              let gap = 0;
              let last = performance.now();
              const from = last;
              const done = setTimeout(
                () => resolve({ frames, maxGap: Math.round(gap) }),
                ms + 5_000,
              );
              const tick = (now: number) => {
                frames += 1;
                gap = Math.max(gap, now - last);
                last = now;
                change(frames);
                if (now - from < ms) requestAnimationFrame(tick);
                else {
                  clearTimeout(done);
                  resolve({ frames, maxGap: Math.round(gap) });
                }
              };
              requestAnimationFrame(tick);
            });
          const still = await sample(3_000, () => {});
          const small = await sample(3_000, (frame) => {
            box.style.width = `${100 + (frame % 2)}px`;
          });
          const large = await sample(3_000, (frame) => {
            text.style.width = `${600 + (frame % 2) * 50}px`;
          });
          const sized = await sample(3_000, (frame) => {
            text.style.width = `${600 + (frame % 2) * 50}px`;
            void text.getBoundingClientRect();
          });
          return { visibility, still, small, large, sized };
        });
        console.log(
          `PROBE ${JSON.stringify({ show, throttling, platform: process.platform, ...result })}`,
        );
      } finally {
        await app.close();
      }
    });
  }
}

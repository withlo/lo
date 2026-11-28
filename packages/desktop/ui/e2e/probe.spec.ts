// A probe, for one CI run only: how a window that's never shown draws on Linux, throttled or not.

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
    width: 1200, height: 900, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: process.env.PROBE_THROTTLING !== 'off' },
  });
  void window.loadFile(join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

for (const throttling of ['on', 'off']) {
  test(`probe: a window never shown, throttling ${throttling}`, async () => {
    test.setTimeout(240_000);
    const folder = fileURLToPath(new URL(`../test-results/probe-${throttling}/`, import.meta.url));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      `${folder}index.html`,
      '<!doctype html><meta charset="utf-8"><div id="box" style="width:100px;height:20px"></div>',
    );
    writeFileSync(`${folder}main.cjs`, MAIN);
    writeFileSync(`${folder}package.json`, JSON.stringify({ main: 'main.cjs' }));
    for (let run = 0; run < 3; run += 1) {
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env))
        if (value !== undefined) env[name] = value;
      delete env.ELECTRON_RUN_AS_NODE;
      env.PROBE_THROTTLING = throttling;
      const started = performance.now();
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
        const launched = Math.round(performance.now() - started);
        const result = await page.evaluate(async () => {
          const visibility = document.visibilityState;
          const race = <T>(wait: Promise<T>, ms: number) =>
            Promise.race([
              wait,
              new Promise<string>((r) =>
                setTimeout(() => r(`none in ${ms} ms (${visibility})`), ms),
              ),
            ]);
          const at = performance.now();
          const first = await race(
            new Promise<number>((r) =>
              requestAnimationFrame(() => r(Math.round(performance.now() - at))),
            ),
            40_000,
          );
          const sample = async (ms: number) => {
            let frames = 0;
            let gap = 0;
            let last = performance.now();
            const from = last;
            await race(
              new Promise<void>((resolve) => {
                const tick = (now: number) => {
                  frames += 1;
                  gap = Math.max(gap, now - last);
                  last = now;
                  if (now - from < ms) requestAnimationFrame(tick);
                  else resolve();
                };
                requestAnimationFrame(tick);
              }),
              ms + 5_000,
            );
            return { frames, maxGap: Math.round(gap) };
          };
          const start = await sample(3_000);
          let timers = 0;
          const tFrom = performance.now();
          await new Promise<void>((resolve) => {
            const tick = () => {
              timers += 1;
              if (performance.now() - tFrom < 1_000) setTimeout(tick, 0);
              else resolve();
            };
            tick();
          });
          await new Promise((r) => setTimeout(r, 10_000));
          const idleFor = Math.round(performance.now() - tFrom);
          const later = await sample(2_000);
          const box = document.getElementById('box')!;
          const roAt = performance.now();
          box.style.width = '150px';
          const resize = await race(
            new Promise<number>((r) => {
              const o = new ResizeObserver(() => {
                o.disconnect();
                r(Math.round(performance.now() - roAt));
              });
              o.observe(box);
            }),
            10_000,
          );
          return {
            visibility,
            firstFrameMs: first,
            start,
            timersIn1s: timers,
            idleFor,
            later,
            resizeNoticeMs: resize,
            after: document.visibilityState,
          };
        });
        console.log(
          `PROBE ${JSON.stringify({ throttling, run, platform: process.platform, launchedMs: launched, ...result })}`,
        );
      } finally {
        await app.close();
      }
    }
  });
}

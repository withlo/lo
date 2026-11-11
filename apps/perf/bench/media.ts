// The traces and videos beside the report. A trace run opens a pull request with Chromium tracing
// what the DevTools Performance panel shows, then traces a stretch of each thing the bench does; a
// video run records the window as it goes through the diff view's main moves. Neither counts in the
// table: tracing and recording both slow the page.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { _electron as electron } from '@playwright/test';
import type * as Mediabunny from 'mediabunny';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';

import { readManifest } from '../src/data/manifest.ts';
import type { Width } from './results.ts';
import { fling, flingShape, goToFile, holdKey, typeSlowly } from './scenarios.ts';
import {
  focusSide,
  launch,
  pointAt,
  scrollOf,
  settle,
  sleep,
  type Suite,
  traceCategories,
} from './suite.ts';

declare global {
  interface Window {
    /** What Mediabunny's bundle sets, in the window that converts videos. */
    Mediabunny?: typeof Mediabunny;
  }
}
const electronBinary: unknown = electronPackage;

/**
 * Traces `pull` at `width`: its opening, then about eight seconds each of flings and of PageDown,
 * and the keys. With `zR`, only `zR` on that file. Returns the traces written, gzipped.
 */
export async function traceRun(
  pull: string,
  width: Width,
  folder: string,
  zR?: string,
): Promise<string[]> {
  const name = `${pull}-${width}`;
  const startup = join(folder, `${name}-open.json`);
  const suite = await launch(pull, width, zR ? {} : { trace: startup });
  const { app, page } = suite;
  const written: string[] = [];
  const trace = async (segment: string, run: () => Promise<void>): Promise<void> => {
    const file = join(folder, `${name}-${segment}.json`);
    await app.evaluate(async ({ contentTracing }, categories) => {
      await contentTracing.startRecording({
        included_categories: categories,
        excluded_categories: ['*'],
      });
    }, traceCategories);
    await run();
    await app.evaluate(({ contentTracing }, path) => contentTracing.stopRecording(path), file);
    written.push(gzip(file));
  };
  try {
    if (!zR) {
      // Startup tracing writes its file once its 30 seconds are up.
      for (let wait = 0; wait < 60 && !existsSync(startup); wait++) await sleep(1000);
      if (existsSync(startup)) written.push(gzip(startup));
    }
    await settle(page, 1000);
    await focusSide(page, 'new');
    const top = async (): Promise<void> => {
      await page.keyboard.press('g');
      await page.keyboard.press('g');
      await settle(page, 600);
    };
    if (zR) {
      await goToFile(page, pathsOf(pull), zR);
      await settle(page, 1000);
      await trace('zR', async () => {
        await page.keyboard.press('z');
        await page.keyboard.press('R');
        await settle(page, 1500);
      });
      return written;
    }
    await top();
    await trace('keys', async () => {
      for (let step = 0; step < 3; step++) {
        await page.keyboard.press(']');
        await page.keyboard.press('f');
        await settle(page, 300);
      }
      for (let step = 0; step < 3; step++) {
        await page.keyboard.press(']');
        await page.keyboard.press('c');
        await settle(page, 300);
      }
      await page.keyboard.press('G');
      await settle(page, 800);
      await top();
      await page.keyboard.press(']');
      await page.keyboard.press('c');
      await holdKey(page, 'j', 60);
    });
    await top();
    const at = await pointAt(page, 'new');
    await page.mouse.move(at.x, at.y);
    await trace('fling', async () => {
      const started = performance.now();
      while (performance.now() - started < 8000) await fling(suite, at, 1);
      await settle(page, 500);
    });
    await focusSide(page, 'new');
    await top();
    await trace('pagedown', async () => {
      await holdKey(page, 'PageDown', 240);
    });
    return written;
  } finally {
    await app.close();
  }
}

function gzip(file: string): string {
  const zipped = `${file}.gz`;
  writeFileSync(zipped, gzipSync(readFileSync(file)));
  rmSync(file);
  return zipped;
}

function pathsOf(pull: string): string[] {
  return readManifest(pull).files.map((file) => file.path);
}

/**
 * Records `pull` at 1440 px going through the diff view's main moves, in under 90 seconds: it opens,
 * flings to the bottom, pages down, holds `j`, jumps with `]f`, `]c` and `G`, types a comment on
 * each side, crosses with `Tab`, and shows the inline layout. With `zR`, it opens that file's
 * unchanged lines instead. Returns the MP4 written, and how long it is in seconds.
 */
export async function videoRun(
  pull: string,
  folder: string,
  zR?: string,
): Promise<{ mp4: string; seconds: number }> {
  const recordings = join(folder, 'webm');
  const suite = await launch(pull, '1440', { video: recordings });
  const { app, page } = suite;
  try {
    await settle(page, 1000);
    await focusSide(page, 'new');
    const top = async (): Promise<void> => {
      await page.keyboard.press('g');
      await page.keyboard.press('g');
      await settle(page, 800);
    };
    const keys = async (...strokes: string[]): Promise<void> => {
      for (const stroke of strokes) await page.keyboard.press(stroke);
      await settle(page, 700);
    };
    if (zR) {
      await goToFile(page, pathsOf(pull), zR);
      await settle(page, 1500);
      await keys('z', 'R');
      await settle(page, 1000);
      await flingFor(suite, 6000);
    } else {
      await top();
      await flingToBottom(suite);
      await top();
      for (let step = 0; step < 12; step++) await keys('PageDown');
      await top();
      await keys(']', 'c');
      await holdKey(page, 'j', 60);
      for (let step = 0; step < 3; step++) await keys(']', 'f');
      for (let step = 0; step < 3; step++) await keys(']', 'c');
      await keys('G');
      await top();
      await keys(']', 'c', 'j', 'j');
      for (const side of ['new', 'old'] as const) {
        if (side === 'old') await keys('Tab');
        await keys('c');
        await typeSlowly(
          page,
          'This reads well, but the error path still needs a test. Could we keep the old name ' +
            'for one release, so callers have time to move?',
        );
        await settle(page, 500);
        await keys('Escape', 'Escape');
      }
      for (let step = 0; step < 4; step++) await keys('Tab');
      await keys('g', 'i');
      await flingFor(suite, 3000);
      await settle(page, 1000);
      await keys('g', 'i');
    }
    await settle(page, 1000);
  } finally {
    await app.close();
  }
  const video = page.video();
  if (!video) throw new Error('Nothing was recorded.');
  const webm = await video.path();
  const mp4 = join(folder, `${zR ? `${pull}-zR` : pull}.mp4`);
  const seconds = await toMp4(webm, mp4);
  return { mp4, seconds };
}

/** Flings down over the right side for about `ms`. */
async function flingFor(suite: Suite, ms: number): Promise<void> {
  const at = await pointAt(suite.page, 'new');
  await suite.page.mouse.move(at.x, at.y);
  const started = performance.now();
  while (performance.now() - started < ms) await fling(suite, at, 1);
}

/**
 * Flings to the bottom in about 18 seconds: the bench's own flings for the first six, then flings
 * as much stronger as it takes to reach the bottom in the rest, to fit the video.
 */
async function flingToBottom(suite: Suite): Promise<void> {
  await flingFor(suite, 6000);
  const at = await pointAt(suite.page, 'new');
  const started = performance.now();
  for (let fast = 0; fast < 40; fast++) {
    const { top, max } = await scrollOf(suite.page);
    if (top >= max - 1) break;
    const left = Math.max(1, 12 - (performance.now() - started) / 1000);
    const scale = Math.max(1, (max - top) / left / 7800);
    await fling(suite, at, 1, { ...flingShape, first: flingShape.first * scale });
  }
}

/**
 * Converts a WebM to an H.264 MP4, in a hidden Electron window, with Chromium's encoder. Returns
 * how long the video is, in seconds.
 */
export async function toMp4(webm: string, mp4: string): Promise<number> {
  if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [fileURLToPath(new URL('blank.cjs', import.meta.url))],
    executablePath: electronBinary,
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.addScriptTag({
      // The package exports only its modules; its bundle for a page is in the same `dist`.
      path: fileURLToPath(
        new URL('../../bundles/mediabunny.min.cjs', import.meta.resolve('mediabunny')),
      ),
    });
    const encoded = await page.evaluate(async (base64) => {
      const media = window.Mediabunny;
      if (!media) throw new Error('Mediabunny didn’t load.');
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const target = new media.BufferTarget();
      const input = new media.Input({
        source: new media.BufferSource(bytes),
        formats: media.ALL_FORMATS,
      });
      const seconds = await input.computeDuration();
      const conversion = await media.Conversion.init({
        input,
        output: new media.Output({
          format: new media.Mp4OutputFormat({ fastStart: 'in-memory' }),
          target,
        }),
        video: { codec: 'avc', bitrate: media.QUALITY_HIGH },
      });
      if (!conversion.isValid) throw new Error('The video can’t be converted.');
      await conversion.execute();
      const out = new Uint8Array(target.buffer!);
      let text = '';
      for (let at = 0; at < out.length; at += 0x8000) {
        text += String.fromCharCode(...out.subarray(at, at + 0x8000));
      }
      return { base64: btoa(text), seconds };
    }, readFileSync(webm).toString('base64'));
    writeFileSync(mp4, Buffer.from(encoded.base64, 'base64'));
    return encoded.seconds;
  } finally {
    await app.close();
  }
}

/** A file's size in MB, for the log. */
export function sizeOf(path: string): string {
  return `${basename(path)} (${(statSync(path).size / 1e6).toFixed(1)} MB)`;
}

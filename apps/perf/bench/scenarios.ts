// What the bench does to the suite, with real input: wheel events and keys through Chromium's input
// pipeline, as a trackpad's and a keyboard's arrive. They're sent on a clock, as hardware sends
// them, without waiting for the page to take each one: a page that falls behind gets them queued
// or merged, as it would. Nothing sets the scroll position from script, which draws differently
// from real input.

import type { Page } from '@playwright/test';

import type { KeyEntry, Recording } from './recorder.ts';
import type { Blank, Stretch } from './results.ts';
import { frameTimes, inRefreshes, type KeyTimes, percentile, summarizeFrames } from './stats.ts';
import { pointAt, scrollOf, settle, sleep, type Suite } from './suite.ts';

/** The Event Timing API's smallest threshold: keys under it aren't reported. */
export const keyThreshold = 16;

/** How often a trackpad sends wheel events while it scrolls: every frame at 60 Hz. */
const wheelEvery = 1000 / 60;

/**
 * A fling, as a trackpad's momentum sends it: a wheel event every frame, starting at `first` px
 * and slowing by `decay` each event, until it's under `last` px. About 7,800 px over a second.
 */
export const flingShape = { first: 480, decay: 0.94, last: 10 };

/** How often a held key repeats: macOS's fastest key repeat. */
const repeatEvery = 33;

/** Starts recording every frame; `wheel` when the wheel scrolls (`Recorder.start`). */
export async function record(page: Page, wheel = false): Promise<void> {
  await page.evaluate((byWheel) => window.perfBench!.start(byWheel), wheel);
}

/** Stops recording and hands over what it noted. */
export function stopRecording(page: Page): Promise<Recording> {
  return page.evaluate(() => window.perfBench!.stop());
}

/**
 * A stretch's summary from what was recorded, with how far it scrolled, how long it took and how
 * much input it sent. Frame times are counted in whole refreshes of `refresh` ms.
 */
export function stretchOf(
  recording: Recording,
  done: { scrolled: number; ms: number; inputs: number },
  refresh: number,
): Stretch {
  const { frames } = recording;
  const blank: Blank = { frames: 0, oneSided: 0, undrawn: 0, past: 0, worstPx: 0 };
  frames.start.forEach((_, index) => {
    const oneSided = frames.oneSided[index]! > 0;
    // Under half a pixel is rounding, not something missing.
    const undrawn = frames.undrawn[index]! > 0.5;
    const past = frames.past[index]! > 0.5;
    if (oneSided) blank.oneSided++;
    if (undrawn) blank.undrawn++;
    if (past) blank.past++;
    if (oneSided || undrawn || past) blank.frames++;
    blank.worstPx = Math.max(blank.worstPx, frames.undrawn[index]!, frames.past[index]!);
  });
  const times = frameTimes(frames.start);
  return {
    frames: summarizeFrames(inRefreshes(times, refresh)),
    raw: summarizeFrames(times),
    blank,
    worst: Math.max(0, ...frames.worst),
    misaligned: frames.worst.filter((worst) => worst > 0.5).length,
    ...done,
    readMs: percentile(frames.readMs, 95),
    longFrames: recording.longFrames.toSorted((a, b) => b.duration - a.duration).slice(0, 10),
  };
}

/**
 * Flings from where the scroll is to the bottom with the pointer over `side`, a fling after
 * another, or until `limit` px. Records every frame on the way.
 */
export async function flingDown(
  suite: Suite,
  side: 'old' | 'new',
  refresh: number,
  limit = Infinity,
  keep?: (recording: Recording) => void,
): Promise<Stretch> {
  const { page } = suite;
  const at = await pointAt(page, side);
  await page.mouse.move(at.x, at.y);
  const from = await scrollOf(page);
  await record(page, true);
  const started = performance.now();
  let inputs = 0;
  let still = 0;
  let last = from.top;
  while (true) {
    inputs += await fling(suite, at, 1);
    const now = await scrollOf(page);
    if (now.top - from.top >= limit) break;
    // At the bottom, or stuck: the document can still grow as lines are measured, so twice.
    still = now.top >= now.max - 1 || now.top <= last ? still + 1 : 0;
    if (still >= 2) break;
    last = now.top;
  }
  const ms = performance.now() - started;
  await settle(page, 500);
  const recording = await stopRecording(page);
  keep?.(recording);
  const to = await scrollOf(page);
  return stretchOf(recording, { scrolled: to.top - from.top, ms, inputs }, refresh);
}

/**
 * One fling down (`sign` 1) or up (-1) with the pointer at `at`, as the DevTools protocol's mouse
 * wheel events: returns how many it sent.
 */
export async function fling(
  suite: Suite,
  at: { x: number; y: number },
  sign: 1 | -1,
  shape = flingShape,
): Promise<number> {
  const started = performance.now();
  const sent: Promise<unknown>[] = [];
  for (let delta = shape.first; delta >= shape.last; delta *= shape.decay) {
    sent.push(
      suite.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: at.x,
        y: at.y,
        deltaX: 0,
        deltaY: sign * Math.round(delta),
      }),
    );
    await sleep(started + sent.length * wheelEvery - performance.now());
  }
  await Promise.all(sent);
  return sent.length;
}

/**
 * Holds PageDown, with focus in an editor, from where the scroll is to the bottom, or until
 * `limit` px. Records every frame, and the keys' times.
 */
export async function pageDown(
  suite: Suite,
  refresh: number,
  limit = Infinity,
  keep?: (recording: Recording) => void,
): Promise<{ stretch: Stretch; keys: KeyTimes }> {
  const { page } = suite;
  const from = await scrollOf(page);
  const since = await page.evaluate(() => window.perfBench!.now());
  await record(page);
  const started = performance.now();
  const sent: Promise<void>[] = [];
  let still = 0;
  let last = from.top;
  while (true) {
    for (let step = 0; step < 20; step++) {
      sent.push(page.keyboard.down('PageDown'));
      await sleep(started + sent.length * repeatEvery - performance.now());
    }
    const now = await scrollOf(page);
    if (now.top - from.top >= limit) break;
    still = now.top >= now.max - 1 || now.top <= last ? still + 1 : 0;
    if (still >= 2) break;
    last = now.top;
  }
  await Promise.all(sent);
  await page.keyboard.up('PageDown');
  const ms = performance.now() - started;
  await settle(page, 500);
  const recording = await stopRecording(page);
  keep?.(recording);
  const to = await scrollOf(page);
  const keys = await keyTimes(page, since, sent.length);
  const done = { scrolled: to.top - from.top, ms, inputs: sent.length };
  return { stretch: stretchOf(recording, done, refresh), keys };
}

/** The keydowns reported since `since`, as the times of `count` keys. */
export async function keyTimes(page: Page, since: number, count: number): Promise<KeyTimes> {
  const entries = await page.evaluate((from) => window.perfBench!.keys(from), since);
  return timesOf(
    entries.filter((entry) => entry.name === 'keydown'),
    count,
  );
}

/** `count` keys' times from the entries reported for them, at most one each. */
export function timesOf(entries: readonly KeyEntry[], count: number): KeyTimes {
  const reported = entries.slice(0, count);
  return {
    keys: count,
    reported: reported.map((entry) => entry.duration),
    under: keyThreshold,
    parts: reported.map((entry) => ({
      waiting: entry.processingStart - entry.start,
      handling: entry.processingEnd - entry.processingStart,
      toPaint: entry.start + entry.duration - entry.processingEnd,
    })),
  };
}

/** Adds `more` key times to `times`. */
function addTimes(times: KeyTimes, more: KeyTimes): void {
  times.keys += more.keys;
  times.reported.push(...more.reported);
  times.parts.push(...more.parts);
}

/**
 * Presses `prefix` and then `key`, `times` times, and times `key` from its keydown to the next
 * paint: what a person waits for after the key that finishes the command. Between presses it
 * waits for the page to settle, and runs `between` if given.
 */
export async function timeKey(
  page: Page,
  times: number,
  key: string,
  options: { prefix?: string[]; between?: () => Promise<void>; wait?: number } = {},
): Promise<KeyTimes> {
  const result: KeyTimes = { keys: 0, reported: [], under: keyThreshold, parts: [] };
  for (let time = 0; time < times; time++) {
    if (options.between) await options.between();
    for (const stroke of options.prefix ?? []) {
      await page.keyboard.press(stroke);
      await sleep(60);
    }
    const since = await page.evaluate(() => window.perfBench!.now());
    await page.keyboard.press(key);
    await settle(page, options.wait ?? 400);
    // Only one keydown comes after `since`.
    addTimes(result, await keyTimes(page, since, 1));
  }
  return result;
}

/** Holds `key` for `count` repeats, at the key repeat's rate, and times every keydown. */
export async function holdKey(page: Page, key: string, count: number): Promise<KeyTimes> {
  const since = await page.evaluate(() => window.perfBench!.now());
  const started = performance.now();
  const sent: Promise<void>[] = [];
  for (let repeat = 1; repeat <= count; repeat++) {
    sent.push(page.keyboard.down(key));
    await sleep(started + repeat * repeatEvery - performance.now());
  }
  await Promise.all(sent);
  await page.keyboard.up(key);
  await settle(page, 500);
  return keyTimes(page, since, count);
}

/**
 * Types `text` into what has focus, a key at a time, about as fast as a person types, and times
 * each key.
 */
export async function typeSlowly(page: Page, text: string): Promise<KeyTimes> {
  const since = await page.evaluate(() => window.perfBench!.now());
  await page.keyboard.type(text, { delay: 35 });
  await settle(page, 300);
  return keyTimes(page, since, text.length);
}

/**
 * Moves the cursor to the file at `path`, one of the pull request's `paths` in order: from the
 * top, a count before `]f` jumps that many files, and `]f` or `[f` makes up any difference.
 */
export async function goToFile(page: Page, paths: readonly string[], path: string): Promise<void> {
  const target = paths.indexOf(path);
  if (target < 0) throw new Error(`The pull request has no ${path}.`);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await settle(page, 300);
  if (target > 0) {
    for (const digit of String(target)) await page.keyboard.press(digit);
    await page.keyboard.press(']');
    await page.keyboard.press('f');
  }
  await settle(page, 1000);
  for (let step = 0; step < 50; step++) {
    const at = await page.evaluate(() => {
      const spot = window.diffView.cursor()?.at;
      return spot?.kind === 'line' ? spot.at.file : spot?.file;
    });
    if (at === path) return;
    const here = paths.indexOf(at ?? '');
    await page.keyboard.press(here < target ? ']' : '[');
    await page.keyboard.press('f');
    await settle(page, 300);
  }
  throw new Error(`The cursor never reached ${path}.`);
}

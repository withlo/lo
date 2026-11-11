// What the bench does to the suite, with real input through Chromium's input pipeline. Scrolling is
// Chromium's own synthesized scroll gesture, its wheel events paced by the display as a trackpad's
// are. Keys are sent on a clock, as a keyboard sends them, without waiting for the page to take
// each one: a page that falls behind gets them queued, as it would. Nothing sets the scroll
// position from script, which draws differently from real input.

import type { Page } from '@playwright/test';

import type { KeyEntry, LongFrameEntry, Recording } from './recorder.ts';
import type { Blank, Stretch } from './results.ts';
import {
  frameTimes,
  inRefreshes,
  type KeyTimes,
  max,
  percentile,
  summarizeFrames,
} from './stats.ts';
import { pointAt, scrollOf, settle, sleep, type Suite } from './suite.ts';

/** The Event Timing API's smallest threshold: keys under it aren't reported. */
export const keyThreshold = 16;

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
    worst: max(frames.worst) ?? 0,
    misaligned: frames.worst.filter((worst) => worst > 0.5).length,
    ...done,
    readMs: percentile(frames.readMs, 95),
    longFrames: recording.longFrames.toSorted((a, b) => b.duration - a.duration).slice(0, 10),
  };
}

/**
 * Scrolls from where the scroll is to the bottom with the pointer over `side`, at `speed` px a
 * second, or `limit` px. Records every frame on the way.
 */
export async function scrollDown(
  suite: Suite,
  side: 'old' | 'new',
  refresh: number,
  speed: number,
  limit = Infinity,
  keep?: (recording: Recording) => void,
): Promise<Stretch> {
  const { page } = suite;
  const at = await pointAt(page, side);
  await page.mouse.move(at.x, at.y);
  const from = await scrollOf(page);
  await record(page, true);
  const started = performance.now();
  let gestures = 0;
  let still = 0;
  let last = from.top;
  while (true) {
    const left = Math.min(gestureLength, limit - (last - from.top));
    if (left <= 0) break;
    await scrollGesture(suite, at, left, speed);
    gestures++;
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
  return stretchOf(recording, { scrolled: to.top - from.top, ms, inputs: gestures }, refresh);
}

/** How far one gesture scrolls, in px: a long scroll is a run of them. */
const gestureLength = 20_000;

/**
 * Scrolls `distance` px down with the pointer at `at`, at `speed` px a second, through Chromium's
 * own gesture synthesizer: one gesture, its wheel events paced by the display, as a trackpad's
 * are, with no fling at the end. Resolves when the gesture is done.
 */
export async function scrollGesture(
  suite: Suite,
  at: { x: number; y: number },
  distance: number,
  speed: number,
): Promise<void> {
  await suite.cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(at.x),
    y: Math.round(at.y),
    yDistance: -Math.round(distance),
    speed,
    gestureSourceType: 'mouse',
    preventFling: true,
  });
}

/**
 * Holds PageDown, with focus in an editor, from where the scroll is to the bottom, or until
 * `limit` px. Records every frame, and the keys' times. Where PageDown stops moving short of the
 * bottom, it lets go, notes the place, scrolls past it with the wheel, and holds it again; where
 * PageDown keeps going back there, it gives up. `reached` is how far down it got, as a share.
 */
export async function pageDown(
  suite: Suite,
  refresh: number,
  limit = Infinity,
  keep?: (recording: Recording) => void,
  progress?: (line: string) => void,
): Promise<{ stretch: Stretch; keys: KeyTimes; stuck: Stuck[]; reached: number }> {
  const { page } = suite;
  const from = await scrollOf(page);
  const pointer = await pointAt(page, 'new');
  await record(page);
  const started = performance.now();
  const keys = noKeys();
  const stuck: Stuck[] = [];
  let inputs = 0;
  let atBottom = 0;
  /** The furthest the scroll has gone, and how many screens past it the next nudge goes. */
  let furthest = from.top;
  let screens = 1;
  let gaveUp = false;
  while (true) {
    // One hold, until the scroll stops moving or reaches the limit, checked every few repeats.
    const since = await page.evaluate(() => window.perfBench!.now());
    const held = performance.now();
    const sent: Promise<void>[] = [];
    let last = (await scrollOf(page)).top;
    while (true) {
      for (let step = 0; step < 5; step++) {
        sent.push(page.keyboard.down('PageDown'));
        await sleep(held + sent.length * repeatEvery - performance.now());
      }
      const now = await scrollOf(page);
      if (now.top <= last || now.top - from.top >= limit) break;
      last = now.top;
    }
    await Promise.all(sent);
    await page.keyboard.up('PageDown');
    inputs += sent.length;
    await settle(page, 300);
    addTimes(keys, await keyTimes(page, since, sent.length));
    const now = await scrollOf(page);
    if (now.top - from.top >= limit) break;
    if (now.top >= now.max - 1) {
      // The document can still grow as lines are measured, so twice.
      if (++atBottom >= 2) break;
      continue;
    }
    atBottom = 0;
    // A page that was only slow to scroll has moved on by now.
    if (now.top > last + 1) continue;
    // PageDown stopped short of the bottom, or went back to where it stopped before.
    if (now.top > furthest + 1) {
      furthest = now.top;
      screens = 1;
      const at = await page.evaluate(() => {
        const spot = window.diffView.cursor()?.at;
        return spot?.kind === 'line' ? `${spot.at.file}:${spot.at.line}` : (spot?.file ?? '');
      });
      stuck.push({ at, scrollTop: now.top });
      progress?.(`PageDown stopped at ${at}, ${Math.round(now.top)} of ${Math.round(now.max)} px`);
    } else if (screens >= 8) {
      progress?.(`PageDown can't get past ${Math.round(furthest)} px`);
      gaveUp = true;
      break;
    } else {
      screens *= 2;
    }
    // Past it with the wheel, as a person would: a screen past the furthest it went, and more
    // each time PageDown goes back there. PageDown goes on from where the wheel leaves it.
    await suite.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: pointer.x,
      y: pointer.y,
      deltaX: 0,
      deltaY: furthest - now.top + screens * now.screen,
    });
    await settle(page, 200);
  }
  const ms = performance.now() - started;
  await settle(page, 500);
  const recording = await stopRecording(page);
  keep?.(recording);
  const to = await scrollOf(page);
  furthest = Math.max(furthest, to.top);
  const done = { scrolled: furthest - from.top, ms, inputs };
  const reached = gaveUp ? furthest / Math.max(1, to.max) : 1;
  return { stretch: stretchOf(recording, done, refresh), keys, stuck, reached };
}

/** A place PageDown stopped moving short of the bottom: the cursor's file and line, and the scroll. */
export interface Stuck {
  at: string;
  scrollTop: number;
}

/** The keydowns reported since `since`, as the times of `count` keys, with the long frames then. */
export async function keyTimes(page: Page, since: number, count: number): Promise<KeyTimes> {
  const { entries, frames } = await page.evaluate(
    (from) => ({
      entries: window.perfBench!.keys(from),
      frames: window.perfBench!.longFrames(from),
    }),
    since,
  );
  return timesOf(
    entries.filter((entry) => entry.name === 'keydown'),
    count,
    frames,
  );
}

/** `count` keys' times from the entries reported for them, at most one each. */
export function timesOf(
  entries: readonly KeyEntry[],
  count: number,
  longFrames: readonly LongFrameEntry[] = [],
): KeyTimes {
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
    longFrames: [...longFrames],
  };
}

/** No keys yet. */
export function noKeys(): KeyTimes {
  return { keys: 0, reported: [], under: keyThreshold, parts: [], longFrames: [] };
}

/** Adds `more` key times to `times`. */
export function addTimes(times: KeyTimes, more: KeyTimes): void {
  times.keys += more.keys;
  times.reported.push(...more.reported);
  times.parts.push(...more.parts);
  times.longFrames.push(...more.longFrames);
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
  const result = noKeys();
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

// What narrows in Chromium itself, where it's laid out: jsdom lays nothing out. An out-of-date
// overview's callout and a code block's flag are one column only where the button doesn't fit beside
// the text, a path wraps only after a slash, a new thread's comment on its way has the one-line head
// row its card will, lines or none, and a card's head never draws its words under its buttons.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('narrow.tsx', 'Narrow', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('#frame .lo-ov-stale');
  return page;
}

/** Where the callout's parts are, once its frame is `width` wide and laid out, in its own pixels. */
function callout(page: Page, width: number) {
  return page.evaluate(async (wide) => {
    document.querySelector<HTMLElement>('#frame')!.style.width = `${wide}px`;
    // What it gives up is measured as the frame is laid out, before it's painted.
    await window.waits.frames(`the callout laid out ${wide} px wide`, 3);
    const box = document.querySelector<HTMLElement>('#frame .lo-ov-stale')!;
    const rect = (selector: string) => box.querySelector(selector)!.getBoundingClientRect();
    const [banner, icon, title, sub, button] = [
      box.getBoundingClientRect(),
      rect('.lo-i'),
      rect('.lo-ov-stale__title'),
      rect('.lo-ov-stale__sub'),
      rect('.lo-ov-stale__actions button'),
    ];
    return {
      gaveUp: box.getAttribute('data-gave-up') ?? '',
      height: banner.height,
      // The icon's middle on the title's, the button's top under what changed since.
      iconOff: icon.top + icon.height / 2 - (title.top + title.height / 2),
      under: button.top - sub.bottom,
      // Its left edge on the text's.
      left: button.left - title.left,
      // What's under the button, inside the callout: its padding alone.
      below: banner.bottom - button.bottom,
      padding: Number.parseFloat(getComputedStyle(box).paddingBottom),
      subLines:
        sub.height /
        Number.parseFloat(getComputedStyle(box.querySelector('.lo-ov-stale__sub')!).lineHeight),
      beside: button.left > title.right && button.top < sub.bottom,
    };
  }, width);
}

test('the callout keeps its button beside its text while it fits, and is one column once it doesn’t', async () => {
  const page = await open();
  for (const width of [680, 494]) {
    const at = await callout(page, width);
    expect(at.gaveUp, String(width)).toBe('');
    expect(at.beside, String(width)).toBe(true);
  }

  const narrow = await callout(page, 316);
  expect(narrow.gaveUp).toBe('beside');
  expect(narrow.beside).toBe(false);
  expect(Math.abs(narrow.iconOff)).toBeLessThanOrEqual(1);
  expect(narrow.under).toBeCloseTo(8, 0);
  expect(narrow.left).toBeCloseTo(0, 0);
  expect(narrow.below).toBeCloseTo(narrow.padding, 0);
  expect(narrow.subLines).toBeCloseTo(1, 1);

  // What changed since comes in its line, and nothing moves.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('say', { detail: '1 file changed' })),
  );
  await expect(page.locator('.lo-ov-stale__sub')).toHaveText('1 file changed');
  expect((await callout(page, 316)).height).toBe(narrow.height);

  // Wide again, the button is beside its text again.
  expect((await callout(page, 680)).gaveUp).toBe('');
});

/** Where a code block's flag's parts are, once its frame is `width` wide and laid out. */
function flag(page: Page, width: number) {
  return page.evaluate(async (wide) => {
    document.querySelector<HTMLElement>('#flagframe')!.style.width = `${wide}px`;
    await window.waits.frames(`the flag laid out ${wide} px wide`, 3);
    const box = document.querySelector<HTMLElement>('#flagframe .lo-codeblock__flag')!;
    const text = box.querySelector<HTMLElement>('.lo-codeblock__flagtext')!;
    const line = Number.parseFloat(getComputedStyle(text).lineHeight);
    const [strip, icon, words, button] = [
      box.getBoundingClientRect(),
      box.querySelector('.lo-i')!.getBoundingClientRect(),
      text.getBoundingClientRect(),
      box.querySelector('button')!.getBoundingClientRect(),
    ];
    return {
      gaveUp: box.getAttribute('data-gave-up') ?? '',
      // The icon's middle on the text's first line's.
      iconOff: icon.top + icon.height / 2 - (words.top + line / 2),
      lines: Math.round(words.height / line),
      cut: text.scrollWidth > text.clientWidth,
      under: button.top - words.bottom,
      left: button.left - words.left,
      below: strip.bottom - button.bottom,
      // Its padding and the line under it, and no more.
      padding:
        Number.parseFloat(getComputedStyle(box).paddingBottom) +
        Number.parseFloat(getComputedStyle(box).borderBottomWidth),
      beside: button.left > words.right && button.top < words.bottom,
    };
  }, width);
}

test('a code block’s flag keeps its button beside its text while the text shows whole, and is one column once it doesn’t', async () => {
  const page = await open();
  const wide = await flag(page, 680);
  expect(wide.gaveUp).toBe('');
  expect(wide.beside).toBe(true);
  expect([wide.lines, wide.cut]).toEqual([1, false]);

  // As narrow as a code block beside the code in a window 720 px wide.
  const narrow = await flag(page, 300);
  expect(narrow.gaveUp).toBe('beside');
  expect(narrow.beside).toBe(false);
  expect(narrow.lines).toBeGreaterThan(1);
  expect(narrow.cut).toBe(false);
  expect(Math.abs(narrow.iconOff)).toBeLessThanOrEqual(1);
  expect(narrow.under).toBeCloseTo(8, 0);
  expect(narrow.left).toBeCloseTo(0, 0);
  expect(narrow.below).toBeCloseTo(narrow.padding, 0);

  // Wide again, the button is beside its text again.
  expect((await flag(page, 680)).gaveUp).toBe('');
});

test('a path wraps only after a slash, and inside a name only where the name is longer than the line', async () => {
  const page = await open();
  const lines = (box: string) =>
    page.locator(`${box} code`).evaluate((code) => {
      const line = Number.parseFloat(getComputedStyle(code).lineHeight);
      const names = [...code.querySelectorAll('span')].map((name) => ({
        text: name.textContent ?? '',
        lines: Math.round(name.getBoundingClientRect().height / line),
        top: name.getBoundingClientRect().top,
      }));
      return { names, rows: new Set(names.map((name) => name.top)).size };
    });
  const path = await lines('#path');
  // It wraps, and each name, hyphens, dots and spaces and all, is whole on its line.
  expect(path.rows).toBeGreaterThan(1);
  for (const name of path.names) expect(name.lines, name.text).toBe(1);

  const long = await lines('#long');
  expect(long.names.map((name) => name.lines)).toEqual([1, expect.any(Number), 1]);
  expect(long.names[1]!.lines).toBeGreaterThan(1);
});

/**
 * The head rows of the comment on its way in `sent` and of the thread that lands in `landed`, each
 * frame made each of `widths` wide in turn: how wide and tall, and what each gave up.
 */
function heads(page: Page, sent: string, landed: string, widths: readonly number[]) {
  return page.evaluate(
    async ({ frames, each }) => {
      const rows = frames.map((frame) => document.querySelector<HTMLElement>(frame)!);
      const found: { width: number; sent: Head; landed: Head }[] = [];
      for (const width of each) {
        for (const frame of rows) frame.style.width = `${width}px`;
        // One frame: a popover's head fits itself in its own resize observer, made before this one.
        await window.waits.resized(`${frames.join(' and ')} laid out ${width} px wide`, rows[0]!);
        // Each one's head row, the one row drawn with a border under it.
        const [mine, theirs] = rows.map((frame) => {
          const head = frame.querySelector('.border-b')!;
          const { width: wide, height } = head.getBoundingClientRect();
          return { width: wide, height, gaveUp: head.getAttribute('data-gave-up') ?? '' };
        });
        found.push({ width, sent: mine!, landed: theirs! });
      }
      return found;
    },
    { frames: [sent, landed], each: widths },
  );
}

interface Head {
  readonly width: number;
  readonly height: number;
  readonly gaveUp: string;
}

test('a new thread’s comment on its way has the one-line head row its card will, giving up what it does at every width, so nothing moves as the card lands', async () => {
  const page = await open();
  const widths = Array.from({ length: 16 }, (_, step) => 280 + step * 16);
  const seen = await heads(page, '#sent', '#landed', widths);
  for (const { width, sent, landed } of seen) {
    expect(sent, `${width} px`).toEqual(landed);
  }
  // Narrow, it gives up its count, then Resolve's words, and stays one line; wide, nothing.
  expect(seen[0]!.sent.gaveUp).toBe('keys detail labels');
  expect(seen.at(-1)!.sent.gaveUp).toBe('');
  expect(new Set(seen.map(({ sent }) => sent.height)).size).toBe(1);
});

/**
 * Each of `frames`' thread head rows, each frame made each of `widths` wide in turn: what it gave
 * up, whether what its words hold lies within their box, and whether any of it is drawn, and so
 * hit, under its buttons.
 */
function spills(page: Page, frames: readonly string[], widths: readonly number[]) {
  return page.evaluate(
    async ({ selectors, each }) => {
      const rows = selectors.map((frame) => document.querySelector<HTMLElement>(frame)!);
      const found: {
        width: number;
        frame: string;
        gaveUp: string;
        inside: boolean;
        under: boolean;
      }[] = [];
      for (const width of each) {
        for (const frame of rows) frame.style.width = `${width}px`;
        await new Promise<void>((resolve) => {
          const sized = new ResizeObserver(() => {
            sized.disconnect();
            resolve();
          });
          sized.observe(rows[0]!);
        });
        for (const [index, frame] of rows.entries()) {
          const head = frame.querySelector<HTMLElement>('.border-b')!;
          // On screen, where what's drawn there can be hit.
          head.scrollIntoView({ block: 'center' });
          const words = head.firstElementChild!;
          const buttons = head.lastElementChild!.getBoundingClientRect();
          const box = words.getBoundingClientRect();
          const inside = [...words.children].every(
            (part) => part.getBoundingClientRect().right <= box.right + 0.5,
          );
          let under = false;
          for (let x = buttons.left + 1; x < buttons.right; x += 4) {
            const hit = document.elementsFromPoint(x, buttons.top + buttons.height / 2);
            if (!hit.some((element) => head.contains(element))) throw new Error('Not on screen');
            if (hit.some((element) => words.contains(element))) under = true;
          }
          found.push({
            width,
            frame: selectors[index]!,
            gaveUp: head.getAttribute('data-gave-up') ?? '',
            inside,
            under,
          });
        }
      }
      return found;
    },
    { selectors: frames, each: widths },
  );
}

test('a card’s head with no lines to say gives up its count, then Resolve’s words, as soon as its words don’t fit, as its comment on its way does, and never draws them under its buttons', async () => {
  const page = await open();
  const widths = Array.from({ length: 21 }, (_, step) => 200 + step * 16);
  const seen = await heads(page, '#sentone', '#landedone', widths);
  for (const { width, sent, landed } of seen) {
    expect(sent, `${width} px`).toEqual(landed);
  }
  expect(seen[0]!.sent.gaveUp).toBe('keys detail labels');
  expect(seen.at(-1)!.sent.gaveUp).toBe('');
  expect(new Set(seen.map(({ sent }) => sent.height)).size).toBe(1);
  for (const { width, frame, gaveUp, inside, under } of await spills(
    page,
    ['#sentone', '#landedone'],
    widths,
  )) {
    // Until it has nothing left to give up, what it says is whole in its room.
    if (gaveUp !== 'keys detail labels') expect(inside, `${frame} at ${width} px`).toBe(true);
    expect(under, `${frame} at ${width} px`).toBe(false);
  }
});

test('a card’s head with more to say than it has room for, once it has given up all it can, cuts its words at their end rather than drawing them under its buttons', async () => {
  const page = await open();
  const widths = Array.from({ length: 14 }, (_, step) => 200 + step * 16);
  const seen = await spills(page, ['#crowded'], widths);
  expect(seen[0]!.gaveUp).toBe('keys detail labels');
  for (const { width, under } of seen) expect(under, `${width} px`).toBe(false);
});

test('beside the lines, a new thread’s comment on its way has the one-line head its popover will, giving up what it does at every width', async () => {
  const page = await open();
  const widths = Array.from({ length: 21 }, (_, step) => 200 + step * 16);
  const seen = await heads(page, '#sentpop', '#landedpop', widths);
  for (const { width, sent, landed } of seen) {
    expect(sent, `${width} px`).toEqual(landed);
  }
  // Narrow, it gives up Resolve's words and its count, as the popover's head does, and stays one
  // line.
  expect(seen[0]!.sent.gaveUp).toContain('detail');
  expect(new Set(seen.map(({ sent }) => sent.height)).size).toBe(1);
});

// The code view in Chromium itself, where lines and threads take the room they're drawn in: what's
// held on screen for the reader's next input comes with it, and what they read stays where it is,
// side by side and inline: the cursor's line as `j` moves it, the comment box they type in, and the
// thread they click. A change the view takes on its own as the view narrows, lines wrapping anew,
// leaves the line at the top of the screen where it is, and the reader's own scroll as it narrows,
// by key, wheel or jump, goes where it says. A peek opens under its line and closes, leaving the
// line where it is, the sides level, unless it would end below the foot of the screen: then the
// least scroll shows it whole. A word is found where it's drawn, and under the pointer.

import { readFileSync } from 'node:fs';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import type { DiffLayout } from '../src/code/index.ts';
import { buildPage, launch } from './electron.ts';

/** How tall the file's header pinned over the top of the diff is, as `--lo-file-header-h` has it. */
const PINNED = 38;

const STYLE = [
  readFileSync(new URL('../src/code/view.css', import.meta.url), 'utf8'),
  // The tokens the page's own measures need: the room a box brought on screen keeps under it, and
  // the height of the file's header pinned over the top.
  `:root { --lo-sp-8: 8px; --lo-file-header-h: ${PINNED}px; }`,
  'body { margin: 0; } #root { width: 1000px; height: 600px; } .card { background: #ddd; }',
].join('\n');

/** Where the page is built. */
let harness = '';

test.beforeAll(async () => {
  harness = await buildPage('code.ts', 'Code', STYLE);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * The page, its view in `layout`, new line 20 at the top of the screen or `below` pixels below it,
 * and the first `wrapped` lines long enough to wrap; with `height`, in a box that tall.
 */
async function open(
  layout: DiffLayout,
  { wrapped = 0, below = 0, height }: { wrapped?: number; below?: number; height?: number } = {},
): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(
    ({ shown, lines, under, tall }) => {
      if (tall !== undefined) window.harness.setHeight(tall);
      window.harness.open(shown, lines);
      window.harness.scrollTo(20, under);
    },
    { shown: layout, lines: wrapped, under: below, tall: height },
  );
  await frames(page);
  return page;
}

/**
 * The page with three files side by side, as `harness.openFiles` draws them, in a box `height`
 * tall; with `addedLast`, a fourth after them, added whole.
 */
async function openFiles(height?: number, addedLast = false): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(
    ({ tall, last }) => {
      if (tall !== undefined) window.harness.setHeight(tall);
      window.harness.openFiles(last);
    },
    { tall: height, last: addedLast },
  );
  await frames(page);
  return page;
}

/** The page, the file's new version whole, line 20 at the top; with `height`, in a box that tall. */
async function openWhole(height?: number): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate((tall) => {
    if (tall !== undefined) window.harness.setHeight(tall);
    window.harness.openFile(20);
  }, height);
  await frames(page);
  return page;
}

/**
 * The page, its view in `layout`, with the lines above new line 20 long enough to wrap, the last
 * rows of line 19 across the top of the screen and line 20 below them, and the reader's cursor on
 * line 25, on screen, so the jump that put them there is over. As the view narrows, the lines
 * above the screen wrap onto more rows, line 19 among them, which moves the lines on screen down
 * until the view puts them back.
 */
async function wrapping(layout: DiffLayout, below = 30): Promise<Page> {
  const page = await open(layout, { wrapped: 19, below });
  await page.evaluate(() => window.harness.cursor(25));
  await frames(page);
  return page;
}

/** The view narrows to 640 px, and a frame starts before the view has taken it. */
function narrowed(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.harness.narrow(640);
    return window.harness.frames(1);
  });
}

/** Where unchanged line `line` starts, down from the top of the screen. */
function lineTop(page: Page, line: number): Promise<number | undefined> {
  return page.evaluate((at) => window.harness.lineTop(at), line);
}

/** The layout `layout` isn't. */
function other(layout: DiffLayout): DiffLayout {
  return layout === 'split' ? 'inline' : 'split';
}

/** Waits for a few frames, which lay out and measure what changed, and line it up. */
function frames(page: Page): Promise<void> {
  return page.evaluate(() => window.harness.frames(3));
}

/** The unchanged lines all on screen, top to bottom. */
function onScreen(page: Page): Promise<{ line: number; top: number }[]> {
  return page.evaluate(() => window.harness.onScreen());
}

/** Waits until the threads drawn are `ids`, in order, none held. */
async function drawn(page: Page, ids: string[]): Promise<void> {
  const shown = () =>
    page.evaluate(() => ({
      ids: [...document.querySelectorAll<HTMLElement>('[data-thread-id]')].map(
        (each) => each.dataset.threadId,
      ),
      held: document.querySelectorAll('.is-held').length,
    }));
  await expect.poll(shown, { timeout: 20_000 }).toEqual({ ids, held: 0 });
}

/** The same lines are all on screen as `before` were, each within a pixel of where it was. */
async function still(page: Page, before: { line: number; top: number }[]): Promise<void> {
  const after = await onScreen(page);
  expect(after.map((each) => each.line)).toEqual(before.map((each) => each.line));
  near(
    after.map((each) => each.top),
    before.map((each) => each.top),
  );
}

/** Each of `after` is within a pixel of the same of `before`. */
function near(after: (number | undefined)[], before: (number | undefined)[]): void {
  expect(after).toHaveLength(before.length);
  after.forEach((each, index) => expect(Math.abs(each! - before[index]!)).toBeLessThan(1));
}

/** How tall the screen is: the scrolling box, short of a scrollbar across its foot. */
function screenHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('.lo-diffview, .lo-fileview')!.clientHeight);
}

/** How far down the screen the peek ends. */
function peekEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const screen = document.querySelector('.lo-diffview, .lo-fileview')!.getBoundingClientRect();
    return document.querySelector('.lo-diffpeek')!.getBoundingClientRect().bottom - screen.top;
  });
}

/** How tall a row is: from unchanged line 38's top to line 39's, as lines 20 on show. */
async function rowHeight(page: Page): Promise<number> {
  return (await lineTop(page, 39))! - (await lineTop(page, 38))!;
}

/**
 * Where the reveal cases put line 40: the last line wholly on screen, a line with two rows under
 * it above the foot, and a line partly below the foot, `rows` rows above the foot. The peek under
 * each would end below the foot.
 */
const FOOT = [
  { name: 'the last line wholly on screen', rows: 1 },
  { name: 'a line two rows above the foot of the screen', rows: 3 },
  { name: 'a line partly below the foot of the screen', rows: 0.5 },
];

for (const layout of ['split', 'inline'] as const) {
  test.describe(layout === 'split' ? 'Side by side' : 'Inline', () => {
    test('a peek opens and closes under its line, by a thread and a comment box, leaving its line and the lines above where they are, the sides level', async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      const line = lines[5]!.line;
      await page.evaluate(
        (at) => window.harness.threads([{ id: 'above', line: at, height: 60 }], true),
        lines[3]!.line,
      );
      await page.evaluate((at) => window.harness.compose(at), lines[8]!.line);
      await frames(page);
      const above = lines.slice(0, 6).map((each) => each.line);
      const tops = () =>
        page.evaluate((each) => each.map((at) => window.harness.lineTop(at)), above);
      const box = () => page.evaluate(() => window.harness.top('.lo-diffcomposer'));
      const level = () => page.evaluate(() => window.harness.misalignment());
      const before = { tops: await tops(), box: await box() };

      expect(await page.evaluate((at) => window.harness.peek(at), line)).toBe(true);
      await frames(page);
      near(await tops(), before.tops);
      const peek = page.locator('.lo-diffpeek');
      const under = await page.evaluate(() => window.harness.top('.lo-diffpeek'));
      expect(under!).toBeGreaterThan((await lineTop(page, line))!);
      expect((await box())! - before.box!).toBeGreaterThan(200);
      expect(await level()).toBeLessThan(1);
      // What its frame draws in its list, later, scrolls there: the code alone sets its height.
      const list = page.locator('.lo-diffpeek__list');
      expect(await list.evaluate((each) => each.scrollHeight > each.clientHeight)).toBe(true);
      const height = await peek.evaluate((each) => each.getBoundingClientRect().height);
      const opened = [...(await tops()), under, await box()];
      await page.evaluate(() => window.harness.frames(10));
      near(
        [
          ...(await tops()),
          await page.evaluate(() => window.harness.top('.lo-diffpeek')),
          await box(),
        ],
        opened,
      );
      expect(await peek.evaluate((each) => each.getBoundingClientRect().height)).toBe(height);

      expect(await page.evaluate((at) => window.harness.unpeek(at), line)).toBe(true);
      await frames(page);
      await expect(peek).toHaveCount(0);
      near([...(await tops()), await box()], [...before.tops, before.box]);
      expect(await level()).toBeLessThan(1);
    });

    for (const where of ['above', 'below'] as const) {
      test(`a peek opened and closed under a line ${where} the screen, focus in it, leaves the screen where it is`, async () => {
        const page = await open(layout);
        const lines = await onScreen(page);
        // Drawn, though off screen: line 20 is at the top.
        const line = where === 'above' ? 14 : lines.at(-1)!.line + 6;
        await page.evaluate((at) => window.harness.cursor(at), lines[5]!.line);
        await frames(page);
        const before = await onScreen(page);

        expect(await page.evaluate((at) => window.harness.peek(at), line)).toBe(true);
        await frames(page);
        expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
        await still(page, before);
        expect(await page.evaluate((at) => window.harness.unpeek(at), line)).toBe(true);
        await frames(page);
        await still(page, before);
      });
    }

    // Line 20, 18 px tall, partly above the top, 10 px or 2 px of it on screen, or at the top
    // where a jump left it, the cursor on it: the peek under it ends on screen.
    for (const { name, line, below } of [
      { name: 'partly above the top of the screen', line: 20, below: -8 },
      { name: 'all but 2 px above the top of the screen', line: 20, below: -16 },
      { name: 'at the top of the screen, where a jump put it', line: 20, below: 0 },
    ]) {
      test(`a peek under a line ${name} opens under it and closes, the line staying where it is`, async () => {
        const page = await open(layout);
        await page.evaluate(
          (at) => {
            window.harness.cursor(at.line);
            window.harness.scrollTo(at.line, at.below);
          },
          { line, below },
        );
        await frames(page);
        const before = await lineTop(page, line);

        expect(await page.evaluate((at) => window.harness.peek(at), line)).toBe(true);
        await frames(page);
        expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
        near([await lineTop(page, line)], [before]);
        const peek = await page.evaluate(() => window.harness.top('.lo-diffpeek'));
        expect(peek!).toBeGreaterThan(before!);
        expect(await page.evaluate((at) => window.harness.unpeek(at), line)).toBe(true);
        await frames(page);
        near([await lineTop(page, line)], [before]);
      });
    }

    for (const { name, rows } of FOOT) {
      test(`a peek under ${name} comes on screen whole by the least scroll, and stays there`, async () => {
        const page = await open(layout);
        const height = await screenHeight(page);
        const below = height - rows * (await rowHeight(page));
        await page.evaluate((at) => {
          window.harness.cursor(40);
          window.harness.scrollTo(40, at);
        }, below);
        await frames(page);
        const before = (await lineTop(page, 40))!;
        expect(Math.abs(before - below)).toBeLessThan(1);

        expect(await page.evaluate(() => window.harness.peek(40))).toBe(true);
        await frames(page);
        expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
        // It ends at the foot: the line went up as far as the peek ran past it, and no further.
        expect(Math.abs((await peekEnd(page)) - height)).toBeLessThan(1);
        const top = (await lineTop(page, 40))!;
        expect(top).toBeGreaterThan(0);
        expect(top).toBeLessThan(before);
        expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
        // Nothing moves in the frames after the one that brought it on screen.
        const shown = await onScreen(page);
        await page.evaluate(() => window.harness.frames(10));
        await still(page, shown);
        near([await peekEnd(page)], [height]);
        // Closing it scrolls nothing back.
        expect(await page.evaluate(() => window.harness.unpeek(40))).toBe(true);
        await frames(page);
        near([await lineTop(page, 40)], [top]);
      });
    }

    test('a peek under the last line on screen, opened before its code comes, moves nothing as it comes, the wheel’s scroll kept', async () => {
      const page = await open(layout);
      const height = await screenHeight(page);
      const below = height - (await rowHeight(page));
      await page.evaluate((at) => {
        window.harness.cursor(40);
        window.harness.scrollTo(40, at);
      }, below);
      await frames(page);

      expect(await page.evaluate(() => window.harness.peekWaiting(40))).toBe(true);
      await frames(page);
      // On screen whole, as tall as its code can be.
      expect(Math.abs((await peekEnd(page)) - height)).toBeLessThan(1);
      // The reader wheels while the code loads.
      await page.mouse.move(300, 100);
      await page.mouse.wheel(0, -40);
      await frames(page);
      const before = await onScreen(page);
      const end = await peekEnd(page);

      // Its code comes, 12 lines: shorter than the peek, which keeps its height.
      expect(await page.evaluate(() => window.harness.peek(40, 12))).toBe(true);
      await page.evaluate(() => window.harness.frames(10));
      await still(page, before);
      near([await peekEnd(page)], [end]);
    });

    test('a peek taller than the room under its line puts the line at the top, under the file’s pinned header', async () => {
      const page = await open(layout, { height: 300 });
      const below = 300 - (await rowHeight(page));
      await page.evaluate((at) => {
        window.harness.cursor(40);
        window.harness.scrollTo(40, at);
      }, below);
      await frames(page);

      expect(await page.evaluate(() => window.harness.peek(40, 15))).toBe(true);
      await frames(page);
      // At the top, under the header pinned there, within the pixel the scroll rounds to.
      expect(Math.abs((await lineTop(page, 40))! - PINNED)).toBeLessThan(1);
      expect(await peekEnd(page)).toBeGreaterThan(300);
      const shown = await onScreen(page);
      await page.evaluate(() => window.harness.frames(10));
      await still(page, shown);
    });

    test('a peek opened and shown again in one go, under a line partly above the top, opens under it, the line staying where it is', async () => {
      const page = await open(layout);
      await page.evaluate(() => {
        window.harness.cursor(20);
        window.harness.scrollTo(20, -8);
      });
      await frames(page);
      const before = await lineTop(page, 20);

      await page.evaluate(() => {
        window.harness.peek(20);
        window.harness.peek(20, 14);
      });
      await frames(page);
      near([await lineTop(page, 20)], [before]);
      expect((await page.evaluate(() => window.harness.top('.lo-diffpeek')))!).toBeGreaterThan(
        before!,
      );
    });

    test('keys in a peek scroll its code, and never the diff under it', async () => {
      const page = await open(layout);
      const line = (await onScreen(page))[5]!.line;
      await page.evaluate((at) => {
        window.harness.cursor(at);
        window.harness.peek(at, 60);
      }, line);
      await frames(page);
      expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
      const before = await onScreen(page);
      const scrolled = () => page.evaluate(() => window.harness.peekScroll()!);
      for (const key of ['ArrowDown', 'PageDown', 'Space', 'End']) {
        const was = await scrolled();
        await page.keyboard.press(key);
        await frames(page);
        expect(await scrolled()).toBeGreaterThan(was);
      }
      for (const key of ['ArrowUp', 'PageUp', 'Shift+Space', 'Home']) {
        const was = await scrolled();
        await page.keyboard.press(key);
        await frames(page);
        expect(await scrolled()).toBeLessThan(was);
      }
      await still(page, before);
    });

    test('a peek drawn again, as a thread comes under its line, keeps its code where the reader scrolled it', async () => {
      const page = await open(layout);
      const line = (await onScreen(page))[5]!.line;
      await page.evaluate((at) => {
        window.harness.cursor(at);
        window.harness.peek(at, 60);
      }, line);
      await frames(page);
      await page.keyboard.press('PageDown');
      await frames(page);
      const scrolled = await page.evaluate(() => window.harness.peekScroll());
      expect(scrolled).toBeGreaterThan(0);

      await page.evaluate(
        (at) => window.harness.threads([{ id: 'here', line: at, height: 60 }], true),
        line,
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="here"]')).toHaveCount(1);
      expect(await page.evaluate(() => window.harness.peekScroll())).toBe(scrolled);
    });

    test(`focus in a peek off the cursor's line stays there as the layout changes`, async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      await page.evaluate(
        (at) => {
          window.harness.cursor(at.cursor);
          window.harness.peek(at.peek);
        },
        { cursor: lines[2]!.line, peek: lines[12]!.line },
      );
      await frames(page);
      expect(await page.evaluate(() => window.harness.focused())).toBe('peek');

      await page.evaluate((shown) => window.harness.layout(shown), other(layout));
      await frames(page);
      expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
      await page.evaluate((shown) => window.harness.layout(shown), layout);
      await frames(page);
      expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
    });

    test('a word’s anchor is where it’s drawn, and the pointer resting on it says where it is, and leaving it says so', async () => {
      const page = await open(layout);
      const line = (await onScreen(page))[4]!.line;
      const word = (await page.evaluate((at) => window.harness.wordBox(at), line))!;
      const anchor = await page.evaluate((at) => window.harness.anchor(at, 2), line);
      near(
        [anchor?.left, anchor?.top, anchor?.right, anchor?.bottom],
        [word.left, word.top, word.right, word.bottom],
      );
      // Off screen, a word has none.
      expect(await page.evaluate(() => window.harness.anchor(250, 0))).toBeUndefined();

      const middle = (word.top + word.bottom) / 2;
      await page.mouse.move((word.left + word.right) / 2, middle);
      const rests = () => page.evaluate(() => window.harness.rests());
      const rested = expect.objectContaining({ file: 'a', line, column: 0 });
      await expect.poll(rests).toEqual([rested]);
      // Past the end of its line, on no word.
      await page.mouse.move(word.right + 200, middle);
      await expect.poll(rests).toEqual([rested, undefined]);
    });

    test('`j` lets threads waiting and held above the cursor come, and the line it goes to stays where it is, near the foot', async () => {
      const page = await open(layout);
      const first = await onScreen(page);
      const held = first[1]!.line;
      const late = first[3]!.line;
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'held', line, height: 60 }], true),
        held,
      );
      await frames(page);
      // The last line on screen with an unchanged line after it, which `j` goes to.
      const lines = await onScreen(page);
      const cursor = lines.findLast(({ line }) => lines.some((next) => next.line === line + 1))!;
      await page.evaluate((line) => window.harness.cursor(line), cursor.line);
      await frames(page);
      // Grown with no input, as when an image in it loads, it's held as it was drawn.
      await page.evaluate(() => window.harness.grow('held', 140));
      await expect(page.locator('[data-thread-id="held"]')).toHaveClass(/is-held/);
      await page.evaluate(
        (at) =>
          window.harness.threads([
            { id: 'held', line: at.held, height: 140 },
            { id: 'late', line: at.late, height: 120 },
          ]),
        { held, late },
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate((line) => window.harness.lineTop(line), cursor.line + 1);

      await page.keyboard.press('j');
      await drawn(page, ['held', 'late']);
      await frames(page);
      const after = await page.evaluate((line) => window.harness.lineTop(line), cursor.line + 1);
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('typing in a comment box lets a thread waiting above it come, and the box stays where it is', async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      const late = lines[2]!.line;
      await page.evaluate((line) => window.harness.compose(line), lines[10]!.line);
      await frames(page);
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'late', line, height: 120 }]),
        late,
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate(() => window.harness.top('.lo-diffcomposer'));

      await page.keyboard.type('x');
      await drawn(page, ['late']);
      await frames(page);
      const after = await page.evaluate(() => window.harness.top('.lo-diffcomposer'));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a click on a thread lets a thread waiting above it come, and the one clicked stays under the pointer', async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      const late = lines[2]!.line;
      const clicked = lines[10]!.line;
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'clicked', line, height: 80 }], true),
        clicked,
      );
      await frames(page);
      await page.evaluate(
        (at) =>
          window.harness.threads([
            { id: 'late', line: at.late, height: 120 },
            { id: 'clicked', line: at.clicked, height: 80 },
          ]),
        { clicked, late },
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate(() => window.harness.top('[data-thread-id="clicked"]'));

      await page.click('[data-thread-id="clicked"] .card');
      await drawn(page, ['late', 'clicked']);
      await frames(page);
      const after = await page.evaluate(() => window.harness.top('[data-thread-id="clicked"]'));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    // A peek or comment box under line 19, wrapped, whose last rows are across the top, then the
    // view's width changing: the first line on screen stays where it is, as with neither.
    for (const opened of ['peek', 'comment box'] as const) {
      for (const widths of [[640], [1300], [640, 1000]]) {
        test(`a ${opened} under a wrapped line partly above the top, then the view ${widths.join(' px, then ')} px wide, leaves the first line on screen where it is`, async () => {
          const page = await wrapping(layout);
          await page.evaluate((kind) => {
            if (kind === 'peek') window.harness.peek(19);
            else window.harness.compose(19);
          }, opened);
          await frames(page);
          const before = await lineTop(page, 20);
          expect(before).toBeGreaterThan(0);

          for (const width of widths) {
            await page.evaluate((to) => window.harness.narrow(to), width);
            await frames(page);
            near([await lineTop(page, 20)], [before]);
          }
        });
      }

      test(`a ${opened} under a wrapped line partly above the top, the view narrowing the frame after, leaves the first line on screen where it is`, async () => {
        const page = await wrapping(layout);
        const before = await page.evaluate(
          (kind) =>
            new Promise<number | undefined>((resolve) => {
              if (kind === 'peek') window.harness.peek(19);
              else window.harness.compose(19);
              requestAnimationFrame(() => {
                const top = window.harness.lineTop(20);
                window.harness.narrow(640);
                resolve(top);
              });
            }),
          opened,
        );
        await frames(page);
        expect(before).toBeGreaterThan(0);
        near([await lineTop(page, 20)], [before]);
      });
    }

    test('the view narrowing leaves the line at the top where it is', async () => {
      const page = await wrapping(layout);
      const before = await page.evaluate(() => window.harness.lineTop(20));

      await page.evaluate(() => window.harness.narrow(640));
      await frames(page);
      const after = await page.evaluate(() => window.harness.lineTop(20));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a thread above the screen that changes as the view narrows leaves the line at the top where it is', async () => {
      const page = await wrapping(layout);
      await page.evaluate(() =>
        window.harness.threads([{ id: 'above', line: 18, height: 60 }], true),
      );
      await frames(page);
      // Drawn, and all of it above the screen.
      await expect(page.locator('[data-thread-id="above"]')).toHaveCount(1);
      expect(
        await page.evaluate(() => window.harness.top('[data-thread-id="above"]')),
      ).toBeLessThan(-60);
      const before = await page.evaluate(() => window.harness.lineTop(20));

      // It grows with no input, so the view takes the change in a frame of its own, keeping what's
      // at the top of the screen; the view narrows at the start of that frame, as when a panel
      // opens beside it then.
      await page.evaluate(() => window.harness.growAsItNarrows('above', 140, 640));
      await frames(page);
      const after = await page.evaluate(() => window.harness.lineTop(20));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a new line typed in a comment box as the view narrows leaves the box where it is', async () => {
      const page = await wrapping(layout);
      // Holding as many lines as it shows with none, so the next makes it taller.
      await page.evaluate(() => window.harness.compose(30, 'one\ntwo\nthree'));
      await frames(page);
      const box = () => page.evaluate(() => window.harness.top('.lo-diffcomposer'));
      const height = () =>
        page.locator('.lo-diffcomposer').evaluate((each) => each.getBoundingClientRect().height);
      const before = { top: await box(), height: await height() };

      // The box grows with the new line as the key is handled, at the width the key came at.
      await page.evaluate(() => window.harness.narrowOnKey(640));
      await page.keyboard.press('Enter');
      await frames(page);
      expect(await height()).toBeGreaterThan(before.height);
      expect(Math.abs((await box())! - before.top!)).toBeLessThan(1);
    });

    test('the cursor moved below the screen as the view narrows comes on screen', async () => {
      const page = await wrapping(layout);

      // The editor brings it on screen as it next measures, at the new width.
      await page.evaluate(() => {
        window.harness.cursor(80);
        window.harness.narrow(640);
      });
      await frames(page);
      expect(await page.evaluate(() => window.harness.cursorOnScreen())).toBe(true);
    });

    test('a jump is over once the layout changes, so the view narrowing after leaves the screen where it is', async () => {
      const page = await open(layout);
      await page.evaluate((shown) => window.harness.layout(shown), other(layout));
      await frames(page);
      const before = await lineTop(page, 20);

      await page.evaluate(() => window.harness.narrow(640));
      await frames(page);
      expect(Math.abs((await lineTop(page, 20))! - before!)).toBeLessThan(1);
    });

    // The reader's input as the view narrows, or as it's still putting back what the narrowing
    // moved: the narrowing is put back, the input's scroll never is.
    for (const when of ['as', 'after'] as const) {
      const narrowing = when === 'as' ? 'as the view narrows' : 'a frame after the view narrows';

      test(`\`Ctrl-d\` ${narrowing} scrolls half a screen from what the reader saw, the cursor staying on its row`, async () => {
        const page = await wrapping(layout, 0);
        // `Ctrl-d` is Vim's key.
        await page.evaluate(() => window.harness.vim(true));
        const cursor = () => page.evaluate(() => window.harness.cursorTop());
        const before = { cursor: await cursor(), line: await lineTop(page, 40) };

        if (when === 'as') await page.evaluate(() => window.harness.narrowOnKey(640));
        else await narrowed(page);
        await page.keyboard.press('Control+d');
        await frames(page);
        expect(Math.abs((await cursor())! - before.cursor!)).toBeLessThan(1);
        expect(before.line! - (await lineTop(page, 40))!).toBeGreaterThan(200);
      });

      test(`\`PageDown\` ${narrowing}, with Vim keys off, goes a page on from what the reader saw`, async () => {
        const page = await wrapping(layout, 0);
        const before = await lineTop(page, 40);

        if (when === 'as') await page.evaluate(() => window.harness.narrowOnKey(640));
        else await narrowed(page);
        await page.keyboard.press('PageDown');
        await frames(page);
        // A page is most of the screen, which is more than the narrowing moves anything.
        expect(before! - (await lineTop(page, 40))!).toBeGreaterThan(400);
      });

      test(`the wheel ${narrowing} scrolls as far as it turns from what the reader saw`, async () => {
        const page = await wrapping(layout);
        await page.mouse.move(300, 300);
        const before = await lineTop(page, 40);

        if (when === 'as') await page.evaluate(() => window.harness.narrowOnWheel(640));
        else await narrowed(page);
        await page.mouse.wheel(0, 200);
        await frames(page);
        expect(Math.abs((await lineTop(page, 40))! - (before! - 200))).toBeLessThan(1);
      });

      test(`a jump ${narrowing} puts its line at the top`, async () => {
        const page = await wrapping(layout);

        // Made before the frame the view takes the narrowing in, there or as it starts.
        await page.evaluate((now) => {
          window.harness.narrow(640);
          if (now) window.harness.scrollTo(60);
          else requestAnimationFrame(() => window.harness.scrollTo(60));
        }, when === 'as');
        await frames(page);
        expect(Math.abs((await lineTop(page, 60))!)).toBeLessThan(1);
      });
    }
  });
}

for (const where of ['above', 'below'] as const) {
  test(`in the whole file, a peek opened and closed under a line ${where} the screen, focus in it, leaves the screen where it is`, async () => {
    app = await launch(harness);
    const page = await app.firstWindow();
    await page.waitForFunction(() => 'harness' in window);
    await page.evaluate(() => window.harness.openFile(20));
    await frames(page);
    const lines = await onScreen(page);
    const line = where === 'above' ? 14 : lines.at(-1)!.line + 6;
    await page.evaluate((at) => window.harness.fileCursor(at), lines[5]!.line);
    await frames(page);
    const before = await onScreen(page);

    expect(await page.evaluate((at) => window.harness.filePeek(at), line)).toBe(true);
    await frames(page);
    expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
    await still(page, before);
    expect(await page.evaluate((at) => window.harness.filePeek(at, false), line)).toBe(true);
    await frames(page);
    await still(page, before);
  });
}

test('in the whole file, a peek under a line partly above the top of the screen opens under it, the line staying where it is', async () => {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(() => {
    window.harness.openFile(20);
    window.harness.fileCursor(20);
  });
  await frames(page);
  await page.evaluate(() => window.harness.fileScrollTo(20, -8));
  await frames(page);
  const before = await lineTop(page, 20);
  expect(before).toBeLessThan(0);

  expect(await page.evaluate(() => window.harness.filePeek(20))).toBe(true);
  await frames(page);
  near([await lineTop(page, 20)], [before]);
  expect(await page.evaluate(() => window.harness.filePeek(20, false))).toBe(true);
  await frames(page);
  near([await lineTop(page, 20)], [before]);
});

for (const { name, rows } of FOOT) {
  test(`in the whole file, a peek under ${name} comes on screen whole by the least scroll, and stays there`, async () => {
    app = await launch(harness);
    const page = await app.firstWindow();
    await page.waitForFunction(() => 'harness' in window);
    await page.evaluate(() => window.harness.openFile(20));
    await frames(page);
    const height = await screenHeight(page);
    const below = height - rows * (await rowHeight(page));
    // The cursor two lines up, on screen: the whole file keeps the cursor's line all on screen,
    // and a line's menu opens a peek under a line partly off it.
    await page.evaluate((at) => {
      window.harness.fileCursor(38);
      window.harness.fileScrollTo(40, at);
    }, below);
    await frames(page);
    const before = (await lineTop(page, 40))!;
    expect(Math.abs(before - below)).toBeLessThan(1);

    expect(await page.evaluate(() => window.harness.filePeek(40))).toBe(true);
    await frames(page);
    expect(await page.evaluate(() => window.harness.focused())).toBe('peek');
    expect(Math.abs((await peekEnd(page)) - height)).toBeLessThan(1);
    const top = (await lineTop(page, 40))!;
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(before);
    const shown = await onScreen(page);
    await page.evaluate(() => window.harness.frames(10));
    await still(page, shown);
    near([await peekEnd(page)], [height]);
    expect(await page.evaluate(() => window.harness.filePeek(40, false))).toBe(true);
    await frames(page);
    near([await lineTop(page, 40)], [top]);
  });
}

test('in the whole file, a peek under the last line on screen, opened before its code comes, moves nothing as it comes, the wheel’s scroll kept', async () => {
  const page = await openWhole();
  const height = await screenHeight(page);
  const below = height - (await rowHeight(page));
  await page.evaluate((at) => {
    window.harness.fileCursor(38);
    window.harness.fileScrollTo(40, at);
  }, below);
  await frames(page);

  expect(await page.evaluate(() => window.harness.filePeekWaiting(40))).toBe(true);
  await frames(page);
  expect(Math.abs((await peekEnd(page)) - height)).toBeLessThan(1);
  await page.mouse.move(300, 100);
  await page.mouse.wheel(0, -40);
  await frames(page);
  const before = await onScreen(page);
  const end = await peekEnd(page);

  // Its code comes, 9 lines.
  expect(await page.evaluate(() => window.harness.filePeek(40))).toBe(true);
  await page.evaluate(() => window.harness.frames(10));
  await still(page, before);
  near([await peekEnd(page)], [end]);
});

test('in the whole file, a peek taller than the room under its line puts the line at the very top', async () => {
  const page = await openWhole(200);
  const below = 200 - (await rowHeight(page));
  await page.evaluate((at) => {
    window.harness.fileCursor(38);
    window.harness.fileScrollTo(40, at);
  }, below);
  await frames(page);

  expect(await page.evaluate(() => window.harness.filePeek(40))).toBe(true);
  await frames(page);
  // At the top, within the pixel the scroll rounds to.
  expect(Math.abs((await lineTop(page, 40))!)).toBeLessThan(1);
  expect(await peekEnd(page)).toBeGreaterThan(200);
  const shown = await onScreen(page);
  await page.evaluate(() => window.harness.frames(10));
  await still(page, shown);
});

test('closing a comment box with `Esc` leaves its line where it is, above the screen', async () => {
  const page = await open('split');
  const line = (await onScreen(page))[10]!.line;
  await page.evaluate((at) => window.harness.compose(at), line);
  await frames(page);
  // The reader wheels the box's line off the top, the box on screen with focus in it.
  await page.mouse.move(300, 500);
  await page.mouse.wheel(0, (await lineTop(page, line))! + 40);
  await frames(page);
  await expect(page.locator('.lo-diffcomposer')).toHaveCount(1);
  const before = await lineTop(page, line);
  expect(before).toBeLessThan(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.lo-diffcomposer')).toHaveCount(0);
  await frames(page);
  expect(Math.abs((await lineTop(page, line))! - before!)).toBeLessThan(1);
});

test('with Vim keys off, the cursor line’s number is marked and the caret doesn’t blink', async () => {
  const page = await open('split');
  await page.evaluate(() => window.harness.cursor(25));
  await frames(page);
  await expect(page.locator('.cm-lineNumbers .cm-activeLineGutter').first()).toBeVisible();
  const blink = await page
    .locator('.cm-cursorLayer')
    .first()
    .evaluate((layer) => getComputedStyle(layer).animationDuration);
  expect(blink).toBe('0s');
});

test('a comment box opened under the last line on screen comes on screen whole, 8 px clear of the foot', async () => {
  const page = await open('split');
  const lines = await onScreen(page);
  await page.evaluate((at) => window.harness.compose(at), lines.at(-1)!.line);
  await frames(page);
  const under = await page.locator('.lo-diffcomposer').evaluate((box) => {
    const foot = document.querySelector('#root')!.getBoundingClientRect().bottom;
    return foot - box.getBoundingClientRect().bottom;
  });
  expect(Math.abs(under - 8)).toBeLessThan(1);
});

test('a comment box that grows as lines are typed in it keeps its foot 8 px clear of the pane’s', async () => {
  const page = await open('split');
  const lines = await onScreen(page);
  await page.evaluate((at) => window.harness.compose(at), lines.at(-1)!.line);
  await frames(page);
  const box = page.locator('.lo-diffcomposer');
  const tall = (await box.boundingBox())!.height;
  await page.keyboard.type('one');
  for (const line of ['two', 'three', 'four', 'five', 'six']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await frames(page);
  expect((await box.boundingBox())!.height).toBeGreaterThan(tall);
  const under = await box.evaluate((each) => {
    const foot = document.querySelector('#root')!.getBoundingClientRect().bottom;
    return foot - each.getBoundingClientRect().bottom;
  });
  expect(Math.abs(under - 8)).toBeLessThan(1);
});

test('equal runs of empty space look equal, at the end of the last file too, and a side with none of a file’s lines is never hatched', async () => {
  const page = await openFiles();
  const spacers = async () => {
    const all = await page.evaluate(() => window.harness.spacers());
    const of = (path: string) => all.filter((each) => each.path === path && each.height > 1);
    return { a: of('src/a.ts'), b: of('src/b.ts'), c: of('src/c.ts') };
  };
  // src/a.ts and src/c.ts each end with three lines the old side doesn't have; src/b.ts has no old
  // side at all.
  await expect
    .poll(async () => {
      const { a, b, c } = await spacers();
      return {
        a: a.map(({ look }) => look),
        b: b.map(({ look }) => look),
        c: c.map(({ look }) => look),
      };
    })
    .toEqual({ a: ['hatched'], b: ['flat'], c: ['hatched'] });
  const { a, c } = await spacers();
  expect(Math.abs(a[0]!.height - c[0]!.height)).toBeLessThan(1);
});

test('an added file’s gap looks the same last in the diff as before another file, its gutter not filled in', async () => {
  const page = await openFiles(undefined, true);
  const spacers = async () => {
    const all = await page.evaluate(() => window.harness.spacers());
    const of = (path: string) => all.filter((each) => each.path === path && each.height > 1);
    return { b: of('src/b.ts'), d: of('src/d.ts') };
  };
  // src/b.ts's gap is caught up above src/c.ts's header, and src/d.ts's below its own.
  await expect
    .poll(async () => {
      const { b, d } = await spacers();
      return { b: b.map(({ look }) => look), d: d.map(({ look }) => look) };
    })
    .toEqual({ b: ['flat'], d: ['flat'] });
  const { b, d } = await spacers();
  expect(Math.abs(b[0]!.height - d[0]!.height)).toBeLessThan(1);
});

test('the next file’s header pushes the pinned row up as it comes under it, and the row is that file’s once it reaches the top', async () => {
  const page = await openFiles(100);
  const pinned = () => page.evaluate(() => window.harness.pinned());
  // src/c.ts's header 20 px below the top edge: src/b.ts's row, pushed up by the rest of its height.
  await page.evaluate(() => window.harness.headerAt('src/c.ts', 20));
  await frames(page);
  const pushed = await pinned();
  expect(pushed?.path).toBe('src/b.ts');
  const shift = Number(/translateY\((-?[\d.]+)px\)/.exec(pushed?.transform ?? '')?.[1]);
  expect(Math.abs(shift + (PINNED - 20))).toBeLessThan(1);
  // Past the top edge, it's src/c.ts's, in place.
  await page.evaluate(() => window.harness.headerAt('src/c.ts', -10));
  await frames(page);
  expect(await pinned()).toEqual({ path: 'src/c.ts', transform: '' });
});

/** Each box on `page`: its width, and whether what's drawn at either end of its middle is the box. */
function boxesOn(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.lo-diffcomposer')].map((box) => {
      const rect = box.getBoundingClientRect();
      const middle = rect.top + Math.min(rect.height / 2, 40);
      // Clear of the pane's scrollbar, which takes the pointer over what's under it.
      const ends = [rect.left + 4, rect.right - 24].map((x) =>
        box.contains(document.elementFromPoint(x, middle)),
      );
      return { width: Math.round(rect.width), whole: ends.every(Boolean) };
    }),
  );
}

test('side by side and narrow, a box on the new side alone reaches over the old side', async () => {
  const page = await open('split');
  await page.evaluate(() => {
    window.harness.narrow(560);
    window.harness.compose(24);
  });
  await frames(page);
  const [alone] = await boxesOn(page);
  expect(alone!.width).toBeGreaterThan(400);
  expect(alone!.whole).toBe(true);
});

test('side by side and narrow, a box takes both sides, and two boxes, one on each side, cover nothing of each other', async () => {
  const page = await open('split');
  const boxes = () => boxesOn(page);
  await page.evaluate(() => {
    window.harness.narrow(560);
    window.harness.compose(22, '', 'old');
  });
  await frames(page);
  // Alone, the old side's box reaches over the new side, over everything there.
  const [alone] = await boxes();
  expect(alone!.width).toBeGreaterThan(400);
  expect(alone!.whole).toBe(true);
  await page.evaluate(() => window.harness.compose(24));
  await frames(page);
  // With one on each side, each keeps its own, and both are whole.
  const both = await boxes();
  expect(both).toHaveLength(2);
  for (const each of both) expect(each).toMatchObject({ whole: true });
  expect(Math.max(...both.map((each) => each.width))).toBeLessThan(280);
});

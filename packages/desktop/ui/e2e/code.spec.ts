// The code view in Chromium itself, where lines and threads take the room they're drawn in: what's
// held on screen for the reader's next input comes with it, and what they read stays where it is,
// side by side and inline: the cursor's line as `j` moves it, the comment box they type in, and the
// thread they click. A change the view takes on its own as the view narrows, lines wrapping anew,
// leaves the line at the top of the screen where it is, and the reader's own scroll as it narrows,
// by key, wheel or jump, goes where it says. A peek opens under its line and closes, leaving the
// line where it is, the sides level, unless it would end below the foot of the screen: then the
// least scroll shows it whole. A word is found where it's drawn, and under the pointer. Beside
// lines, threads, their popover and a comment box in it lay out no row other than the same diff
// does without them.

import { readFileSync } from 'node:fs';

import type { ElectronApplication, Page } from '@playwright/test';

import type { DiffLayout } from '../src/code/index.ts';
import { buildPage, expect, launch, test } from './electron.ts';

/** How tall the file's header pinned over the top of the diff is, as `--lo-file-header-h` has it. */
const PINNED = 38;

const STYLE = [
  readFileSync(new URL('../src/code/view.css', import.meta.url), 'utf8'),
  // The tokens the page's own measures need: the room a box brought on screen keeps under it, the
  // height of the file's header pinned over the top, the narrowest a side is drawn, and how wide an
  // edge's grip is.
  `:root { --lo-sp-8: 8px; --lo-file-header-h: ${PINNED}px; --lo-side-min-w: 240px; --lo-splitter-w: 8px; }`,
  'body { margin: 0; } #root { width: 1000px; height: 600px; } .card { background: #ddd; }',
].join('\n');

/** Where the page is built, once in each worker. */
const harness = () => buildPage('code.ts', 'Code', STYLE);

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
  {
    wrapped = 0,
    below = 0,
    height,
    added = 0,
  }: { wrapped?: number; below?: number; height?: number; added?: number } = {},
): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(
    ({ shown, lines, under, tall, more }) => {
      if (tall !== undefined) window.harness.setHeight(tall);
      window.harness.open(shown, lines, more);
      window.harness.scrollTo(20, under);
    },
    { shown: layout, lines: wrapped, under: below, tall: height, more: added },
  );
  await frames(page);
  return page;
}

/**
 * The page with three files side by side, as `harness.openFiles` draws them, in a box `height`
 * tall; with `addedLast`, a fourth after them, added whole.
 */
async function openFiles(height?: number, addedLast = false): Promise<Page> {
  app = await launch(await harness());
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
  app = await launch(await harness());
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
 * Where the reveal cases put line 40: partly below the foot of the screen, its top half a row above
 * it, so the peek under it would end below the foot. `peek.test.ts` works out where the line goes
 * from other places too, the last line wholly on screen and one two rows above the foot.
 */
const FOOT_ROWS = 0.5;

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

    test('a peek under a line partly below the foot of the screen comes on screen whole by the least scroll, and stays there', async () => {
      const page = await open(layout);
      const height = await screenHeight(page);
      const below = height - FOOT_ROWS * (await rowHeight(page));
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
    // view's width changing, wider, or narrower and then wider: the first line on screen stays
    // where it is, as with neither, at each width.
    for (const opened of ['peek', 'comment box'] as const) {
      for (const widths of [[1300], [640, 1000]]) {
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
    app = await launch(await harness());
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
  app = await launch(await harness());
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

test('in the whole file, a peek under a line partly below the foot of the screen comes on screen whole by the least scroll, and stays there', async () => {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(() => window.harness.openFile(20));
  await frames(page);
  const height = await screenHeight(page);
  const below = height - FOOT_ROWS * (await rowHeight(page));
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

for (const layout of ['split', 'inline'] as const) {
  test(`${layout}, beside lines, threads, a pinned popover and a comment box lay out every row as the same diff without them`, async () => {
    const page = await open(layout, { wrapped: 6 });
    const rows = () => page.evaluate(() => window.harness.rows());
    await page.evaluate(() => window.harness.threadsMode('beside'));
    // Side by side, the sides split unevenly, as a drag on the seam leaves them.
    if (layout === 'split') await page.evaluate(() => window.harness.sides(0.62));
    await frames(page);
    const bare = await rows();
    // Every line the threads go on is drawn, so its row is measured.
    for (const editor of bare) expect(editor.lines.length).toBeGreaterThan(50);
    // A thread on a line of each side, one up a range, a resolved one and one on the file.
    await page.evaluate(() =>
      window.harness.markedThreads([
        { id: 'one', line: 9 },
        { id: 'range', line: 41, from: 33 },
        { id: 'old', side: 'old', line: 22, resolved: true },
        { id: 'file' },
      ]),
    );
    await frames(page);
    // Each has its mark, the file's in its header.
    await expect(page.locator('.lo-threadlane .lo-bubble')).toHaveCount(3);
    await expect(page.locator('.lo-diffhead__bubble').first()).toBeAttached();
    expect(await rows()).toEqual(bare);
    expect(await page.evaluate(() => window.harness.pin('range'))).toBe(true);
    await expect(page.locator('.lo-threadpop [data-thread-id="range"]')).toBeVisible();
    await frames(page);
    expect(await rows()).toEqual(bare);
    await page.evaluate(() => {
      window.harness.closePopover();
      window.harness.compose(26, 'A new comment');
    });
    await frames(page);
    await expect(page.locator('.lo-threadpop .lo-diffcomposer')).toHaveCount(1);
    expect(await rows()).toEqual(bare);
    // Between lines the same threads take room in the flow, which the rows show.
    await page.evaluate(() => window.harness.threadsMode('between'));
    await frames(page);
    expect(await rows()).not.toEqual(bare);
  });
}

/**
 * The page side by side with every line long enough to wrap, new line 20 the first under the
 * pinned header, 10 px below it.
 */
async function wrappedUnderPin(): Promise<Page> {
  return open('split', { wrapped: 300, below: PINNED + 10 });
}

/** Where the edge between the sides is, and how far down it reaches, while it's shown. */
function seam(page: Page) {
  return page.evaluate(() => window.harness.seam());
}

/** How wide each side is drawn. */
function sideWidths(page: Page): Promise<{ old: number; new: number }> {
  return page.evaluate(() => window.harness.sideWidths());
}

/** The view's box on the page, and how wide it shows its sides, short of a scrollbar. */
function viewBox(page: Page): Promise<{ left: number; top: number; room: number }> {
  return page.evaluate(() => {
    const box = document.querySelector('.lo-diffview')!;
    const { left, top } = box.getBoundingClientRect();
    return { left, top, room: box.clientWidth };
  });
}

test('the edge between the sides follows the pointer within its limits, the rows level and the first line under the pinned header where it is in every frame', async () => {
  const page = await wrappedUnderPin();
  const { left, top, room } = await viewBox(page);
  const before = await lineTop(page, 20);
  expect(before).toBeGreaterThan(PINNED);
  const edge = (await seam(page))!;
  expect(edge.x - left).toBeCloseTo(room / 2, 0);
  // It reaches from under the pinned header.
  expect(edge.top - top).toBeCloseTo(PINNED, 0);

  const y = top + 300;
  await page.mouse.move(edge.x, y);
  await page.mouse.down();
  // Each move is drawn, lined up and put back in its own frame, before it's painted.
  for (const x of [470, 400, 330, 300, 360, 640, 720]) {
    await page.mouse.move(left + x, y);
    expect((await sideWidths(page)).old).toBeCloseTo(x, 0);
    expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
    near([await lineTop(page, 20)], [before]);
  }
  // A quarter of the width is the least either side is drawn.
  await page.mouse.move(left + 100, y);
  expect((await sideWidths(page)).old).toBeCloseTo(room / 4, 0);
  await page.mouse.move(left + room - 20, y);
  expect((await sideWidths(page)).new).toBeCloseTo(room / 4, 0);
  await page.mouse.move(left + 700, y);
  await page.mouse.up();
  await frames(page);
  const shares = await page.evaluate(() => window.harness.shares());
  expect(shares).toHaveLength(1);
  expect(shares[0]! * room).toBeCloseTo(700, 0);
  expect((await sideWidths(page)).old).toBeCloseTo(700, 0);
  near([await lineTop(page, 20)], [before]);
});

test('`Esc` puts the edge between the sides back where the press found it, and a double-click puts the sides even', async () => {
  const page = await open('split', { wrapped: 300 });
  const { room, top } = await viewBox(page);
  await page.evaluate(() => window.harness.sides(0.4));
  await frames(page);
  expect((await sideWidths(page)).old).toBeCloseTo(0.4 * room, 0);
  const edge = (await seam(page))!;
  await page.mouse.move(edge.x, top + 300);
  await page.mouse.down();
  await page.mouse.move(edge.x + 200, top + 300);
  expect((await sideWidths(page)).old).toBeCloseTo(0.4 * room + 200, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await frames(page);
  expect((await sideWidths(page)).old).toBeCloseTo(0.4 * room, 0);
  expect(await page.evaluate(() => window.harness.shares())).toEqual([]);

  await page.mouse.dblclick(edge.x, top + 300);
  await frames(page);
  expect((await sideWidths(page)).old).toBeCloseTo(room / 2, 0);
  expect(await page.evaluate(() => window.harness.shares())).toEqual([undefined]);
  expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
});

test('the sides shared anew leave the first line under the pinned header where it is, and at 480 px split evenly with no edge', async () => {
  const page = await wrappedUnderPin();
  const { room } = await viewBox(page);
  const before = await lineTop(page, 20);
  for (const share of [0.3, 0.75, undefined]) {
    await page.evaluate((to) => window.harness.sides(to), share);
    await frames(page);
    expect((await sideWidths(page)).old).toBeCloseTo((share ?? 0.5) * room, 0);
    expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
    near([await lineTop(page, 20)], [before]);
  }
  await page.evaluate(() => {
    window.harness.sides(0.3);
    window.harness.narrow(480);
  });
  await frames(page);
  const { old, new: added } = await sideWidths(page);
  expect(Math.abs(old - added)).toBeLessThan(1);
  expect(await seam(page)).toBeUndefined();
});

/** The layout drawn, whether the view says it's too narrow for two sides, and what it said so. */
function drawnLayout(page: Page) {
  return page.evaluate(() => window.harness.drawn());
}

test('a side-by-side diff narrower than 480 px draws inline, and side by side again at 480, the line at the top of the screen staying where it is, the cursor and focus too', async () => {
  const page = await open('split', { below: 10 });
  await page.evaluate(() => window.harness.cursor(26));
  await frames(page);
  const top = await lineTop(page, 20);
  for (const [width, layout] of [
    [479, 'inline'],
    [480, 'split'],
    [400, 'inline'],
    [720, 'split'],
  ] as const) {
    await page.evaluate((wide) => window.harness.narrow(wide), width);
    await frames(page);
    expect((await drawnLayout(page)).layout).toBe(layout);
    near([await lineTop(page, 20)], [top]);
    expect(await page.evaluate(() => window.harness.cursorOnScreen())).toBe(true);
    // Focus stays in the code, in the editor drawn now.
    expect(await page.evaluate(() => document.activeElement?.closest('.cm-content') !== null)).toBe(
      true,
    );
    if (layout === 'split') {
      expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
    } else expect(await seam(page)).toBeUndefined();
  }
  // It said so each time the box crossed 480 px, and never changed what it was asked for.
  expect((await drawnLayout(page)).said).toEqual([true, false, true, false]);
});

// A key pressed in the code that opens or closes a panel beside it, as `⌘⇧\` does, takes the box
// across 480 px in the frame after: the layout changes, and the cursor moves to it, though not as
// the key moved it.
for (const [from, to] of [
  [400, 720],
  [720, 400],
] as const) {
  test(`a key that ${to > from ? 'widens' : 'narrows'} the diff across 480 px leaves the line at the top where it is, and a cursor the wheel took off screen off it`, async () => {
    const page = await open('split', { below: 10 });
    await page.evaluate((wide) => window.harness.narrow(wide), from);
    await frames(page);
    // Focus in the code, the cursor on line 26, and then the wheel takes it off screen.
    await page.evaluate(() => window.harness.cursor(26));
    await frames(page);
    await page.mouse.move(150, 300);
    await page.mouse.wheel(0, 600);
    await frames(page);
    expect(await page.evaluate(() => window.harness.cursorOnScreen())).toBe(false);
    const [first] = await onScreen(page);

    await page.evaluate((wide) => window.harness.narrowOnKey(wide), to);
    // A key nothing is bound to, the reader's all the same; and past the frames the view holds the
    // line at the top for, as a key keeps the cursor on screen for a while.
    await page.keyboard.press('F2');
    await page.evaluate(() => window.harness.frames(40));
    expect((await drawnLayout(page)).layout).toBe(to < 480 ? 'inline' : 'split');
    near([await lineTop(page, first!.line)], [first!.top]);
    expect(await page.evaluate(() => window.harness.cursorOnScreen())).toBe(false);
  });
}

test('a jump’s line stays where the jump put it as the diff crosses 480 px', async () => {
  const page = await open('split', { below: 10 });
  for (const width of [400, 720]) {
    await page.evaluate((wide) => {
      window.harness.scrollTo(60);
      window.harness.narrow(wide);
    }, width);
    await frames(page);
    expect(Math.abs((await lineTop(page, 60))!)).toBeLessThan(1);
  }
});

test('a jump to a change after a scroll put a line at the top leaves the jump’s screen as the diff crosses 480 px, not the line the scroll put there', async () => {
  // Line 20 is put at the top, as the file tree puts a file's top there; then a jump from the menu
  // bar goes 30 changes on, off the screen.
  const page = await open('split');
  await page.evaluate(() => window.harness.jump(30));
  await frames(page);
  const [first] = await onScreen(page);
  expect(first!.line).toBeGreaterThan(60);
  await page.evaluate(() => window.harness.narrow(400));
  await frames(page);
  near([await lineTop(page, first!.line)], [first!.top]);
});

test('a diff asked for side by side while too narrow stays inline until it’s 480 px, and one asked for inline stays inline', async () => {
  const page = await open('inline', { below: 10 });
  await page.evaluate(() => window.harness.narrow(400));
  await frames(page);
  expect(await drawnLayout(page)).toMatchObject({ layout: 'inline', narrow: true });
  await page.evaluate(() => window.harness.layout('split'));
  await frames(page);
  expect((await drawnLayout(page)).layout).toBe('inline');
  await page.evaluate(() => window.harness.narrow(600));
  await frames(page);
  expect(await drawnLayout(page)).toMatchObject({ layout: 'split', narrow: false });
  await page.evaluate(() => {
    window.harness.layout('inline');
    window.harness.narrow(400);
  });
  await frames(page);
  await page.evaluate(() => window.harness.narrow(600));
  await frames(page);
  expect((await drawnLayout(page)).layout).toBe('inline');
});

test('a row the new side alone has, first under the pinned header, stays where it is as the sides are shared anew, with focus on the old side', async () => {
  // New line 20 is the first of six the old side doesn't have, and old line 20 comes after them.
  const page = await open('split', { wrapped: 300, below: PINNED + 10, added: 6 });
  const { top } = await viewBox(page);
  // A click on old code on screen gives the old side focus, and moves nothing.
  const old = await page.locator('.cm-editor[data-side="old"] .cm-content').boundingBox();
  await page.mouse.click(old!.x + 40, top + 400);
  await frames(page);
  const first = () => page.evaluate(() => window.harness.textTop('added 1 '));
  const before = await first();
  expect(before).toBeCloseTo(PINNED + 10, 0);
  for (const share of [0.3, 0.7]) {
    await page.evaluate((to) => window.harness.sides(to), share);
    await frames(page);
    near([await first()], [before]);
    expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
  }
});

test('what’s drawn under the edge between the sides keeps the pointer and the press, even arriving under a pointer at rest, and code gives them to the edge', async () => {
  const page = await open('split');
  const { top } = await viewBox(page);
  // Under an old line, the thread reaches the edge, on its left.
  const under = [{ id: 'under', line: 24, height: 80, side: 'old' as const }];
  await page.evaluate((given) => window.harness.threads(given, true), under);
  await drawn(page, ['under']);
  const x = (await seam(page))!.x - 2;
  const thread = await page.evaluate(() => {
    const block = document.querySelector('[data-thread-id="under"]')!.closest('.lo-diffthread')!;
    const rect = block.getBoundingClientRect();
    return (rect.top + rect.bottom) / 2;
  });
  const code = top + (await lineTop(page, 30))! + 5;
  /** Whether the edge is drawn under the pointer at `y`, and the cursor there. */
  const pointedAt = (y: number) =>
    page.evaluate(
      ({ across, down }) => {
        const pointed = document.elementFromPoint(across, down)!;
        return {
          near: document.querySelector('.lo-diffseam > .splitter')!.classList.contains('is-near'),
          cursor: getComputedStyle(pointed).cursor,
        };
      },
      { across: x, down: y },
    );
  await page.mouse.move(x, code);
  expect(await pointedAt(code)).toEqual({ near: true, cursor: 'col-resize' });
  // Over the thread, the thread keeps the pointer.
  await page.mouse.move(x, thread);
  expect((await pointedAt(thread)).near).toBe(false);
  expect((await pointedAt(thread)).cursor).not.toBe('col-resize');

  // The thread goes, and comes back under the pointer at rest: the press is the thread's, and
  // nothing drags.
  await page.evaluate(() => window.harness.threads([], true));
  await drawn(page, []);
  await page.evaluate((given) => window.harness.threads(given, true), under);
  await drawn(page, ['under']);
  await page.evaluate(() => {
    const pressed: string[] = [];
    Reflect.set(window, 'loPressed', pressed);
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        pressed.push(target?.closest('.lo-diffthread') ? 'thread' : (target?.className ?? ''));
      },
      { capture: true },
    );
  });
  await page.mouse.down();
  await page.mouse.move(x - 40, thread);
  await page.mouse.up();
  const pressed = await page.evaluate(() => {
    const kept: unknown = Reflect.get(window, 'loPressed');
    return Array.isArray(kept) ? kept.map(String) : [];
  });
  expect(pressed).toEqual(['thread']);
  expect(await page.evaluate(() => window.harness.shares())).toEqual([]);

  // Over code, a press is the edge's, and drags it.
  await page.mouse.move(x, code);
  await page.mouse.down();
  await page.mouse.move(x - 40, code, { steps: 2 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.harness.shares())).toHaveLength(1);
});

test('after a press on the edge between the sides, a key on a comment box’s button still clicks it', async () => {
  const page = await open('split');
  const { top } = await viewBox(page);
  await page.evaluate(() => window.harness.compose(24));
  await frames(page);
  const x = (await seam(page))!.x;
  const code = top + (await lineTop(page, 30))! + 5;
  await page.mouse.move(x, code);
  await page.mouse.down();
  await page.mouse.move(x - 40, code, { steps: 2 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.harness.shares())).toHaveLength(1);
  // A button in the box's foot, as the app draws there, with focus.
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Close';
    const clicks: number[] = [];
    Reflect.set(window, 'loClicks', clicks);
    button.addEventListener('click', (event) => clicks.push(event.detail));
    document.querySelector('.lo-diffcomposer__foot')!.append(button);
    button.focus();
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>('.lo-diffcomposer__foot button')!.click(),
  );
  const clicks = await page.evaluate(() => {
    const kept: unknown = Reflect.get(window, 'loClicks');
    return Array.isArray(kept) ? kept.map(Number) : [];
  });
  expect(clicks).toEqual([0, 0, 0]);
});

test('a text selection dragged across the edge between the sides doesn’t draw it, and at rest there after, it does', async () => {
  const page = await open('split');
  const { top } = await viewBox(page);
  const x = (await seam(page))!.x;
  const code = top + (await lineTop(page, 30))! + 5;
  /** Whether the edge is drawn under the pointer, and the view says which cursor it shows. */
  const shown = () =>
    page.evaluate(() => ({
      near: document.querySelector('.lo-diffseam > .splitter')!.classList.contains('is-near'),
      seam: document.querySelector<HTMLElement>('.lo-diffview')!.dataset.loSeam,
    }));
  await page.mouse.move(x - 120, code);
  await page.mouse.down();
  await page.mouse.move(x, code, { steps: 4 });
  expect(await shown()).toEqual({ near: false, seam: undefined });
  await page.mouse.move(x + 60, code + 20, { steps: 2 });
  await page.mouse.move(x, code, { steps: 2 });
  expect(await shown()).toEqual({ near: false, seam: undefined });
  await page.mouse.up();
  expect(await shown()).toEqual({ near: true, seam: 'col' });
  expect(await page.evaluate(() => window.harness.shares())).toEqual([]);
});

test('a drag whose view goes out of sight keeps a share of the width it began at, never one that isn’t a number', async () => {
  const page = await open('split', { wrapped: 300 });
  const { left, top, room } = await viewBox(page);
  const edge = (await seam(page))!;
  await page.mouse.move(edge.x, top + 300);
  await page.mouse.down();
  await page.mouse.move(left + 400, top + 300, { steps: 2 });
  await page.evaluate(() => {
    document.getElementById('root')!.style.display = 'none';
  });
  await page.mouse.move(left + 420, top + 300);
  await page.mouse.up();
  const shares = await page.evaluate(() => window.harness.shares());
  for (const share of shares) expect(share === undefined || Number.isFinite(share)).toBe(true);
  await page.evaluate(() => {
    document.getElementById('root')!.style.display = '';
  });
  await frames(page);
  const { old } = await sideWidths(page);
  expect(old).toBeCloseTo((shares.at(-1) ?? 0.5) * room, 0);
});

test('the sides let go at even keep no share, as the default', async () => {
  const page = await open('split', { wrapped: 300 });
  const { top, room } = await viewBox(page);
  await page.evaluate(() => window.harness.sides(0.4));
  await frames(page);
  const { old } = await sideWidths(page);
  const from = Math.round((await seam(page))!.x);
  await page.mouse.move(from, top + 300);
  await page.mouse.down();
  await page.mouse.move(from + 60, top + 300);
  await page.mouse.move(from + (room / 2 - old), top + 300);
  await page.mouse.up();
  await frames(page);
  expect(await page.evaluate(() => window.harness.shares())).toEqual([undefined]);
  expect((await sideWidths(page)).old).toBeCloseTo(room / 2, 0);
});

test('a line less than a pixel short of the pinned header’s foot stays where it is as the sides are shared anew, again and again', async () => {
  const page = await open('split', { wrapped: 300, below: PINNED - 0.5 });
  const before = await lineTop(page, 20);
  expect(before).toBeGreaterThan(PINNED - 1);
  expect(before).toBeLessThan(PINNED);
  // On a screen that scrolls by whole pixels, each share draws it a fraction of one off where it's
  // held, and no more: steps one after another don't walk it past a pixel short, onto the next line.
  for (const share of [0.3, 0.7, 0.4, 0.6]) {
    await page.evaluate((to) => window.harness.sides(to), share);
    await frames(page);
    const after = await lineTop(page, 20);
    expect(Math.abs(after! - before!), JSON.stringify({ share, before, after })).toBeLessThan(1);
  }
});

test('threads and a comment box on screen stay level with their lines as the sides are shared anew', async () => {
  // Tall enough that the box, which has focus, stays on screen however its side wraps: one that
  // would run past the foot is brought back on screen, as a box is whenever its view's width changes.
  const page = await open('split', { wrapped: 300, below: PINNED + 10, height: 1000 });
  await page.evaluate(() =>
    window.harness.compose(21, 'a comment that wraps as its box narrows '.repeat(3), 'old'),
  );
  await frames(page);
  await page.evaluate((below) => {
    window.harness.scrollTo(20, below);
    window.harness.threads(
      [
        { id: 'old', line: 20, height: 40, side: 'old' },
        { id: 'new', line: 20, height: 60 },
      ],
      true,
    );
  }, PINNED + 10);
  await drawn(page, ['old', 'new']);
  await frames(page);
  const before = await lineTop(page, 20);
  expect(before).toBeCloseTo(PINNED + 10, 0);
  /** How far below its line's top each thread and the box start. */
  const gaps = () =>
    page.evaluate(() =>
      (
        [
          ['[data-thread-id="old"]', 'old', 'line 20 '],
          ['[data-thread-id="new"]', 'new', 'line 20 '],
          ['.lo-diffcomposer', 'old', 'line 21 '],
        ] as const
      ).map(([selector, side, text]) => {
        const found = document.querySelector(selector);
        const line = [
          ...document.querySelectorAll(`.cm-editor[data-side="${side}"] .cm-line`),
        ].find((each) => each.textContent?.startsWith(text));
        if (!found || !line) return Number.NaN;
        return found.getBoundingClientRect().top - line.getBoundingClientRect().top;
      }),
    );
  for (const share of [0.3, 0.7, undefined]) {
    await page.evaluate((to) => window.harness.sides(to), share);
    await frames(page);
    expect(await page.evaluate(() => window.harness.misalignment())).toBeLessThan(1);
    near([await lineTop(page, 20)], [before]);
    // Each is still drawn under its line, however tall the line now wraps.
    for (const gap of await gaps()) expect(gap).toBeGreaterThan(0);
  }
  const [box] = await boxesOn(page);
  expect(box!.whole).toBe(true);
});

test('a box on a side narrower than a box may be takes both sides, and one on a wide side keeps to it', async () => {
  const page = await open('split');
  await page.evaluate(() => {
    window.harness.sides(0.25);
    window.harness.compose(22, '', 'old');
  });
  await frames(page);
  const [spanned] = await boxesOn(page);
  expect(spanned!.width).toBeGreaterThan(700);
  expect(spanned!.whole).toBe(true);
  await page.evaluate(() => window.harness.sides(0.75));
  await frames(page);
  const [kept] = await boxesOn(page);
  expect(kept!.width).toBeLessThan(700);
});

// Picking lines with the `+` ---------------------------------------------------------------------

/** The page with two files to pick lines in, as `harness.openPicking` draws them. */
async function openPicking(layout: DiffLayout, unknown = false): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(([shown, later]) => window.harness.openPicking(shown, later), [
    layout,
    unknown,
  ] as const);
  await frames(page);
  return page;
}

/** The middle of the row `text` is drawn on in `editor` ("Before", "After" or "Changes"). */
async function rowOf(page: Page, editor: string, text: string): Promise<{ x: number; y: number }> {
  const row = await page.evaluate(
    ([label, words]) => {
      const content = document.querySelector(`.cm-content[aria-label="${label}"]`)!;
      const line = [...content.querySelectorAll('.cm-line')].find(
        (each) => each.textContent === words,
      );
      if (!line) return undefined;
      const { left, top, height } = line.getBoundingClientRect();
      return { x: left + 40, y: top + height / 2 };
    },
    [editor, text] as const,
  );
  if (!row) throw new Error(`No row says ${text} in ${editor}`);
  return row;
}

/** Brings the `+` to the row `text` is drawn on in `editor`: the middle of the `+`. */
async function plusAt(page: Page, editor: string, text: string): Promise<{ x: number; y: number }> {
  const row = await rowOf(page, editor, text);
  await page.mouse.move(row.x, row.y);
  await frames(page);
  const add = page.locator('.lo-gutteradd');
  await expect(add).toBeVisible();
  const box = (await add.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves a pointer held down to the row `text` is drawn on in `editor`, a frame drawn after it. */
async function dragTo(page: Page, editor: string, text: string): Promise<void> {
  const row = await rowOf(page, editor, text);
  await page.mouse.move(row.x, row.y, { steps: 6 });
  await frames(page);
}

/** What's picked in each editor, what the tip by the pointer says, and what was commented on. */
function picking(page: Page) {
  return page.evaluate(() => ({
    picked: window.harness.picked(),
    tip: document.querySelector('.lo-picktip:not([hidden])')?.textContent ?? undefined,
    commented: window.harness.commented(),
  }));
}

for (const [editor, side, opposite, last] of [
  ['After', 'new', 'Before', 'a 50, changed'],
  ['Before', 'old', 'After', 'a 50'],
] as const) {
  test(`side by side, a drag from the \`+\` in the ${side} column over a fold picks that column’s lines, says them by the pointer, holds at the last line that takes a comment, and comments on them let go`, async () => {
    const page = await openPicking('split');
    await plusAt(page, editor, 'a 5');
    await page.mouse.down();
    await dragTo(page, editor, last);
    const removed = side === 'old' ? ', removed' : '';
    const changed = side === 'new' ? 'a 6, changed' : 'a 6';
    const crossed = ['a 5', changed, 'a 7', 'a 8', 'a 9', 'a 47', 'a 48', 'a 49', last];
    let now = await picking(page);
    // The fold's lines are its own, and the other column has none.
    expect(now.picked[editor]).toEqual(crossed);
    expect(now.picked[opposite]).toEqual([]);
    expect(now.tip).toBe(`Lines 5–50${removed}`);
    expect(now.commented).toEqual([]);

    // Into the next file, the end holds at this one's last line that takes one.
    await dragTo(page, editor, 'b 2');
    now = await picking(page);
    expect(now.picked[editor]).toEqual([...crossed, 'a 51', 'a 52', 'a 53']);
    expect(now.tip).toBe(`Lines 5–53${removed}`);

    // Back on the fold between the hunks, it holds at the line before it, nearer the start.
    const fold = await page.evaluate((label) => {
      const content = document.querySelector(`.cm-content[aria-label="${label}"]`)!;
      const between = content.querySelectorAll('.lo-collapsed')[1]!;
      const { top, height } = between.getBoundingClientRect();
      return top + height / 2;
    }, editor);
    await page.mouse.move((await rowOf(page, editor, 'a 9')).x, fold, { steps: 4 });
    await frames(page);
    now = await picking(page);
    expect(now.picked[editor]).toEqual(crossed.slice(0, 5));
    expect(now.tip).toBe(`Lines 5–9${removed}`);

    await page.mouse.up();
    await frames(page);
    now = await picking(page);
    expect(now.commented).toEqual([{ kind: 'line', at: { file: 'a', side, from: 5, to: 9 } }]);
    expect(now.tip).toBeUndefined();
    expect(now.picked[editor]).toEqual([]);
  });
}

test('`Esc` drops a drag from the `+`, which then comments on nothing; a click comments on its line, and Shift with it on the lines from the cursor’s', async () => {
  const page = await openPicking('split');
  await plusAt(page, 'After', 'a 5');
  await page.mouse.down();
  await dragTo(page, 'After', 'a 8');
  expect((await picking(page)).picked.After).toEqual(['a 5', 'a 6, changed', 'a 7', 'a 8']);
  await page.keyboard.press('Escape');
  await frames(page);
  let now = await picking(page);
  expect(now.picked.After).toEqual([]);
  expect(now.tip).toBeUndefined();
  await page.mouse.up();
  await frames(page);
  expect((await picking(page)).commented).toEqual([]);

  const at = await plusAt(page, 'After', 'a 8');
  await page.mouse.click(at.x, at.y);
  now = await picking(page);
  expect(now.commented).toEqual([{ kind: 'line', at: { file: 'a', side: 'new', line: 8 } }]);

  // The cursor on line 7, Shift and a click on line 49's `+` comment on lines 7–49.
  await page.mouse.click(
    (await rowOf(page, 'After', 'a 7')).x,
    (await rowOf(page, 'After', 'a 7')).y,
  );
  const far = await plusAt(page, 'After', 'a 49');
  await page.keyboard.down('Shift');
  await page.mouse.click(far.x, far.y);
  await page.keyboard.up('Shift');
  expect((await picking(page)).commented.at(-1)).toEqual({
    kind: 'line',
    at: { file: 'a', side: 'new', from: 7, to: 49 },
  });
});

test('inline, a drag from the `+` keeps to its first line’s side, the other side’s lines left out', async () => {
  const page = await openPicking('inline');
  await plusAt(page, 'Changes', 'a 6');
  await page.mouse.down();
  await dragTo(page, 'Changes', 'a 50, changed');
  let now = await picking(page);
  // From a removed line, the end rests on the removed line before the added one it's on.
  expect(now.picked.Changes).toEqual(['a 6', 'a 7', 'a 8', 'a 9', 'a 47', 'a 48', 'a 49', 'a 50']);
  expect(now.tip).toBe('Lines 6–50, removed');
  await page.mouse.up();
  await frames(page);

  await plusAt(page, 'Changes', 'a 6, changed');
  await page.mouse.down();
  await dragTo(page, 'Changes', 'a 4');
  now = await picking(page);
  expect(now.picked.Changes).toEqual(['a 4', 'a 5', 'a 6, changed']);
  expect(now.tip).toBe('Lines 4–6');
  await page.mouse.up();
  expect((await picking(page)).commented).toEqual([
    { kind: 'line', at: { file: 'a', side: 'old', from: 6, to: 50 } },
    { kind: 'line', at: { file: 'a', side: 'new', from: 4, to: 6 } },
  ]);
});

test('a drag from the `+` held near the foot of the pane scrolls it under a still pointer, the end following to the last line that takes a comment, with no tip until the lines that do are known, and then one', async () => {
  const page = await openPicking('split', true);
  await page.evaluate(() => window.harness.setHeight(300));
  await frames(page);
  await plusAt(page, 'After', 'a 5');
  await page.mouse.down();
  const foot = await page.evaluate(
    () => document.querySelector('.lo-diffview')!.getBoundingClientRect().bottom,
  );
  await page.mouse.move((await rowOf(page, 'After', 'a 5')).x, foot - 8, { steps: 6 });
  // Not known yet, the end holds on any line the column draws, and no tip says them.
  await expect
    .poll(async () => (await picking(page)).picked.After?.at(-1), { timeout: 5000 })
    .toBe('a 53');
  expect((await picking(page)).tip).toBeUndefined();
  const scrolled = await page.evaluate(() => document.querySelector('.lo-diffview')!.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  // Once they're known, the tip says them under the pointer held still, the end where a comment
  // can go.
  await page.evaluate(() => window.harness.know());
  await frames(page);
  expect((await picking(page)).tip).toBe('Lines 5–53');
  await page.mouse.up();
  expect((await picking(page)).commented).toEqual([
    { kind: 'line', at: { file: 'a', side: 'new', from: 5, to: 53 } },
  ]);
});

test('a right-click inside lines selected gives the menu the line and column clicked, and the lines selected for the commands that comment', async () => {
  const page = await openPicking('split');
  const seven = await rowOf(page, 'After', 'a 7');
  // The cursor at line 7's start, then selected to line 9's: lines 7 and 8.
  await page.mouse.click(seven.x - 39, seven.y);
  for (const key of ['Shift+ArrowDown', 'Shift+ArrowDown']) await page.keyboard.press(key);
  await page.mouse.click(seven.x - 30, seven.y, { button: 'right' });
  const [menu] = await page.evaluate(() => window.harness.menus());
  expect(menu).toMatchObject({
    kind: 'line',
    at: { file: 'a', side: 'new', line: 7 },
    selected: { file: 'a', side: 'new', from: 7, to: 8 },
  });
  // What acts on a word, as Show definition, has the one clicked.
  expect(menu && 'at' in menu && 'column' in menu.at).toBe(true);
});

test('Shift alone leaves the `+` where it is, and a key a command takes after it takes the `+` away', async () => {
  const page = await openPicking('split');
  const seven = await rowOf(page, 'After', 'a 7');
  await page.mouse.click(seven.x, seven.y);
  await plusAt(page, 'After', 'a 8');
  const add = page.locator('.lo-gutteradd');
  await page.keyboard.press('Shift');
  await frames(page);
  await expect(add).toBeVisible();
  // `c`, which the key listener takes for Comment before the view hears it.
  await page.keyboard.press('c');
  await frames(page);
  expect((await picking(page)).commented).toHaveLength(1);
  await expect(add).toBeHidden();
});

test('inline, Shift with a click on the `+` of a line no range from the cursor’s line can end on comments on that line alone', async () => {
  const page = await openPicking('inline');
  // The cursor on removed line 6; the `+` beside the line added for it, under it.
  const removed = await rowOf(page, 'Changes', 'a 6');
  await page.mouse.click(removed.x, removed.y);
  const at = await plusAt(page, 'Changes', 'a 6, changed');
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  expect((await picking(page)).commented).toEqual([
    { kind: 'line', at: { file: 'a', side: 'new', line: 6 } },
  ]);
});

test('a drag from the `+` whose column stops being drawn, let go before the pointer moves again, comments on nothing', async () => {
  const page = await openPicking('split');
  await page.evaluate(() =>
    document.addEventListener(
      'pointerdown',
      (event) => document.body.setAttribute('data-pointer', String(event.pointerId)),
      { capture: true },
    ),
  );
  await plusAt(page, 'After', 'a 5');
  await page.mouse.down();
  await dragTo(page, 'After', 'a 8');
  expect((await picking(page)).picked.After).toHaveLength(4);
  // Drawn inline, and let go in the same task, before a frame follows the pointer.
  await page.evaluate(() => {
    window.harness.layout('inline');
    const pointerId = Number(document.body.getAttribute('data-pointer'));
    document
      .querySelector('.lo-gutteradd')!
      .dispatchEvent(new PointerEvent('pointerup', { pointerId, bubbles: true, clientY: 300 }));
  });
  await page.mouse.up();
  await frames(page);
  const now = await picking(page);
  expect(now.commented).toEqual([]);
  expect(now.tip).toBeUndefined();
});

// Changing a box's lines by its bracket's ends ---------------------------------------------------

/** The ends of open boxes' brackets in `editor`'s lane: which end, the row beside it, where. */
function handlesIn(page: Page, editor: string) {
  return page.evaluate((label) => {
    const content = document.querySelector(`.cm-content[aria-label="${label}"]`)!;
    const view = content.closest('.cm-editor')!;
    const lines = [...content.querySelectorAll('.cm-line')];
    return [...view.querySelectorAll<HTMLElement>('.lo-threadlane .lo-handle')].map((handle) => {
      const rect = handle.getBoundingClientRect();
      const y = rect.top + 10;
      const row = lines.find((line) => {
        const box = line.getBoundingClientRect();
        return box.top <= y && y < box.bottom;
      });
      return {
        end: handle.dataset.handle,
        row: row?.textContent,
        pressed: handle.classList.contains('is-pressed'),
        x: rect.left + rect.width / 2,
        y,
      };
    });
  }, editor);
}

/** The open box: whether it's drawn, its text, its top, the foot of row `text` in `editor`. */
function boxBy(page: Page, editor: string, text: string) {
  return page.evaluate(
    ([label, words]) => {
      const box = document.querySelector<HTMLElement>('.lo-diffcomposer');
      const content = document.querySelector(`.cm-content[aria-label="${label}"]`)!;
      const line = [...content.querySelectorAll('.cm-line')].find(
        (each) => each.textContent === words,
      );
      return {
        drawn: box !== null && box.getClientRects().length > 0,
        text: box?.querySelector('.cm-content')?.textContent,
        top: box?.getBoundingClientRect().top,
        under: line?.getBoundingClientRect().bottom,
        focused: box?.contains(document.activeElement) ?? false,
      };
    },
    [editor, text] as const,
  );
}

/** How far apart the two sides draw the row `text`, which both have. */
function apart(page: Page, text: string): Promise<number> {
  return page.evaluate((words) => {
    const top = (label: string) =>
      [...document.querySelectorAll(`.cm-content[aria-label="${label}"] .cm-line`)]
        .find((each) => each.textContent === words)!
        .getBoundingClientRect().top;
    return Math.abs(top('Before') - top('After'));
  }, text);
}

test('between lines, a drag from the end of a new comment’s bracket on its last line takes its box out of the flow, and let go puts it under the new last line, its text kept, focus back in it, the sides level', async () => {
  const page = await openPicking('split');
  await page.evaluate(() => window.harness.composeLines(5, 7, 'between', 'Kept text'));
  await frames(page);
  let handles = await handlesIn(page, 'After');
  expect(handles.map(({ end, row }) => [end, row])).toEqual([
    ['first', 'a 5'],
    ['last', 'a 7'],
  ]);
  expect(await apart(page, 'a 47')).toBeLessThan(1);
  const last = handles[1]!;
  await page.mouse.move(last.x, last.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y + 30, { steps: 4 });
  await frames(page);
  // Out of the flow while it's dragged, its room on the other side with it.
  expect((await boxBy(page, 'After', 'a 7')).drawn).toBe(false);
  expect(await apart(page, 'a 47')).toBeLessThan(1);
  await dragTo(page, 'After', 'a 9');
  let now = await picking(page);
  expect(now.picked.After).toEqual(['a 5', 'a 6, changed', 'a 7', 'a 8', 'a 9']);
  expect(now.tip).toBe('Lines 5–9');
  handles = await handlesIn(page, 'After');
  expect(handles.map(({ row, pressed }) => [row, pressed])).toEqual([
    ['a 5', false],
    ['a 9', true],
  ]);

  await page.mouse.up();
  await frames(page);
  expect(await page.evaluate(() => window.harness.relined())).toEqual([
    { file: 'a', side: 'new', from: 5, to: 9 },
  ]);
  const box = await boxBy(page, 'After', 'a 9');
  expect(box).toMatchObject({ drawn: true, text: 'Kept text', focused: true });
  expect(Math.abs(box.top! - box.under!)).toBeLessThan(24);
  expect(await apart(page, 'a 47')).toBeLessThan(1);
  now = await picking(page);
  expect(now.tip).toBeUndefined();
  expect(now.picked.After).toEqual(['a 5', 'a 6, changed', 'a 7', 'a 8', 'a 9']);
  expect((await handlesIn(page, 'After')).map(({ row }) => row)).toEqual(['a 5', 'a 9']);
});

test('inline, between lines, a drag from an end of a box’s bracket keeps to its side, and its box goes under the new last line', async () => {
  const page = await openPicking('inline');
  await page.evaluate(() => window.harness.composeLines(5, 7, 'between', 'Kept text'));
  await frames(page);
  const handles = await handlesIn(page, 'Changes');
  expect(handles.map(({ end, row }) => [end, row])).toEqual([
    ['first', 'a 5'],
    ['last', 'a 7'],
  ]);
  await page.mouse.move(handles[0]!.x, handles[0]!.y);
  await page.mouse.down();
  await dragTo(page, 'Changes', 'a 4');
  expect((await picking(page)).picked.Changes).toEqual(['a 4', 'a 5', 'a 6, changed', 'a 7']);
  await page.mouse.up();
  await frames(page);
  expect(await page.evaluate(() => window.harness.relined())).toEqual([
    { file: 'a', side: 'new', from: 4, to: 7 },
  ]);
  expect(await boxBy(page, 'Changes', 'a 7')).toMatchObject({ text: 'Kept text', focused: true });
});

test('beside lines, the popover steps aside while an end of its box’s bracket is dragged, which never goes past the other end; `Esc` puts the lines back, and let go the box goes to its new lines', async () => {
  const page = await openPicking('split');
  await page.evaluate(() => window.harness.composeLines(5, 7, 'beside', 'Kept text'));
  await frames(page);
  const pop = page.locator('.lo-threadpop');
  await expect(pop).toBeVisible();
  // Focus in the popover, which goes back there.
  const inPop = () =>
    page.evaluate(() => document.querySelector('.lo-threadpop')!.contains(document.activeElement));
  expect(await inPop()).toBe(true);
  const first = (await handlesIn(page, 'After'))[0]!;
  expect(first.row).toBe('a 5');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await dragTo(page, 'After', 'a 3');
  await expect(pop).toBeHidden();
  expect((await picking(page)).tip).toBe('Lines 3–7');
  // Past the other end, it holds there: one line.
  await dragTo(page, 'After', 'a 9');
  expect((await picking(page)).picked.After).toEqual(['a 7']);
  expect((await picking(page)).tip).toBe('Line 7');
  await page.keyboard.press('Escape');
  await frames(page);
  await expect(pop).toBeVisible();
  expect(await inPop()).toBe(true);
  expect((await picking(page)).picked.After).toEqual(['a 5', 'a 6, changed', 'a 7']);
  await page.mouse.up();
  expect(await page.evaluate(() => window.harness.relined())).toEqual([]);

  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await dragTo(page, 'After', 'a 4');
  await page.mouse.up();
  await frames(page);
  expect(await page.evaluate(() => window.harness.relined())).toEqual([
    { file: 'a', side: 'new', from: 4, to: 7 },
  ]);
  await expect(pop).toBeVisible();
  expect((await boxBy(page, 'After', 'a 7')).text).toBe('Kept text');
  expect(await inPop()).toBe(true);
  expect((await handlesIn(page, 'After')).map(({ row }) => row)).toEqual(['a 4', 'a 7']);
});

test('on one line the one end of a box’s bracket is both, a drag up moving its first line; a click on it does nothing, and its tip says which end it is and the keys that move it, over its line, clear of the box', async () => {
  const page = await openPicking('split');
  await page.evaluate(() => window.harness.composeLines(7, 7, 'between'));
  await frames(page);
  const [both] = await handlesIn(page, 'After');
  expect(both).toMatchObject({ end: 'both', row: 'a 7' });
  await page.mouse.click(both!.x, both!.y);
  await frames(page);
  expect(await page.evaluate(() => window.harness.relined())).toEqual([]);
  expect((await boxBy(page, 'After', 'a 7')).focused).toBe(true);
  await page.mouse.move(both!.x, both!.y + 2);
  const tip = page.locator('.lo-tip[role="tooltip"]');
  await expect(tip).toHaveText('First and last lineCtrl+Alt+Shift+↑Ctrl+Alt+↓');
  // Over the end, never under it, where the box is: `y` is 10 px under the end's top.
  const drawn = (await tip.boundingBox())!;
  expect(drawn.y + drawn.height).toBeLessThanOrEqual(both!.y - 10);
  expect(drawn.y + drawn.height).toBeLessThan((await boxBy(page, 'After', 'a 7')).top!);

  await page.mouse.down();
  await dragTo(page, 'After', 'a 5');
  await page.mouse.up();
  await frames(page);
  expect(await page.evaluate(() => window.harness.relined())).toEqual([
    { file: 'a', side: 'new', from: 5, to: 7 },
  ]);
  const handles = await handlesIn(page, 'After');
  expect(handles.map(({ end, row }) => [end, row])).toEqual([
    ['first', 'a 5'],
    ['last', 'a 7'],
  ]);
  await page.mouse.move(handles[0]!.x, handles[0]!.y + 1);
  await expect(page.locator('.lo-tip[role="tooltip"]')).toHaveText(
    'First lineCtrl+Alt+Shift+↑Ctrl+Alt+Shift+↓',
  );
});

for (const [layout, mode, editor] of [
  ['split', 'between', 'After'],
  ['split', 'beside', 'After'],
  ['inline', 'between', 'Changes'],
] as const) {
  test(`${layout === 'split' ? 'side by side' : 'inline'}, ${mode} lines, a new comment’s box moved to other lines as a key in it moves it goes under the new last line in one change, the same element, its text and focus kept${layout === 'split' ? ', the sides level before and after' : ''}`, async () => {
    const page = await openPicking(layout);
    await page.evaluate((shown) => window.harness.composeLines(5, 7, shown, 'Kept text'), mode);
    await frames(page);
    const inBox = () =>
      page.evaluate(() =>
        document.querySelector('.lo-diffcomposer')!.contains(document.activeElement),
      );
    const had = await inBox();
    const level = async () => {
      if (layout === 'split') expect(await apart(page, 'a 47')).toBeLessThan(1);
    };
    await level();
    for (const [from, to, under] of [
      [5, 9, 'a 9'],
      [4, 9, 'a 9'],
      [4, 8, 'a 8'],
      [8, 8, 'a 8'],
    ] as const) {
      expect(
        await page.evaluate(([a, b]) => window.harness.moveLines(a, b), [from, to] as const),
      ).toEqual({
        moved: true,
        same: true,
      });
      // In the same task: the lines picked are the new ones before a frame is drawn.
      await frames(page);
      const box = await boxBy(page, editor, under);
      expect(box.text).toBe('Kept text');
      expect(await inBox()).toBe(had);
      if (mode === 'between') expect(Math.abs(box.top! - box.under!)).toBeLessThan(24);
      else expect(box.top!).toBeGreaterThan(box.under! - 1);
      const picked = (await picking(page)).picked[editor]!;
      expect(picked[0]).toMatch(new RegExp(`^a ${from}\\b`));
      expect(picked.at(-1)).toMatch(new RegExp(`^a ${to}\\b`));
      await level();
    }
  });
}

for (const [layout, mode] of [
  ['split', 'between'],
  ['split', 'beside'],
  ['inline', 'between'],
] as const) {
  test(`${layout === 'split' ? 'side by side' : 'inline'}, ${mode} lines, a box on a removed line moved to lines that end on an unchanged one goes under it${layout === 'split' ? ', in the new column' : ''}, the same element, its text and focus kept`, async () => {
    const page = await openPicking(layout);
    await page.evaluate(
      (shown) => window.harness.composeLines(6, 6, shown, 'Kept text', 'old'),
      mode,
    );
    await frames(page);
    const [from, to] = layout === 'split' ? ['Before', 'After'] : ['Changes', 'Changes'];
    // Focus is in the box, or beside lines in its popover.
    const focusIn = () =>
      page.evaluate(
        (within) => document.querySelector(within)!.contains(document.activeElement),
        mode === 'beside' ? '.lo-threadpop' : '.lo-diffcomposer',
      );
    expect((await boxBy(page, from, 'a 6')).text).toBe('Kept text');
    expect(await focusIn()).toBe(true);
    // As GitHub takes them, the removed line 6 down to the unchanged line 7 end on the new side.
    expect(await page.evaluate(() => window.harness.moveLines(7, 7, 'new'))).toEqual({
      moved: true,
      same: true,
    });
    await frames(page);
    const box = await boxBy(page, to, 'a 7');
    expect(box).toMatchObject({ drawn: true, text: 'Kept text' });
    expect(await focusIn()).toBe(true);
    if (mode === 'between') expect(Math.abs(box.top! - box.under!)).toBeLessThan(24);
    else expect(box.top!).toBeGreaterThan(box.under! - 1);
    const column = await page.evaluate((label) => {
      const editor = document
        .querySelector(`.cm-content[aria-label="${label}"]`)!
        .closest('.cm-editor')!
        .getBoundingClientRect();
      const rect = document.querySelector('.lo-diffcomposer')!.getBoundingClientRect();
      const middle = rect.left + rect.width / 2;
      return middle > editor.left && middle < editor.right;
    }, to);
    expect(column).toBe(true);
    if (layout === 'split') expect(await apart(page, 'a 47')).toBeLessThan(1);
  });
}

for (const mode of ['beside', 'between'] as const) {
  test(`${mode} lines, \`Esc\` in a box held as its comment is sent, after its lines changed, takes focus to its new last line`, async () => {
    const page = await openPicking('split');
    await page.evaluate((shown) => window.harness.composeLines(5, 7, shown, 'Kept text'), mode);
    await frames(page);
    await page.evaluate(() => window.harness.moveLines(5, 9));
    await frames(page);
    await page.locator('.lo-diffcomposer .cm-content').focus();
    await page.evaluate(() => window.harness.holdLines(true));
    expect((await boxBy(page, 'After', 'a 9')).focused).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.harness.focused())).toBe('After');
    const line = await page.evaluate(() => {
      const node = document.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('.cm-line')?.textContent;
    });
    expect(line).toBe('a 9');
  });
}

test('let go over the end of a box’s bracket it dragged, that end shows no tip over the box until the pointer leaves it', async () => {
  const page = await openPicking('split');
  await page.evaluate(() => window.harness.composeLines(7, 7, 'between'));
  await frames(page);
  const [both] = await handlesIn(page, 'After');
  await page.mouse.move(both!.x, both!.y);
  await page.mouse.down();
  // Down the lane, as a hand on the handle drags it, once the box has stepped aside.
  await page.mouse.move(both!.x, both!.y + 8, { steps: 2 });
  await frames(page);
  const row = await rowOf(page, 'After', 'a 9');
  await page.mouse.move(both!.x, row.y, { steps: 6 });
  await frames(page);
  await page.mouse.up();
  await frames(page);
  const last = (await handlesIn(page, 'After'))[1]!;
  expect(last).toMatchObject({ end: 'last', row: 'a 9' });
  await page.mouse.move(last.x, last.y + 1);
  // Longer than a tip waits for the pointer to rest.
  await page.waitForTimeout(700);
  const tip = page.locator('.lo-tip[role="tooltip"]');
  await expect(tip).toHaveCount(0);
  await page.mouse.move(last.x + 80, last.y);
  await page.mouse.move(last.x, last.y);
  await expect(tip).toHaveText('Last lineCtrl+Alt+↓Ctrl+Alt+↑');
});

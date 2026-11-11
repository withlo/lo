// The diff view's keys, pressed for real, through the registry's listener as in the app, on a small
// pull request: the cursor stays on screen, `Tab` and `⌃o` cross and come back, a comment box keeps
// its keys and stays level as it grows, a held key dies on blur, a key Lo holds still reaches Vim
// when it isn't Lo's, and `PageDown` and `PageUp` go on past what's taller than the screen.

import type { Spot } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import {
  app,
  boxText,
  code,
  cursor,
  expect,
  fileOf,
  focusSide,
  inBox,
  lineOf,
  press,
  test,
} from './suite.ts';

test('j, ]f, ]t and G keep the cursor on screen', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g');
  for (let step = 0; step < 30; step++) await press(page, 'j');
  await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
  const files: string[] = [];
  for (let step = 0; step < 5; step++) {
    await press(page, ']', 'f');
    await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
    files.push(fileOf((await cursor(page))?.at) ?? '');
  }
  expect(files).toEqual([
    'src/new-name.ts',
    'src/from.ts',
    'src/to.ts',
    'docs/added.ts',
    'src/removed.ts',
  ]);
  await press(page, 'g', 'g');
  const threads: string[] = [];
  for (let step = 0; step < 2; step++) {
    await press(page, ']', 't');
    await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
    const at = (await cursor(page))?.at;
    threads.push(`${fileOf(at)}:${lineOf(at)}`);
  }
  expect(threads).toEqual(['src/app.ts:40', 'docs/added.ts:120']);
  await press(page, 'G');
  await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
  expect(fileOf((await cursor(page))?.at)).toBe('src/removed.ts');
});

test('Tab crosses to the other side, and ⌃o comes back', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', 'j', 'j');
  const start = await cursor(page);
  expect(start?.pane).toBe('new');
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
  await press(page, 'Control+o');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('new');
  const back = (await cursor(page))?.at;
  expect([fileOf(back), lineOf(back)]).toEqual([fileOf(start?.at), lineOf(start?.at)]);
  await press(page, 'Control+i');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
});

test('a comment box grows as you type, and the sides stay level', async ({ page }) => {
  await focusSide(page, 'old');
  await press(page, 'g', 'g', ']', 'c', 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  const box = page.locator('.lo-diffcomposer');
  const first = (await box.boundingBox())?.height ?? 0;
  for (let line = 1; line <= 6; line++) {
    await page.keyboard.type(`Line ${line} of the comment`);
    await press(page, 'Enter');
    await expect
      .poll(() => page.evaluate(() => window.diffView.misalignment().worst))
      .toBeLessThanOrEqual(0.5);
  }
  expect((await box.boundingBox())?.height ?? 0).toBeGreaterThan(first + 60);
  expect(await boxText(page)).toContain('Line 6 of the comment');
});

test('Tab and ⇧Tab in a box keep focus there in both modes, and the next letter lands in it', async ({
  page,
}) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  const line = await cursor(page);
  await press(page, 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  // Insert mode, where Tab indents.
  await press(page, 'Tab');
  expect(await inBox(page)).toBe(true);
  await page.keyboard.type('a');
  expect(await boxText(page)).toEqual(['  a']);
  await press(page, 'Shift+Tab');
  expect(await inBox(page)).toBe(true);
  await page.keyboard.type('b');
  expect((await boxText(page)).join('\n')).toContain('ab');
  // Normal mode.
  await press(page, 'Escape', 'Tab', 'Shift+Tab', 'Tab');
  expect(await inBox(page)).toBe(true);
  await press(page, 'A');
  await page.keyboard.type('c');
  expect((await boxText(page)).join('\n')).toContain('abc');
  // Nothing reached the diff.
  await press(page, 'Escape', 'Escape');
  await expect.poll(() => inBox(page)).toBe(false);
  expect((await cursor(page))?.at).toEqual(line?.at);
});

test('a held g dies on blur', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', 'j');
  const start = await cursor(page);
  for (const blur of [
    // Focus leaves the side, and comes back.
    () =>
      page.evaluate(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
        document.querySelector<HTMLElement>('.cm-content[aria-label="After"]')?.focus();
      }),
    // The window loses focus.
    () => page.evaluate(() => window.dispatchEvent(new FocusEvent('blur'))),
  ]) {
    await press(page, 'g');
    await blur();
    // Were the first `g` still held, this would be `gg`, to the top.
    await press(page, 'g');
    await page.waitForTimeout(200);
    expect((await cursor(page))?.at).toEqual(start?.at);
    await press(page, 'Escape');
  }
});

test('y w still reaches Vim', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', '0');
  const start = await cursor(page);
  // A held `y` that went missing would leave `w` to move the cursor a word on.
  await press(page, 'y', 'w');
  await page.waitForTimeout(100);
  expect((await cursor(page))?.at).toEqual(start?.at);
  // What it yanked pastes into a comment box.
  await press(page, 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  await press(page, 'Escape', 'p');
  const line = app.new[(lineOf(start?.at) ?? 1) - 1] ?? '';
  // `yw` takes the space after the word too.
  expect(await boxText(page)).toEqual([`${line.split(' ')[0]} `]);
});

test('gi goes inline and back', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  const start = await cursor(page);
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('inline');
  expect(await cursor(page)).toMatchObject({ pane: 'inline', at: start?.at });
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('split');
  expect(await cursor(page)).toMatchObject({ pane: 'new', at: start?.at });
});

test('an input method composing in a diff is cancelled, and focus moves on cleanly', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  // As an input method types, through the browser's own protocol.
  const cdp = await page.context().newCDPSession(page);
  for (const round of [1, 2]) {
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await page.waitForTimeout(100);
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(100);
    await cdp.send('Input.insertText', { text: '日本' });
    await page.waitForTimeout(200);
    await focusSide(page, 'old');
    await press(page, 'j');
    await focusSide(page, 'new');
    await press(page, round === 1 ? 'k' : 'Tab');
    await page.waitForTimeout(200);
  }
  expect(errors).toEqual([]);
  await expect(page.locator('.cm-content[aria-label="After"]')).not.toContainText('日本');
});

test.describe('paging past what is taller than the screen', () => {
  // A line that wraps far taller than the screen, in a file only the new side has; a file only the
  // old side has, several screens long; then runs of removed and added lines. Each faces a spacer as
  // tall on the other side.
  const long = Array.from({ length: 1500 }, (_, index) => `word${index + 1}`).join(' ');
  const intro = code('intro', 10);
  const outro = code('outro', 10);
  const gone = code('gone', 300);
  const removed = code('removed', 120);
  const added = code('added', 120);
  const head = code('head', 30);
  const middle = code('middle', 30);
  // Short enough to end on lines, not a block of collapsed ones.
  const tail = code('tail', 3);
  const paths = ['notes/long.txt', 'src/gone.ts', 'src/spaced.ts'];
  /** The lines only one side has, each of which must pass through the screen. */
  const oneSided = { old: [...gone, ...removed], new: [...intro, ...outro, ...added] };
  test.use({
    pull: {
      repo: 'withlo/example',
      number: 1,
      files: [
        { path: paths[0]!, status: 'added', new: text([...intro, long, ...outro]) },
        { path: paths[1]!, status: 'removed', old: text(gone) },
        {
          path: paths[2]!,
          status: 'modified',
          old: text([...head, ...removed, ...middle, ...tail]),
          new: text([...head, ...middle, ...added, ...tail]),
        },
      ],
      threads: [],
    },
  });

  /** Where a spot is in the pull request, as a number that grows down it. */
  const order = (spot: Spot | undefined): number =>
    paths.indexOf(fileOf(spot) ?? '') * 1_000_000 + (lineOf(spot) ?? 0);

  for (const side of ['new', 'old'] as const) {
    test(`PageDown held on the ${side} side goes a screen at most at a time to the end, and PageUp to the top`, async ({
      page,
    }) => {
      await focusSide(page, side);
      await press(page, 'G');
      const end = (await cursor(page))?.at;
      await press(page, 'g', 'g');
      const start = (await cursor(page))?.at;
      await settledScroll(page);
      const height = await page.evaluate(
        () => document.querySelector('.lo-diffview')!.clientHeight,
      );
      for (const { key, way, last } of [
        { key: 'PageDown', way: 1, last: end },
        { key: 'PageUp', way: -1, last: start },
      ] as const) {
        const seen = { old: new Set<string>(), new: new Set<string>() };
        await see(page, seen);
        let at = order((await cursor(page))?.at);
        for (let turn = 0; turn < 60 && !(await atEdge(page, way)); turn++) {
          // What's on screen moves the key's way, by no more than the screen, so every row passes
          // through it: the cursor doesn't drag it on past a spacer.
          const followed = await follow(page, way);
          await press(page, key);
          await settledScroll(page);
          const moved = (await movedSince(page, followed)) * way;
          expect(moved).toBeGreaterThanOrEqual(-1);
          expect(moved).toBeLessThanOrEqual(height + 1);
          const reading = await cursor(page);
          expect((order(reading?.at) - at) * way).toBeGreaterThanOrEqual(0);
          at = order(reading?.at);
          await see(page, seen);
        }
        expect(await atEdge(page, way)).toBe(true);
        // Where there's no more to scroll, the cursor goes to the last line, or the first.
        await press(page, key);
        await settledScroll(page);
        expect(order((await cursor(page))?.at)).toBe(order(last));
        for (const each of ['old', 'new'] as const) {
          expect(oneSided[each].filter((line) => !seen[each].has(line))).toEqual([]);
        }
      }
    });
  }
});

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** Adds the text of each line on screen, on each side, to `seen`. */
async function see(page: Page, seen: { old: Set<string>; new: Set<string> }): Promise<void> {
  const shown = await page.evaluate(() => {
    const screen = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    const read = (label: string): string[] =>
      [...document.querySelectorAll(`.cm-content[aria-label="${label}"] > .cm-line`)]
        .filter((line) => {
          const box = line.getBoundingClientRect();
          return box.bottom > screen.top && box.top < screen.bottom;
        })
        .map((line) => line.textContent ?? '');
    return { old: read('Before'), new: read('After') };
  });
  for (const side of ['old', 'new'] as const) for (const line of shown[side]) seen[side].add(line);
}

/**
 * A line or row on screen to follow, on either side, and where its top is: one the view keys,
 * which a line that wraps taller than the screen is, its top above it. The lowest going down, `way`
 * 1, or the highest going up, so a page leaves it on screen, where the editor still draws it.
 */
async function follow(page: Page, way: 1 | -1): Promise<{ selector: string; top: number }> {
  const followed = await page.evaluate((down) => {
    const screen = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    let best: { selector: string; top: number } | undefined;
    for (const label of ['Before', 'After']) {
      for (const element of document.querySelectorAll<HTMLElement>(
        `.cm-content[aria-label="${label}"] [data-line], .cm-content[aria-label="${label}"] [data-row]`,
      )) {
        const box = element.getBoundingClientRect();
        if (box.bottom <= screen.top || box.top >= screen.bottom) continue;
        if (best && (down ? box.top <= best.top : box.top >= best.top)) continue;
        const { line, row } = element.dataset;
        const key = line === undefined ? `[data-row="${row}"]` : `[data-line="${line}"]`;
        best = { selector: `.cm-content[aria-label="${label}"] ${key}`, top: box.top };
      }
    }
    return best;
  }, way === 1);
  if (!followed) throw new Error('Neither side shows a line.');
  return followed;
}

/** How far what's on screen moved down the document since `followed` was where it was. */
async function movedSince(
  page: Page,
  followed: { selector: string; top: number },
): Promise<number> {
  const top = await page.evaluate(
    (selector) => document.querySelector(selector)?.getBoundingClientRect().top,
    followed.selector,
  );
  if (top === undefined) throw new Error(`What was followed, ${followed.selector}, isn’t drawn.`);
  return followed.top - top;
}

/** The scroll, once it has stayed put for three frames. */
function settledScroll(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const scroller = document.querySelector('.lo-diffview');
    if (!scroller) throw new Error('The view isn’t drawn.');
    let last = Number.NaN;
    for (let same = 0; same < 3;) {
      await new Promise(requestAnimationFrame);
      same = scroller.scrollTop === last ? same + 1 : 0;
      last = scroller.scrollTop;
    }
    return last;
  });
}

/** Whether the scroll is as far as it goes: down, `way` 1, or up. */
function atEdge(page: Page, way: 1 | -1): Promise<boolean> {
  return page.evaluate((down) => {
    const scroller = document.querySelector('.lo-diffview');
    if (!scroller) throw new Error('The view isn’t drawn.');
    return down
      ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      : scroller.scrollTop <= 0;
  }, way === 1);
}

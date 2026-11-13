// An overview's markers in the diff view, on the small pull request, as drawn, side by side and
// inline. The line at the top of the screen and the one in its middle are watched every frame: on a
// frame with no input, neither may move. Markers that arrive or go while the reader is part way
// down move nothing; nor do notes opened or closed above the screen, two at a time included; a note
// opened from its ball, or closed with `Esc`, leaves the line at the top where it is; and a note on
// screen whose mark changes or goes stays as it is until it's scrolled away.

import type { OverviewMark, Place, Spot } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import {
  expect,
  frames,
  lineAt,
  name,
  partWay,
  press,
  scrollBy,
  stopWatching,
  test,
  watch,
} from './suite.ts';

for (const layout of ['split', 'inline'] as const) {
  test(`markers that arrive late, and go, move nothing on screen, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    const middle = await middleOfScreen(page);
    await watch(page);
    await page.evaluate(
      (marks) => window.perfOverview(marks),
      [
        // Above the screen, on it on both sides, and below it.
        mark('src/app.ts', 'new', 2, 4),
        mark(middle.file, 'new', middle.line - 2, middle.line + 2),
        mark(middle.file, 'old', Math.max(1, middle.line - 4), middle.line),
        mark('src/removed.ts', 'old', 150, 160),
      ],
    );
    await expect(page.locator('.lo-ov-marker:visible').first()).toBeVisible();
    await frames(page, 10);
    if (layout === 'split') {
      expect(await page.evaluate(() => window.diffView.misalignment().worst)).toBeLessThanOrEqual(
        0.5,
      );
    }
    await page.evaluate(() => window.perfOverview([]));
    await expect(page.locator('.lo-ov-marker')).toHaveCount(0);
    await frames(page, 10);
    expect(await stopWatching(page)).toEqual([]);
  });

  test(`notes opened and changed above the screen, two in one go, move nothing on screen, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    // Far enough down a file to have lines above the screen to mark.
    let top = await lineAt(page, 0);
    for (let tries = 0; top.line < 52 && tries < 10; tries++) {
      await scrollBy(page, 400);
      top = await lineAt(page, 0);
    }
    if (top.line < 52) throw new Error('The screen is too near the top of its file.');
    // Lines of the file at the top of the screen, before the first it draws there.
    const above = [
      mark(top.file, 'new', top.line - 50, top.line - 48),
      mark(top.file, 'new', top.line - 40, top.line - 38),
    ] as const;
    const lines = [placeOf(above[0]), placeOf(above[1])] as const;
    await page.evaluate((marks) => window.perfOverview(marks), [...above]);
    await frames(page, 5);
    await watch(page);
    // Two notes open in one task.
    expect(
      await page.evaluate((each) => each.map((line) => window.perfOpenNote(line)), lines),
    ).toEqual([true, true]);
    await frames(page, 10);
    // In one task: one note says something else, then both close.
    await page.evaluate(
      (marks) => {
        window.perfOverview(marks);
        window.perfCloseNote();
        window.perfCloseNote();
      },
      [{ ...above[0], note: { label: 'Where to look', text: 'Short now.' } }, above[1]],
    );
    await frames(page, 10);
    // And in one task again, new words for an open note, and another note opened.
    await page.evaluate((line) => window.perfOpenNote(line), lines[0]);
    await frames(page, 10);
    await page.evaluate(
      ({ marks, line }) => {
        window.perfOverview(marks);
        window.perfOpenNote(line);
      },
      {
        marks: [
          { ...above[0], note: { label: 'Where to look', text: 'Longer. '.repeat(40) } },
          above[1],
        ],
        line: lines[1],
      },
    );
    await frames(page, 15);
    expect(await stopWatching(page)).toEqual([]);
    if (layout === 'split') {
      expect(await page.evaluate(() => window.diffView.misalignment().worst)).toBeLessThanOrEqual(
        0.5,
      );
    }
  });

  test(`a note on screen stays as it is while its mark changes and goes, until it's scrolled away, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    const middle = await middleOfScreen(page);
    const shown = mark(middle.file, 'new', middle.line - 3, middle.line - 2);
    await page.evaluate((marks) => window.perfOverview(marks), [shown]);
    expect(
      await page.evaluate((line) => window.perfOpenNote(line), {
        ...middle,
        line: middle.line - 2,
      }),
    ).toBe(true);
    const note = page.locator('.lo-ovnote:visible');
    await expect(note).toContainText('A query over');
    await frames(page, 10);
    await watch(page);
    // Other words, then a line further down, then gone: it stays as it was.
    for (const marks of [
      [{ ...shown, note: { label: 'Where to look', text: 'Other words. '.repeat(30) } }],
      [{ ...mark(middle.file, 'new', middle.line - 3, middle.line - 1), block: shown.block }],
      [],
    ]) {
      await page.evaluate((given) => window.perfOverview(given), marks);
      await frames(page, 10);
      await expect(note).toContainText('A query over');
    }
    expect(await stopWatching(page)).toEqual([]);
    // Scrolled past, it goes with its mark, and what's on screen moves as far as the scroll.
    const past = await scrollPastNote(page);
    expect(past.off).toBeLessThanOrEqual(0.5);
    await scrollBy(page, -past.by);
    await expect(page.locator('.lo-ovnote')).toHaveCount(0);
  });

  test(`a note held on screen takes its mark's new lines and words once it's scrolled away, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    const middle = await middleOfScreen(page);
    const shown = mark(middle.file, 'new', middle.line - 3, middle.line - 2);
    await page.evaluate((marks) => window.perfOverview(marks), [shown]);
    await page.evaluate((line) => window.perfOpenNote(line), { ...middle, line: middle.line - 2 });
    await frames(page, 10);
    await watch(page);
    const moved = {
      ...mark(middle.file, 'new', middle.line - 3, middle.line - 1),
      block: shown.block,
      note: { label: 'Where to look', text: 'Moved down a line.' },
    };
    await page.evaluate((marks) => window.perfOverview(marks), [moved]);
    await frames(page, 10);
    await expect(page.locator('.lo-ovnote:visible')).toContainText('A query over');
    expect(await stopWatching(page)).toEqual([]);
    const past = await scrollPastNote(page);
    expect(past.off).toBeLessThanOrEqual(0.5);
    await scrollBy(page, -past.by);
    await expect(page.locator('.lo-ovnote:visible')).toHaveText(/Moved down a line\./);
    await expect(page.locator('.lo-ov-marker.is-open:visible')).toHaveCount(1);
  });

  test(`a note opened from its ball leaves the top of the screen where it is, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    const middle = await middleOfScreen(page);
    await page.evaluate(
      (marks) => window.perfOverview(marks),
      [mark(middle.file, 'new', middle.line - 6, middle.line - 4)],
    );
    // The cursor on a line below the note, which the note pushes down, and the scroll moved since,
    // so the cursor's line is what the view would otherwise keep in place.
    await clickMiddle(page, layout);
    await page.mouse.wheel(0, 40);
    await frames(page, 10);
    const top = await topOfScreen(page);
    await watch(page);
    await page.locator('.lo-ov-marker:visible').first().click();
    await expect(page.locator('.lo-ovnote:visible')).toHaveCount(1);
    await expect(page.locator('.lo-ov-marker.is-open:visible')).toHaveCount(1);
    await frames(page, 10);
    // What's below the note moves down in the click's frame; the top stays, and nothing moves after.
    expect(await movedSince(page, top)).toBeLessThanOrEqual(0.5);
    expect(await stopWatching(page)).toEqual([]);
    if (layout === 'split') {
      expect(await page.evaluate(() => window.diffView.misalignment().worst)).toBeLessThanOrEqual(
        0.5,
      );
    }
  });

  test(`notes closed above the screen, with Esc or as their marks go, leave the screen where it is, ${name(layout)}`, async ({
    page,
  }) => {
    await partWay(page, layout);
    const middle = await middleOfScreen(page);
    await page.evaluate(
      (marks) => window.perfOverview(marks),
      [
        mark(middle.file, 'new', middle.line - 6, middle.line - 5),
        mark(middle.file, 'new', middle.line - 1, middle.line),
      ],
    );
    for (const ball of await page.locator('.lo-ov-marker:visible').all()) await ball.click();
    await expect(page.locator('.lo-ovnote:visible')).toHaveCount(2);
    // Scrolled on until the notes are above the screen.
    const below = await page.evaluate(() => {
      const box = document.querySelector('.lo-diffview')!;
      const notes = [...document.querySelectorAll('.lo-ovnote')].filter(
        (note) => note.getClientRects().length > 0,
      );
      const bottom = Math.max(...notes.map((note) => note.getBoundingClientRect().bottom));
      return bottom - box.getBoundingClientRect().top + 60;
    });
    await scrollBy(page, below);
    const top = await topOfScreen(page);
    // The code's Esc closes the note opened last.
    await page.evaluate((label) => {
      document
        .querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`)
        ?.focus({ preventScroll: true });
    }, editorLabel(layout));
    await press(page, 'Escape');
    await frames(page, 10);
    expect(await movedSince(page, top)).toBeLessThanOrEqual(0.5);
    // With focus elsewhere, the other goes with its mark.
    await page.evaluate(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
    });
    await watch(page);
    await page.evaluate(() => window.perfOverview([]));
    await frames(page, 10);
    expect(await stopWatching(page)).toEqual([]);
    expect(await movedSince(page, top)).toBeLessThanOrEqual(0.5);
    await expect(page.locator('.lo-ovnote')).toHaveCount(0);
  });
}

/** The last line a mark covers. */
function placeOf({ at }: OverviewMark): Place {
  return { file: at.file, side: at.side, line: at.to };
}

/** The label of the editor that shows the diff in `layout`. */
function editorLabel(layout: 'split' | 'inline'): string {
  return layout === 'split' ? 'After' : 'Changes';
}

/** Clicks the code in the middle of the screen, which puts the cursor there. */
async function clickMiddle(page: Page, layout: 'split' | 'inline'): Promise<void> {
  const column = await page
    .locator(`.cm-content[aria-label="${editorLabel(layout)}"]`)
    .boundingBox();
  const screen = await page.locator('.lo-diffview').boundingBox();
  if (!column || !screen) throw new Error('The view isn’t drawn.');
  await page.mouse.click(column.x + 120, screen.y + screen.height / 2);
  await frames(page, 5);
}

function mark(file: string, side: 'old' | 'new', from: number, to: number): OverviewMark {
  return {
    kind: 'overview',
    at: { file, side, from, to },
    block: `${file}:${from}`,
    note: {
      label: 'Where to look',
      text: 'A query over the plan’s ceiling is refused before it touches the bucket, so one huge query can’t drain a caller’s budget for the minute.',
    },
  };
}

/**
 * Scrolls until the note on screen is just above it, and says how far, and how far a line low on
 * the screen ended up from where the scroll alone would put it.
 */
async function scrollPastNote(page: Page): Promise<{ by: number; off: number }> {
  const before = await page.evaluate(() => {
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    const note = [...document.querySelectorAll('.lo-ovnote')].find(
      (each) => each.getClientRects().length > 0,
    );
    if (!note) throw new Error('No note is drawn.');
    const by = Math.ceil(note.getBoundingClientRect().bottom - box.top + 40);
    for (let y = box.top + box.height * 0.85; y < box.bottom; y += 2) {
      const spot = window.diffView.spotAt(y);
      const top = spot && window.diffView.spotTop(spot);
      if (spot && top !== undefined && top - by > box.top + 20) return { by, spot, top };
    }
    throw new Error('No line is low enough on the screen.');
  });
  await scrollBy(page, before.by);
  const top = await page.evaluate((spot) => window.diffView.spotTop(spot), before.spot);
  if (top === undefined) throw new Error('The line low on the screen isn’t drawn now.');
  return { by: before.by, off: Math.abs(top - (before.top - before.by)) };
}

/** The new side's line of a file in the middle of the screen. */
function middleOfScreen(page: Page): Promise<Place> {
  return lineAt(page, 0.5);
}

/** The first line or header drawn at the top of the screen, and where its top is. */
function topOfScreen(page: Page): Promise<{ spot: Spot; top: number }> {
  return page.evaluate(() => {
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    for (let y = box.top + 1; y < box.bottom; y += 2) {
      const spot = window.diffView.spotAt(y);
      const top = spot && window.diffView.spotTop(spot);
      if (spot && top !== undefined && top >= box.top) return { spot, top };
    }
    throw new Error('Nothing is drawn on screen.');
  });
}

/** How far the line `topOfScreen` found has moved on the page since. */
async function movedSince(page: Page, before: { spot: Spot; top: number }): Promise<number> {
  const top = await page.evaluate((spot) => window.diffView.spotTop(spot), before.spot);
  if (top === undefined) throw new Error('The line at the top of the screen isn’t drawn now.');
  return Math.abs(top - before.top);
}

// An overview's markers in the diff view, on the small pull request, as drawn: markers that arrive
// while the reader is part way down move nothing on screen, side by side or inline; and a note
// opened from its ball, or closed with `Esc` once it's above the screen, leaves the line at the top
// of the screen where it is.

import type { Mark, Spot } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import { expect, fileOf, focusSide, lineOf, press, test } from './suite.ts';

for (const layout of ['split', 'inline'] as const) {
  test(`markers that arrive late move nothing on screen, ${name(layout)}`, async ({ page }) => {
    await partWay(page, layout);
    const before = await topOfScreen(page);
    const middle = await middleOfScreen(page);
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
    expect(await movedSince(page, before)).toBeLessThanOrEqual(0.5);
    if (layout === 'split') {
      expect(await page.evaluate(() => window.diffView.misalignment().worst)).toBeLessThanOrEqual(
        0.5,
      );
    }
    // And going, they move nothing either.
    await page.evaluate(() => window.perfOverview([]));
    await expect(page.locator('.lo-ov-marker')).toHaveCount(0);
    await frames(page, 10);
    expect(await movedSince(page, before)).toBeLessThanOrEqual(0.5);
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
    await page.locator('.lo-ov-marker:visible').first().click();
    await expect(page.locator('.lo-ovnote:visible')).toHaveCount(1);
    await expect(page.locator('.lo-ov-marker.is-open:visible')).toHaveCount(1);
    await frames(page, 10);
    expect(await movedSince(page, top)).toBeLessThanOrEqual(0.5);
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
    await page.evaluate(() => {
      const box = document.querySelector('.lo-diffview')!;
      const notes = [...document.querySelectorAll('.lo-ovnote')].filter(
        (note) => note.getClientRects().length > 0,
      );
      const bottom = Math.max(...notes.map((note) => note.getBoundingClientRect().bottom));
      box.scrollTop += bottom - box.getBoundingClientRect().top + 60;
    });
    await frames(page, 10);
    let top = await topOfScreen(page);
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
    top = await topOfScreen(page);
    await page.evaluate(() => window.perfOverview([]));
    await frames(page, 10);
    expect(await movedSince(page, top)).toBeLessThanOrEqual(0.5);
    await expect(page.locator('.lo-ovnote')).toHaveCount(0);
  });
}

function name(layout: 'split' | 'inline'): string {
  return layout === 'split' ? 'side by side' : 'inline';
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

function mark(file: string, side: 'old' | 'new', from: number, to: number): Mark {
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

/** Scrolls part way down `src/app.ts`, in `layout`, and waits for the scroll to settle. */
async function partWay(page: Page, layout: 'split' | 'inline'): Promise<void> {
  if (layout === 'inline') {
    await focusSide(page, 'new');
    await press(page, 'g', 'i');
    await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('inline');
  }
  await page.evaluate(() => {
    document.querySelector('.lo-diffview')!.scrollTop = 1600;
  });
  await frames(page, 10);
}

/** The line of `src/app.ts`, or whichever file is there, in the middle of the screen. */
async function middleOfScreen(page: Page): Promise<{ file: string; line: number }> {
  const spot = await page.evaluate(() => {
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    for (let y = (box.top + box.bottom) / 2; y < box.bottom; y += 4) {
      const found = window.diffView.spotAt(y);
      if (found?.kind === 'line') return found;
    }
    return undefined;
  });
  const file = fileOf(spot);
  const line = lineOf(spot);
  if (!file || !line || line < 4) throw new Error('No line is in the middle of the screen.');
  return { file, line };
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

/** Waits for `count` frames. */
function frames(page: Page, count: number): Promise<void> {
  return page.evaluate(async (left) => {
    for (let frame = 0; frame < left; frame++) await new Promise(requestAnimationFrame);
  }, count);
}

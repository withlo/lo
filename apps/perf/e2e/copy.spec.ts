// A file shown first as GitHub's diff, with the unchanged lines between its hunks left out, then
// filled in place as the local copy brings the whole file.

import { code, cursor, expect, files, focusSide, lineOf, press, test } from './suite.ts';

/** 400 lines, four of them changed, and every line farther than 3 from a change left out. */
const changed = new Set([50, 150, 250, 350]);
const before = code('copy', 400);
const after = before.map((line, index) => (changed.has(index + 1) ? `${line} // changed` : line));
const shown = (line: number): boolean => [...changed].some((each) => Math.abs(each - line) <= 3);
const gaps = (['old', 'new'] as const).flatMap((side) => {
  const out: { side: 'old' | 'new'; from: number; to: number }[] = [];
  for (let line = 1; line <= 400; line++) {
    if (shown(line)) continue;
    const last = out.at(-1);
    if (last && last.to === line - 1) last.to = line;
    else out.push({ side, from: line, to: line });
  }
  return out;
});

test.use({
  pull: {
    repo: 'withlo/example',
    number: 1,
    copyWhenAsked: true,
    files: [
      {
        path: 'src/copy.ts',
        status: 'modified',
        old: `${before.join('\n')}\n`,
        new: `${after.join('\n')}\n`,
        gaps,
      },
      ...files,
    ],
    threads: [],
  },
});

test('the local copy fills the gaps in place: the cursor and the scroll stay', async ({ page }) => {
  const missing = page.locator('.lo-collapsed', { hasText: 'not loaded yet' });
  await expect(missing.first()).toBeVisible();
  await focusSide(page, 'new');
  // To the third change, below two gaps, in the middle of the screen.
  await press(page, 'g', 'g', ']', 'c', ']', 'c', ']', 'c', 'l', 'l', 'z', 'z');
  await page.waitForTimeout(300);
  const scroller = page.locator('.lo-diffview');
  const was = {
    cursor: await cursor(page),
    scroll: await scroller.evaluate((element) => element.scrollTop),
  };
  expect(lineOf(was.cursor?.at)).toBe(250);
  expect(await missing.count()).toBeGreaterThan(0);
  // The copy comes, once its diff is worked out.
  await expect.poll(() => page.evaluate(() => window.perfCopy()), { timeout: 10_000 }).toBe(1);
  await expect(missing).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(300);
  const now = await cursor(page);
  expect(now?.at).toEqual(was.cursor?.at);
  expect(Math.abs((now?.top ?? 0) - (was.cursor?.top ?? 0))).toBeLessThanOrEqual(1);
  expect(
    Math.abs((await scroller.evaluate((element) => element.scrollTop)) - was.scroll),
  ).toBeLessThanOrEqual(1);
});

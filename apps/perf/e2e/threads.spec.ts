// Review threads in the diff view, on the small pull request, side by side and inline. The line at
// the top of the screen and the one in its middle are watched every frame while a thread arrives
// above the screen, and then grows there: neither may move. And what the reader sends from a
// comment box on screen, a thread and then a reply in it, comes at once and whole, the box's line
// kept where it is.

import type { Place } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import {
  cursor,
  expect,
  frames,
  inBox,
  name,
  partWay,
  press,
  stopWatching,
  test,
  watch,
} from './suite.ts';

test('a thread that arrives or grows above the screen moves nothing on it, side by side and inline', async ({
  page,
}) => {
  for (const layout of ['split', 'inline'] as const) {
    await partWay(page, layout);
    const above = await lineAbove(page, 200);
    const said = `Arrived ${name(layout)}.`;
    await watch(page);
    await page.evaluate(({ at, comments }) => window.perfThread(at, comments), {
      at: above,
      comments: [comment(`${said} ${'A thread that came late. '.repeat(12)}`)],
    });
    const thread = page.locator('.lo-diffthread__thread', { hasText: said });
    await expect(thread).toHaveCount(1);
    await frames(page, 10);
    await page.evaluate(({ at, comments }) => window.perfThread(at, comments), {
      at: above,
      comments: [comment(said), comment('And a reply. '.repeat(20))],
    });
    await expect(thread).toContainText('And a reply.');
    await frames(page, 10);
    expect(await stopWatching(page)).toEqual([]);
    // It's drawn above the screen, not on it.
    const screen = await page.locator('.lo-diffview').boundingBox();
    const drawn = await thread.boundingBox();
    if (!screen || !drawn) throw new Error('The thread isn’t drawn.');
    expect(drawn.y + drawn.height).toBeLessThan(screen.y);
  }
});

test('a comment and a reply sent from a box on screen come at once and whole, side by side and inline', async ({
  page,
}) => {
  for (const layout of ['split', 'inline'] as const) {
    await partWay(page, layout);
    // The cursor on a line in the middle of the screen, as a click puts it.
    const label = layout === 'split' ? 'After' : 'Changes';
    const column = await page.locator(`.cm-content[aria-label="${label}"]`).boundingBox();
    const screen = await page.locator('.lo-diffview').boundingBox();
    if (!column || !screen) throw new Error('The view isn’t drawn.');
    await page.mouse.click(column.x + 120, screen.y + screen.height / 2);
    await frames(page, 5);
    const spot = (await cursor(page))?.at;
    if (spot?.kind !== 'line') throw new Error('The cursor isn’t on a line.');
    const lineTop = () => page.evaluate((at) => window.diffView.spotTop(at), spot);
    const said = `Sent ${name(layout)}.`;
    for (const text of [said, `Replied ${name(layout)}. ${'And more. '.repeat(30)}`]) {
      await press(page, 'c');
      await expect.poll(() => inBox(page)).toBe(true);
      await page.keyboard.type(text);
      await frames(page, 5);
      const before = await lineTop();
      await press(page, 'ControlOrMeta+Enter');
      await expect.poll(() => inBox(page)).toBe(false);
      await frames(page, 5);
      expect(await lineTop()).toBe(before);
    }
    const thread = page.locator('.lo-diffthread__thread', { hasText: said });
    await expect(thread).toContainText('And more.');
    await expect(thread).not.toHaveClass(/is-held/);
    const heights = await thread.evaluate((element) => ({
      kept: element.getBoundingClientRect().height,
      drawn: element.firstElementChild?.getBoundingClientRect().height,
    }));
    expect(heights.kept).toBe(heights.drawn);
  }
});

/** A reviewer's comment that says `body`. */
function comment(body: string): { author: string; body: string } {
  return { author: 'reviewer', body };
}

/** A line of a file drawn `by` pixels or more above the screen, on the side the screen follows. */
async function lineAbove(page: Page, by: number): Promise<Place> {
  const spot = await page.evaluate((distance) => {
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    for (let y = box.top - distance; y > box.top - distance - 400; y -= 4) {
      const found = window.diffView.spotAt(y);
      if (found?.kind === 'line') return found;
    }
    return undefined;
  }, by);
  if (spot?.kind !== 'line') throw new Error('No line is drawn above the screen.');
  const { file, side, line } = spot.at;
  return { file, side, line };
}

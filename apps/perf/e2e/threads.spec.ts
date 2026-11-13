// Review threads in the diff view, on the small pull request, side by side and inline. The line at
// the top of the screen and the one in its middle are watched every frame while a thread arrives
// above the screen, and then grows there: neither may move.

import type { Place } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import { expect, frames, name, partWay, stopWatching, test, watch } from './suite.ts';

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

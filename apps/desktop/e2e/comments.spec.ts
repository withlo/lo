// Review threads in the diff: Lo, started on the replay server as rozed-bot, reads the threads on
// the comments fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94, and marks each beside
// its lines, with an outdated one left out, as Lo starts: a bubble that opens the thread over the
// code, moving no line. Between lines, from Settings or the View menu, it draws them under their
// lines, or a file's under its header, unresolved ones open and resolved ones collapsed, those on
// the first screen with it. Each file's header and its row in the tree count them, `]t` and `[t`
// walk them, and `za` opens or collapses the one the cursor is on. Comments are drawn as GitHub
// renders them, images and all. A renamed file's thread under one of its old lines shows there. A
// stack's layer shows its own threads, and its overview's code block the one on its lines. The
// threads panel, `⌘⇧\`, lists them, without moving the diff's lines, and shows one in the diff, an
// outdated one in the whole diff of the revision it was written on, which `⌃o` and `⌃i` compare
// again; the last thread asked for wins. The stack's rows count each layer's unresolved threads.
// Beside lines, Reply and Edit in a code block's popover write there, whatever other boxes are
// drawn, in the timeline or the diff, and a draft opens there again by its mark, `⏎` on its line or
// a toast's "Show thread". A code block cut off as its code came shows whole as the cursor goes
// into what's cut off, and `⏎` there opens the thread's popover under its line.

import { writeFileSync } from 'node:fs';

import { COMMENTS_PULL, COMMENTS_RENAME_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import {
  appFolder,
  barItem,
  clickBarItem,
  DIFF_FIRST,
  DIFF_FIRST_BETWEEN,
  expect,
  frontOf,
  keepMenus,
  KEYCHAIN,
  onStacks,
  STACK,
  tabBanners,
  test as base,
} from './app.ts';
import { serveBodies } from './bodies.ts';

const cmd = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** The cassette, recorded from the app on the comments fixture. */
const CASSETTE = 'app_comments';

const test = base.extend<{
  github: ReplayServer;
  githubOrigin: string;
  remote: string;
  /** Whether the remote is written only once the test says, so the local copy comes late. */
  lateRemote: boolean;
}>({
  lateRemote: [false, { option: true }],
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay(CASSETTE);
    await use(server);
    await server.close();
  },
  githubOrigin: async ({ github }, use) => {
    const front = await serveBodies(CASSETTE, new URL(github.urls.api).origin);
    await use(front.origin);
    await front.close();
  },
  remote: async ({ lateRemote }, use) => {
    const folder = test.info().outputPath('remote');
    await use(lateRemote ? `file://${folder}` : writeCommentsRemote(folder));
  },
  launch: async ({ githubOrigin, remote }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: githubOrigin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT_REMOTE: remote },
    });
  },
});

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });
onStacks.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens pull request `number`'s tab. */
async function open(page: Page, number: number): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** The threads the diff on screen draws under its lines: each one's file, side and line. */
function placed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const diff = window.loDiff;
    if (!diff) return [];
    const paths = new Map(diff.files.map((file) => [file.id, file.path]));
    return diff
      .threads()
      .map(({ at }) => {
        const where = 'line' in at ? `${at.side} ${at.line}` : 'file';
        return `${paths.get(at.file) ?? at.file} ${where}`;
      })
      .toSorted();
  });
}

/**
 * The threads the whole pull request's diff, at its latest push, draws under their lines, and the
 * file's own under its header.
 */
const AT_HEAD = [
  'docs/usage.md file',
  'src/backoff.ts new 15',
  'src/backoff.ts new 17',
  'src/backoff.ts new 2',
  'src/backoff.ts new 5',
  'src/backoff.ts new 8',
  'src/queue.ts new 10',
  'src/queue.ts new 35',
  'src/retry.ts new 16',
  'src/retry.ts old 2',
];

/** Where the diff's cursor is: its file's path, its side and its line. */
function cursor(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (reading?.at.kind !== 'line') return undefined;
    const { file, side, line } = reading.at.at;
    const path = window.loDiff?.files.find((each) => each.id === file)?.path;
    return `${path} ${side} ${line}`;
  });
}

/** A thread's card, by a few words of its first comment. */
const card = (page: Page, words: string) =>
  page.locator('[data-lo-diff] [role="group"][aria-label$="thread by rozed-bot"]').filter({
    hasText: words,
  });

/** A collapsed thread's card's one line: a button that opens it. */
const openCard = (page: Page, words: string) =>
  card(page, words).locator('button[aria-expanded="false"]');

/** The threads panel. */
const panel = (page: Page) => page.locator('[data-lo-threads]');

/** The rows the threads panel lists: each one's file and where it says the thread is. */
function rows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-lo-threads] [role="option"]')].map(
      (row) =>
        `${row.closest('[role="group"]')?.getAttribute('aria-label')} ${row.querySelector('.code-small')?.textContent}`,
    ),
  );
}

/** The row the keyboard is on in the threads panel. */
const focusedRow = (page: Page) => panel(page).locator('[role="option"][aria-selected="true"]');

/** The threads panel's filter that says `name`: its word and its count. */
const filter = (page: Page, name: string) => panel(page).getByRole('tab', { name, exact: true });

/** Whether focus is in the threads panel's list. */
function inPanel(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('[data-lo-scope="threads"]') !== null);
}

/**
 * How far below the top of the diff's box src/backoff.ts's new line `line`, or line 10, is drawn,
 * to the pixel.
 */
function lineTop(page: Page, line = 10): Promise<number> {
  return page.evaluate((at) => {
    const diff = window.loDiff;
    const file = diff?.files.find((each) => each.path === 'src/backoff.ts')?.id;
    const box = document.querySelector('.lo-diffview')?.getBoundingClientRect().top;
    if (!diff || file === undefined || box === undefined) return Number.NaN;
    const top = diff.probe.spotTop({ kind: 'line', at: { file, side: 'new', line: at } });
    return top === undefined ? Number.NaN : Math.round(top - box);
  }, line);
}

/** How far src/backoff.ts's new line 10 has moved since it was `before` below the diff's top. */
async function moved(page: Page, before: number): Promise<number> {
  return Math.abs((await lineTop(page)) - before);
}

/**
 * Waits for tab `id`'s local copy to be ready, and the banner that says it's fetching to have gone.
 * The banner comes over the diff just after the tab opens, moving the diff's box down, and goes once
 * the fetch is done, moving it back up. A line a jump put at the top goes down with the box, and
 * stays where it is on the page as the box goes back up: below the box's top, it's then as much
 * lower as the banner was tall.
 */
async function localCopy(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate((tab) => window.lo.invoke('tab.state', { id: tab }), id);
        return reply.ok ? reply.value : reply;
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ local: { state: { kind: 'ready' } } });
  await expect(tabBanners(page)).toHaveCount(0);
}

/** `⌘⇧\`, which opens and closes the threads panel. */
const PANEL = `${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+Backslash`;

/**
 * What tab `id` compares, as main says: `whole` for the whole pull request, `coming` while another
 * comparison is on its way, or `other`.
 */
function compared(page: Page, id: string): Promise<string> {
  return page.evaluate(async (tab) => {
    const reply = await window.lo.invoke('revisions.list', { id: tab });
    const view: unknown = reply.ok ? reply.value : undefined;
    if (typeof view !== 'object' || view === null) return 'other';
    if (!('pending' in view) || !('comparison' in view) || !('shown' in view)) return 'other';
    if (view.pending !== null) return 'coming';
    const { comparison } = view;
    if (typeof comparison !== 'object' || comparison === null) return 'other';
    if (!('from' in comparison) || !('to' in comparison)) return 'other';
    return comparison.from === null && comparison.to === view.shown ? 'whole' : 'other';
  }, id);
}

/** Waits for the middle view to take focus, as it does once it's drawn, so keys reach it. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => document.activeElement?.closest('[data-lo-middle-view]') !== null),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test.describe('between lines', () => {
  test.use({ settings: DIFF_FIRST_BETWEEN });

  test('draws threads under their lines, resolved ones collapsed, and counts them', async ({
    page,
  }) => {
    await open(page, COMMENTS_PULL.number);
    // Every thread on a line the diff of the latest push shows, and the one on docs/usage.md, which
    // is on the file, under its header: the outdated one isn't.
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    // The threads on the first screen come with it. An unresolved thread is open, its text drawn as
    // GitHub renders it, a suggestion as the change it suggests; the resolved one is collapsed to one
    // line.
    await expect(card(page, 'Start a little higher?')).toContainText('Suggested change');
    await expect(openCard(page, 'Is doubling enough?')).toBeVisible();
    await expect(card(page, 'Is doubling enough?')).toContainText('1 reply');
    await expect(page.getByText('This grows without bound')).toHaveCount(0);
    // Each line's threads have a bubble in the gutter, a button a screen reader reaches, named for
    // the thread and saying whether it's open; the file's own, in its header.
    const bubble = (name: string) => page.getByRole('button', { name, exact: true });
    await expect(bubble('Unresolved thread · line 2')).toHaveAttribute('aria-expanded', 'true');
    await expect(bubble('Resolved thread · line 5')).toHaveAttribute('aria-expanded', 'false');
    await expect(bubble('Unresolved thread · file')).toHaveAttribute('aria-expanded', 'true');

    // A file's header and its row in the tree count its threads, and how many are unresolved.
    // The file's own header, whose right column has the count: the copy pinned under the diff bar
    // is hidden from screen readers.
    const header = page
      .locator('[data-lo-diff] .cm-editor .lo-diffhead--end[data-path="src/backoff.ts"]')
      .first();
    await expect(header.getByRole('img', { name: '4 / 5 threads unresolved' })).toHaveClass(
      /is-open/,
    );
    const tree = page.locator('[data-lo-scope="tree"]');
    await expect(tree.getByRole('img', { name: '4 / 5 threads unresolved' })).toBeVisible();
    await expect(tree.getByRole('img', { name: '1 unresolved' })).toHaveCount(1);
  });

  test('walks the threads with ]t and [t, and opens or collapses one with za', async ({ page }) => {
    await open(page, COMMENTS_PULL.number);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toHaveLength(10);
    await settled(page);
    await page.keyboard.press(']');
    await page.keyboard.press('t');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
    await page.keyboard.press(']');
    await page.keyboard.press('t');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 5');

    // The resolved thread there opens, and collapses again.
    await page.keyboard.press('z');
    await page.keyboard.press('a');
    await expect(openCard(page, 'Is doubling enough?')).toHaveCount(0);
    await expect(card(page, 'Is doubling enough?')).toContainText('It is for three tries.');
    await page.keyboard.press('z');
    await page.keyboard.press('a');
    await expect(openCard(page, 'Is doubling enough?')).toBeVisible();

    // An image attached to a comment loads, through main, as rozed-bot.
    for (const at of ['src/backoff.ts new 8', 'src/backoff.ts new 15']) {
      await page.keyboard.press(']');
      await page.keyboard.press('t');
      await expect.poll(() => cursor(page)).toBe(at);
    }
    const image = card(page, 'The spread, as measured').getByRole('img', { name: 'two by two' });
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
        timeout: 20_000,
      })
      .toBe(2);

    await page.keyboard.press('[');
    await page.keyboard.press('t');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');

    // Side by side, ]t goes on through the files to a thread under the base's line, landing beside
    // it, and za there collapses that thread.
    for (const at of [
      'src/backoff.ts new 15',
      'src/backoff.ts new 17',
      'src/queue.ts new 10',
      'src/queue.ts new 35',
    ]) {
      await page.keyboard.press(']');
      await page.keyboard.press('t');
      await expect.poll(() => cursor(page)).toBe(at);
    }
    await page.keyboard.press(']');
    await page.keyboard.press('t');
    await expect.poll(() => cursor(page)).toMatch(/^src\/retry\.ts new \d+$/);
    await expect(openCard(page, 'The fixed second is gone')).toHaveCount(0);
    await page.keyboard.press('z');
    await page.keyboard.press('a');
    await expect(openCard(page, 'The fixed second is gone')).toBeVisible();
  });
});

test.describe('beside lines', () => {
  test('a thread opens over the code, under its line, moving none, and closes on Esc', async ({
    page,
  }) => {
    const id = await open(page, COMMENTS_PULL.number);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    await settled(page);
    await localCopy(page, id);
    // Beside lines, as Lo starts, the diff draws its threads as their bubbles alone.
    await expect(card(page, 'Start a little higher?')).toHaveCount(0);
    const bubble = page.getByRole('button', { name: 'Unresolved thread · line 2', exact: true });
    await expect(bubble).toHaveAttribute('aria-expanded', 'false');
    const before = await lineTop(page);

    // A click pins it: under the line, its left edge on the lane's, and no line moves.
    await bubble.click();
    const popover = page.getByRole('dialog', { name: 'Unresolved thread · line 2' });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Start a little higher?');
    await expect(popover).toContainText('Line 2');
    await expect(bubble).toHaveAttribute('aria-expanded', 'true');
    await expect(popover.getByRole('button', { name: 'Close thread' })).toBeVisible();
    expect(await moved(page, before)).toBe(0);
    // 520 wide, its left edge on the lane's, or, where that would take it past the pane's edge,
    // back to 8 inside it, and off its scrollbar.
    const edges = await bubble.evaluate((element) => {
      const cell = element.closest('.cm-gutterElement')!.getBoundingClientRect();
      const lane = element.closest('.lo-threadlane')!.getBoundingClientRect();
      const pane = document.querySelector('.lo-diffview')!;
      const box = pane.getBoundingClientRect();
      const right = Math.min(box.left + pane.clientLeft + pane.clientWidth, box.right - 8);
      const shown = document.querySelector('.lo-threadpop')!.getBoundingClientRect();
      return {
        gap: Math.round(shown.top - cell.bottom),
        width: Math.round(shown.width),
        across: Math.round(shown.left - lane.left) === 0 || Math.round(right - shown.right) === 0,
      };
    });
    expect(edges).toEqual({ gap: 4, width: 520, across: true });
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
    // Focus is in it, on no comment, `Tab` goes to its controls, and `j` rings its first comment.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
      .toBe(true);
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest('[role="dialog"]') ? document.activeElement.tagName : '',
        ),
      )
      .toBe('BUTTON');
    await page.keyboard.press('j');
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('[data-comment]')?.textContent ?? ''),
      )
      .toContain('Start a little higher?');

    // Esc closes it, focus going back to its line.
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
    await settled(page);

    // `]t` pins the next thread's, focus staying in the code; `⏎` moves into it.
    await page.keyboard.press(']');
    await page.keyboard.press('t');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 5');
    const next = page.getByRole('dialog', { name: 'Resolved thread · line 5' });
    await expect(next).toBeVisible();
    await settled(page);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(next).toBeHidden();
    await settled(page);
    expect(await moved(page, before)).toBe(0);
  });

  test('the View menu’s pair puts threads between lines and back, each checked while it’s on, the cursor’s row staying put', async ({
    app,
    page,
  }) => {
    if (process.platform !== 'darwin') await keepMenus(app);
    const id = await open(page, COMMENTS_PULL.number);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    await settled(page);
    await localCopy(page, id);
    const checked = async () => ({
      beside: await barItem(app, page, 'comments.threadsBeside'),
      between: await barItem(app, page, 'comments.threadsBetween'),
    });
    await expect.poll(checked).toEqual({ beside: true, between: false });
    // The cursor on line 2, whose thread's card comes under it.
    const bubble = page.getByRole('button', { name: 'Unresolved thread · line 2', exact: true });
    await bubble.click();
    await page.keyboard.press('Escape');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
    await settled(page);
    const top = await lineTop(page, 2);
    await expect(card(page, 'Start a little higher?')).toBeHidden();

    await clickBarItem(app, page, 'comments.threadsBetween');
    await expect(card(page, 'Start a little higher?')).toBeVisible();
    await expect.poll(checked).toEqual({ beside: false, between: true });
    expect(Math.abs((await lineTop(page, 2)) - top)).toBeLessThanOrEqual(1);

    await clickBarItem(app, page, 'comments.threadsBeside');
    await expect(card(page, 'Start a little higher?')).toBeHidden();
    await expect.poll(checked).toEqual({ beside: true, between: false });
    expect(Math.abs((await lineTop(page, 2)) - top)).toBeLessThanOrEqual(1);
  });
});

test('a thread under a renamed file’s old line shows in its older column', async ({ page }) => {
  // GitHub names it by the file's new path, docs/guide.md, on the base's side.
  await open(page, COMMENTS_RENAME_PULL.number);
  await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['docs/guide.md old 5']);
  // Its bubble is in the older column's lane.
  const bubble = page
    .locator('[data-lo-diff] .cm-editor')
    .filter({ has: page.locator('.cm-content[aria-label="Before"]') })
    .getByRole('button', { name: 'Unresolved thread · line 5, removed', exact: true });
  await expect(bubble).toBeVisible();
  await bubble.click();
  await expect(card(page, 'The old wording said a second apart.')).toBeVisible();
  const tree = page.locator('[data-lo-scope="tree"]');
  await expect(tree.getByRole('img', { name: '1 unresolved' })).toBeVisible();
});

for (const mode of ['beside', 'between'] as const) {
  test.describe(`${mode} lines`, () => {
    // On the overview first, drawn on screen before the diff is.
    onStacks.use({
      settings:
        mode === 'between'
          ? '{ "tab.open": "overview", "comments.threads": "between" }\n'
          : '{ "tab.open": "overview" }\n',
    });

    onStacks(
      'a layer of a stack shows its own threads, on its overview’s code block and in its diff',
      async ({ page }) => {
        test.setTimeout(60_000);
        await open(page, STACK.b);

        await test.step(`its overview’s code block on those lines shows the thread ${mode} lines`, async () => {
          const block = codeBlock(page, 'src/cost.ts');
          await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
          const thread = '[role="group"][aria-label$="thread by rozed-bot"]';
          if (mode === 'between') {
            await expect(block.locator(thread)).toContainText('GitHub rounds each 100 nodes up');
            // Under line 5, the line it's on.
            const above = await block
              .locator(thread)
              .evaluate(
                (element) =>
                  element.closest('.cm-content > *')?.previousElementSibling?.textContent,
              );
            expect(above).toBe('  return Math.max(1, Math.ceil(nodes / 100));');
            // Under its line, it takes room of its own.
            expect((await rowsOf(block)).gap).toBeGreaterThan(20);
          } else {
            // Its mark beside line 5, and nothing under the line: the block is as tall as its lines,
            // as it would be with no thread.
            const mark = block.getByRole('button', {
              name: 'Unresolved thread · line 5',
              exact: true,
            });
            await expect(mark).toBeVisible();
            await expect(block.locator(thread)).toHaveCount(0);
            const drawn = await rowsOf(block);
            expect(drawn.others).toBe(0);
            expect(Math.abs(drawn.gap)).toBeLessThanOrEqual(1);
            // A click pins its popover, over the code in the overview's own scroll.
            await mark.click();
            const popover = page.locator(
              '[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop',
            );
            await expect(popover.locator(thread)).toContainText('GitHub rounds each 100 nodes up');
            // `]t` there moves between the diff's threads, which the block hasn't.
            await page.keyboard.press(']');
            await page.keyboard.press('t');
            await expect(page.getByText('Go to the diff first')).toBeVisible();
            await expect(popover).toBeVisible();
            // `Esc` closes it, focus going back to its line in the block.
            await page.keyboard.press('Escape');
            await expect(popover).toBeHidden();
            await expect
              .poll(() =>
                page.evaluate(
                  () => document.activeElement?.closest('.lo-codeblock')?.textContent ?? '',
                ),
              )
              .toContain('src/cost.ts');
          }
        });

        // Its diff has it too. (The layer below, whose overview the cassette hasn't, is the
        // threads panel's test's, from the diff.)
        await page.keyboard.press('`');
        await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
        await expect(
          page.locator('[data-lo-diff]').getByRole('button', {
            name: 'Unresolved thread · line 5',
            exact: true,
          }),
        ).toBeVisible();
      },
    );
  });
}

/** A stack layer's overview's code block on `path`. */
function codeBlock(page: Page, path: string) {
  return page
    .locator('[data-lo-middle-view="overview.view"] .lo-codeblock')
    .filter({ has: page.locator('.lo-codeblock__path', { hasText: path }) });
}

/**
 * What a code block's code draws besides its lines, and how much taller it is than its lines: none
 * and 0 where nothing but its code is in its flow.
 */
function rowsOf(block: ReturnType<typeof codeBlock>): Promise<{ others: number; gap: number }> {
  return block.locator('.cm-content[role="textbox"]').evaluate((content) => {
    const children = [...content.children];
    const lines = children.filter((child) => child.classList.contains('cm-line'));
    const height = lines.reduce((sum, line) => sum + line.getBoundingClientRect().height, 0);
    const style = getComputedStyle(content);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      others: children.length - lines.length,
      gap: Math.round(content.getBoundingClientRect().height - padding - height),
    };
  });
}

/**
 * The comment box an overview's code block draws, beside lines, in the popover over the overview,
 * which has focus, the diff hidden.
 */
async function popoverBox(page: Page) {
  const box = page.locator(
    '[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop .lo-diffcomposer',
  );
  await expect(box).toHaveCount(1, { timeout: 20_000 });
  await expect(box.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.lo-diffview')).toBeHidden();
  return box;
}

/** A write Lo sends GitHub, held on its way. */
interface HeldWrite {
  /** Resolves once Lo has sent one. */
  sent: Promise<void>;
  /** Cuts each write held, and those to come, unanswered, as a network gone would. */
  drop(): void;
  /** Holds a write until it's dropped. */
  hold(): Promise<void>;
}

/** When GitHub's answers below were made. */
const AT = '2026-11-01T00:00:00Z';

/**
 * What GitHub answers for a pull request's timeline and what goes beside it, which the cassette
 * hasn't, by the query's name: nothing on either.
 */
const EMPTY: Readonly<Record<string, unknown>> = {
  Timeline: {
    author: { __typename: 'User', login: 'rozed-bot' },
    body: '',
    createdAt: AT,
    lastEditedAt: null,
    timelineEvents: { updatedAt: AT },
    timelineItems: {
      filteredCount: 0,
      pageInfo: { hasPreviousPage: false, startCursor: null },
      edges: [],
    },
  },
  PullRequestSidebar: {
    isDraft: false,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    assignees: { nodes: [] },
  },
};

/** GitHub's answer for `query`, if it's one of {@link EMPTY}'s. */
function emptyFor(query: string): Response | undefined {
  const name = /\bquery (\w+)/.exec(query)?.[1];
  const pullRequest = name === undefined ? undefined : EMPTY[name];
  if (pullRequest === undefined) return undefined;
  return Response.json({
    data: {
      rateLimit: { cost: 1, limit: 5000, remaining: 4999, used: 1, resetAt: AT },
      repository: { pullRequest },
    },
  });
}

/**
 * `onStacks`, with GitHub answering for a pull request's timeline, which the cassette hasn't, with
 * an empty one: the timeline, once visited, draws its box. Each write is held on its way until the
 * test drops it.
 */
const withTimeline = onStacks.extend<{ write: HeldWrite }>({
  // oxlint-disable-next-line no-empty-pattern
  write: async ({}, use) => {
    const sent = Promise.withResolvers<void>();
    const dropped = Promise.withResolvers<void>();
    await use({
      sent: sent.promise,
      drop: () => dropped.resolve(),
      hold: async () => {
        sent.resolve();
        await dropped.promise;
        throw new Error('dropped');
      },
    });
    dropped.resolve();
  },
  githubOrigin: async ({ github, write }, use) => {
    const origin = new URL(github.urls.api).origin;
    const front = await frontOf(origin, (url, body) => {
      // The timeline's mark of the reader, larger than the cassette has it.
      if (url.includes('rozed-bot?s=64')) return fetch(`${origin}${url.replace('s=64', 's=40')}`);
      const empty = emptyFor(body);
      if (empty) return Promise.resolve(empty);
      return /\bmutation \w+/.test(body) ? write.hold() : undefined;
    });
    await use(front.origin);
    await front.close();
  },
});

/** Shows the view the header's view switch names `name`. */
async function showView(page: Page, name: 'Overview' | 'Diff' | 'Timeline') {
  await page
    .getByRole('tablist', { name: 'View' })
    .getByRole('tab')
    .filter({ hasText: name })
    .click();
}

/** Shows the timeline, which draws its box for the pull request, then the overview again. */
async function timelineVisited(page: Page) {
  await showView(page, 'Timeline');
  const box = page.locator('[data-lo-middle-view="timeline.view"] .lo-diffcomposer');
  await expect(box).toHaveCount(1, { timeout: 20_000 });
  await showView(page, 'Overview');
  await expect(box).toBeHidden();
}

test.describe('a code block whose code came while it was on screen', () => {
  onStacks.use({ settings: '{ "tab.open": "overview" }\n', holdFetches: true });

  onStacks(
    'shows whole as the cursor comes to a line it cut off, and `⏎` there opens the popover under the line',
    async ({ app, page, held }) => {
      test.setTimeout(90_000);
      // Narrow, so its lines wrap, and its code is taller than the room it kept for it.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(720, 900),
      );
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(720);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      // The local copy is held: it waits, wholly on screen, with a paragraph under it.
      await expect(block.locator('.lo-codeblock__skeleton')).toBeVisible({ timeout: 30_000 });
      await block.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      held.release();
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      const lines = block.locator('[data-lo-excerpt] .cm-line');
      /** How the block is cut: whether it is, and whether line 5 goes on past where it's cut. */
      const cut = () =>
        lines.nth(2).evaluate((line) => {
          const box = line.closest('.lo-held');
          const foot = box?.querySelector('.lo-held__clip')?.getBoundingClientRect().bottom ?? 0;
          return {
            cut: box?.classList.contains('is-cut') ?? false,
            hidden: line.getBoundingClientRect().bottom > foot + 0.5,
          };
        });
      await expect.poll(cut, { timeout: 10_000 }).toEqual({ cut: true, hidden: true });
      const whole = page.getByRole('button', { name: 'Show whole block', exact: true });
      await expect(whole).toBeVisible();

      // The cursor on line 3's first row, which shows: it stays cut. On to line 5, past the cut:
      // it's whole.
      await lines.first().click({ position: { x: 24, y: 6 } });
      expect((await cut()).cut).toBe(true);
      await page.keyboard.press('j');
      await page.keyboard.press('j');
      await expect.poll(cut).toEqual({ cut: false, hidden: false });
      await expect(whole).toHaveCount(0);

      // `⏎` opens its thread's popover under line 5, all of it in sight.
      await page.keyboard.press('Enter');
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await expect(popover).toContainText('GitHub rounds each 100 nodes up');
      await expect(popover).toContainText('Line 5');
      const where = await lines.nth(2).evaluate((line) => {
        const pop = document.querySelector('.lo-ov > .lo-threadpop')!.getBoundingClientRect();
        const scroller = line.closest('.lo-ov')!.getBoundingClientRect();
        const { bottom } = line.getBoundingClientRect();
        return {
          under: pop.top >= bottom - 0.5 && pop.top - bottom <= 12,
          seen: pop.top >= scroller.top && pop.bottom <= scroller.bottom + 0.5,
        };
      });
      expect(where).toEqual({ under: true, seen: true });
    },
  );
});

test.describe('writing in a code block’s popover', () => {
  onStacks.use({ settings: '{ "tab.open": "overview" }\n' });

  onStacks(
    'opened on the overview, Reply opens its box in the thread there, which takes what’s typed, and keeps it as a draft',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      const height = await block.evaluate((element) => element.getBoundingClientRect().height);
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      const box = await popoverBox(page);
      await expect(box.locator('.lo-diffcomposer__head')).toContainText('Reply');
      // In its thread, under its comments, where the card offered the reply.
      await expect(popover.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
      await expect(popover).toContainText('GitHub rounds each 100 nodes up');
      // What's typed is the box's: `x` resolves nothing.
      await page.keyboard.type('Rounded up, x');
      await expect(box.locator('.cm-content')).toHaveText('Rounded up, x');
      // Nothing in the overview moved.
      expect(await block.evaluate((element) => element.getBoundingClientRect().height)).toBe(
        height,
      );
      // `Esc Esc` closes it, keeping its draft: the thread's mark says so, and opens it again.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(box).toHaveCount(0);
      const mark = block.getByRole('button', { name: /^Unresolved thread · line 5 · draft/ });
      await expect(mark).toBeVisible();
      // `⏎` on its line shows the thread, the draft open in it.
      await page.keyboard.press('Enter');
      const again = await popoverBox(page);
      await expect(again.locator('.cm-content')).toHaveText('Rounded up, x');
    },
  );

  onStacks(
    'with the diff drawn and hidden again, `i` in a code block’s popover opens the edit there, which takes what’s typed',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      // The diff is drawn, and the overview comes back over it.
      await page.keyboard.press('`');
      await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
      await settled(page);
      await page.keyboard.press('~');
      await expect(page.locator('.lo-diffview')).toBeHidden();
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await expect(popover).toBeVisible();
      await page.keyboard.press('i');
      const box = await popoverBox(page);
      await expect(box.locator('.cm-content')).toContainText('GitHub rounds each 100 nodes up');
      await page.keyboard.type(' x');
      await expect(box.locator('.cm-content')).toHaveText(/nodes up.* x$/s);
      await expect(
        block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }),
      ).toBeVisible();
    },
  );

  onStacks(
    'with a reply open in the diff, hidden again, Reply in a code block’s popover brings its box there, words and all',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      // The diff is drawn, a reply open in it, with words, and the overview comes back over it.
      await page.keyboard.press('`');
      await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
      await settled(page);
      await page.keyboard.press(']');
      await page.keyboard.press('t');
      await page.keyboard.press('r');
      const inDiff = page.locator('[data-lo-middle-view="diff.view"] .lo-diffcomposer');
      await expect(inDiff.locator('.cm-content')).toBeFocused();
      await page.keyboard.type('From the diff');
      await showView(page, 'Overview');
      await expect(page.locator('.lo-diffview')).toBeHidden();
      await expect(inDiff).toHaveCount(1);
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      // Its card offers a reply: the box open in the diff isn't the block's.
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      // The box comes to the block, its words with it, and takes what's typed: none's in the diff.
      const box = await popoverBox(page);
      await expect(inDiff).toHaveCount(0);
      await page.keyboard.type(', x');
      await expect(box.locator('.cm-content')).toHaveText('From the diff, x');
    },
  );

  withTimeline(
    'with the Timeline visited first, Reply opens its box in the popover, and its draft opens again there by its mark and by `⏎`, each taking what’s typed',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      await timelineVisited(page);
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      let box = await popoverBox(page);
      await page.keyboard.type('Rounded up, x');
      await expect(box.locator('.cm-content')).toHaveText('Rounded up, x');
      // Closed, its draft opens again by its mark.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(box).toHaveCount(0);
      await block.getByRole('button', { name: /^Unresolved thread · line 5 · draft/ }).click();
      box = await popoverBox(page);
      await page.keyboard.type(' twice');
      await expect(box.locator('.cm-content')).toContainText('Rounded up, x');
      await expect(box.locator('.cm-content')).toContainText('twice');
      // And by `⏎` on its line.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(box).toHaveCount(0);
      await page.keyboard.press('Enter');
      box = await popoverBox(page);
      await page.keyboard.type(' and again');
      await expect(box.locator('.cm-content')).toContainText('Rounded up, x');
      await expect(box.locator('.cm-content')).toContainText('and again');
    },
  );

  withTimeline(
    'with the Timeline visited first, `i` opens the edit in the popover, and Edit opens it again there in a reply’s place, each taking what’s typed',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      await timelineVisited(page);
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await expect(popover).toBeVisible();
      await page.keyboard.press('i');
      let edit = await popoverBox(page);
      await expect(edit.locator('.lo-diffcomposer__head')).toContainText('Edit');
      await page.keyboard.type(' x');
      await expect(edit.locator('.cm-content')).toHaveText(/nodes up.* x$/s);
      // Closed, its draft kept, and a reply open in its place, Edit brings the edit back there.
      await page.keyboard.press('Escape');
      await expect(edit).toHaveCount(0);
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      const reply = await popoverBox(page);
      await expect(reply.locator('.lo-diffcomposer__head')).toContainText('Reply');
      await page.keyboard.type('A reply');
      await expect(reply.locator('.cm-content')).toHaveText('A reply');
      await popover.getByRole('button', { name: /^Edit comment from/ }).click();
      edit = await popoverBox(page);
      await expect(edit.locator('.lo-diffcomposer__head')).toContainText('Edit');
      await page.keyboard.type(' y');
      await expect(edit.locator('.cm-content')).toContainText(' x');
      await expect(edit.locator('.cm-content')).toContainText(' y');
    },
  );

  withTimeline(
    'with the Timeline visited first, a reply whose popover closed on its way, then went nowhere, says so in a toast, whose “Show thread” opens it in the popover again, taking what’s typed',
    async ({ page, write }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      await timelineVisited(page);
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      let box = await popoverBox(page);
      await page.keyboard.type('Rounded up, x');
      await page.keyboard.press(`${cmd}+Enter`);
      await write.sent;
      // The popover closes while the reply's on its way, which then goes nowhere.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      write.drop();
      const show = page.getByRole('button', { name: 'Show thread', exact: true });
      await expect(show).toBeVisible({ timeout: 20_000 });
      await show.click();
      box = await popoverBox(page);
      await expect(box.locator('.cm-content')).toContainText('Rounded up, x');
      await page.keyboard.type(' again');
      await expect(box.locator('.cm-content')).toContainText('again');
    },
  );

  onStacks(
    'with an edit open in the diff, hidden again, Reply in a code block’s popover opens its own box there, which takes what’s typed',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      await page.keyboard.press('`');
      await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
      await settled(page);
      await page.keyboard.press(']');
      await page.keyboard.press('t');
      await page.keyboard.press('i');
      const inDiff = page.locator('[data-lo-middle-view="diff.view"] .lo-diffcomposer');
      await expect(inDiff.locator('.cm-content')).toBeFocused();
      await showView(page, 'Overview');
      await expect(page.locator('.lo-diffview')).toBeHidden();
      await block.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }).click();
      const popover = page.locator('[data-lo-middle-view="overview.view"] .lo-ov > .lo-threadpop');
      await popover.getByRole('button', { name: 'Reply', exact: true }).click();
      const box = await popoverBox(page);
      await expect(box.locator('.lo-diffcomposer__head')).toContainText('Reply');
      await page.keyboard.type('A reply, x');
      await expect(box.locator('.cm-content')).toHaveText('A reply, x');
    },
  );

  onStacks(
    '`c` on a code block’s line opens its box in the popover; closed with words, its mark stays beside the line, and opens it again',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      const height = await block.evaluate((element) => element.getBoundingClientRect().height);
      await block.locator('.cm-line:visible').nth(1).click();
      await page.keyboard.press('c');
      const box = await popoverBox(page);
      await page.keyboard.type('A note');
      expect(await block.evaluate((element) => element.getBoundingClientRect().height)).toBe(
        height,
      );
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(box).toHaveCount(0);
      const mark = block.getByRole('button', { name: /^Draft · line/ });
      await expect(mark).toBeVisible();
      await mark.click();
      const again = await popoverBox(page);
      await expect(again.locator('.cm-content')).toHaveText('A note');
    },
  );
});

test.describe('a code block between lines', () => {
  onStacks.use({ settings: '{ "tab.open": "overview", "comments.threads": "between" }\n' });

  onStacks(
    'Reply on a code block’s card says to go to the diff first, and opens nothing',
    async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, STACK.b);
      const block = codeBlock(page, 'src/cost.ts');
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 30_000 });
      const thread = block.locator('[role="group"][aria-label$="thread by rozed-bot"]');
      await thread.getByRole('button', { name: 'Reply', exact: true }).click();
      await expect(page.getByText('Go to the diff first')).toBeVisible();
      // None in the overview, nor in the diff.
      await expect(page.locator('.lo-diffcomposer')).toHaveCount(0);
      await expect(page.locator('.lo-diffview')).toBeHidden();
      await expect(thread.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
    },
  );
});

onStacks(
  'the threads panel shows the layer on screen’s threads, and the stack counts each layer’s',
  async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, STACK.b);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
    await settled(page);
    await page.keyboard.press(PANEL);
    await expect.poll(() => rows(page)).toEqual(['src/cost.ts Line 5']);
    // #B's row, the layer on screen, counts its unresolved thread.
    const stack = page.locator('[data-lo-scope="stack"]');
    await expect(
      stack.locator('[aria-current="true"]').getByRole('img', { name: '1 unresolved thread' }),
    ).toBeVisible();

    // Esc goes back to the diff, whose keys walk the stack.
    await page.keyboard.press('Escape');
    await settled(page);
    await page.keyboard.press('[');
    await page.keyboard.press('s');
    await expect
      .poll(() => page.evaluate(() => window.loDiff?.files.map((file) => file.path)), {
        timeout: 20_000,
      })
      .toEqual(['src/plans.ts']);
    await expect.poll(() => placed(page)).toEqual([]);
    await expect(
      page.getByRole('button', { name: 'Unresolved thread · line 5', exact: true }),
    ).toHaveCount(0);
    // #A, the layer below, has none of its own, and #B's row, off screen now, still counts its one,
    // as read with the layers.
    await expect(panel(page)).toContainText('No threads yet');
    // With nothing listed, there's nothing for Next and Previous to go to.
    const foot = page.locator('[data-lo-threads-foot]');
    for (const name of ['Next', 'Previous']) {
      await expect(foot.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(stack.locator('[aria-current="true"]')).toHaveAttribute(
      'data-key',
      String(STACK.a),
    );
    await expect(
      stack
        .locator(`[role="treeitem"][data-key="${STACK.b}"]`)
        .getByRole('img', { name: '1 unresolved thread' }),
    ).toBeVisible();
    await expect(stack.getByRole('img', { name: /unresolved/ })).toHaveCount(1);
  },
);

test('the threads panel lists the threads and shows one in the diff', async ({ page }) => {
  test.setTimeout(60_000);
  const id = await open(page, COMMENTS_PULL.number);
  await expect.poll(() => placed(page), { timeout: 20_000 }).toHaveLength(10);
  await settled(page);
  // Once the local copy is in, so no banner comes or goes over the diff and moves its box.
  await localCopy(page, id);
  // Down the diff a way, so the line at the top is one a change of width could move. It stays
  // where it is as the panel opens and closes, as it does for the left panel.
  await page.evaluate(() => {
    const file = window.loDiff?.files.find((each) => each.path === 'src/backoff.ts')?.id;
    if (file) {
      window.loDiff?.scrollTo({
        at: { kind: 'line', at: { file, side: 'new', line: 10 } },
        offset: 0,
      });
    }
  });
  // Once it's scrolled there: at the top, below the file's header.
  let before = Number.NaN;
  await expect
    .poll(async () => {
      const y = await lineTop(page);
      const still = y === before;
      before = y;
      return still && y >= 0 && y < 100;
    })
    .toBe(true);

  await test.step('opens and closes, leaving the diff’s lines where they were', async () => {
    const toggle = page.locator('[data-lo-right-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press(PANEL);
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => inPanel(page)).toBe(true);
    await expect.poll(() => moved(page, before)).toBeLessThanOrEqual(1);
    // Closed, focus goes back to the diff.
    await page.keyboard.press(PANEL);
    await expect(panel(page)).toHaveCount(0);
    await settled(page);
    await expect.poll(() => moved(page, before)).toBeLessThanOrEqual(1);
    // Open again, with focus on its list.
    await page.keyboard.press(PANEL);
    await expect.poll(() => inPanel(page)).toBe(true);
    await expect.poll(() => moved(page, before)).toBeLessThanOrEqual(1);
  });

  await test.step('lists the unresolved threads by file, the outdated one by where it was written', async () => {
    await expect
      .poll(() => rows(page))
      .toEqual([
        'docs/usage.md File',
        'src/backoff.ts Line 2',
        'src/backoff.ts Line 8',
        'src/backoff.ts Line 9 · r1',
        'src/backoff.ts Line 15',
        'src/backoff.ts Line 17',
        'src/queue.ts Line 10',
        'src/queue.ts Lines 10–35',
        'src/retry.ts Line 2, removed',
        'src/retry.ts Line 16',
      ]);
    await expect(filter(page, 'Unresolved 10')).toHaveAttribute('aria-selected', 'true');
    await expect(filter(page, 'All 11')).toBeVisible();
    // The header's toggle counts them too.
    await expect(page.locator('[data-lo-right-toggle]')).toHaveAccessibleName(
      'Threads panel 10 unresolved',
    );
  });

  await test.step('shows the thread the keyboard is on in the diff, keeping focus', async () => {
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(focusedRow(page)).toContainText('Line 8');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
    await expect(focusedRow(page)).toHaveAttribute('aria-current', 'true');
    expect(await inPanel(page)).toBe(true);
  });

  await test.step('shows an outdated thread in the whole diff of the revision it was written on', async () => {
    await page.keyboard.press('j');
    await expect(focusedRow(page)).toContainText('Line 9 · r1');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page), { timeout: 20_000 }).toBe('src/backoff.ts new 9');
    expect(await placed(page)).toContain('src/backoff.ts new 9');
    await expect(card(page, 'This grows without bound')).toBeVisible();
    // It says what it shows, with the way back.
    const note = page.getByRole('status').filter({ hasText: 'Showing r1 for this thread' });
    await expect(note.getByRole('button', { name: /^Back/ })).toBeVisible();
  });

  await test.step('goes back to the comparison and the place it left with ⌃o, and on with ⌃i', async () => {
    await page.keyboard.press('Control+o');
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
    await page.keyboard.press('Control+i');
    await expect.poll(() => placed(page), { timeout: 20_000 }).toContain('src/backoff.ts new 9');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 9');
    // Back to the panel's list, where its keys work.
    await panel(page).locator('[data-lo-scope="threads"]').focus();
  });

  await test.step('lists every thread with f, and closes', async () => {
    await page.keyboard.press('f');
    await expect(filter(page, 'All 11')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await rows(page)).length).toBe(11);
    // On the resolved thread, the foot offers to unresolve it, on one line that nothing runs past:
    // each hint with its key where they all fit, as on macOS, and without where they don't, as on
    // Linux, whose "Enter" is wider than "⏎".
    const foot = panel(page).locator('[data-lo-threads-foot]');
    // Up the list to the resolved one, on line 5.
    for (let row = 0; row < 11; row += 1) {
      if ((await focusedRow(page).getByText('Resolved', { exact: true }).count()) > 0) break;
      await page.keyboard.press('k');
    }
    await expect(focusedRow(page).getByText('Resolved', { exact: true })).toBeVisible();
    await expect(foot.getByRole('button', { name: /^Unresolve/ })).toBeVisible();
    await expect(foot.getByRole('button', { name: /^Show/ })).toBeVisible();
    await expect(foot.locator('kbd')).toHaveCount(4);
    const chips = await foot
      .locator('kbd')
      .evaluateAll((each) => each.filter((chip) => chip.checkVisibility()).length);
    expect([0, 4]).toContain(chips);
    expect(
      await foot.evaluate((element) => {
        const buttons = [...element.querySelectorAll('button')].map((each) =>
          each.getBoundingClientRect(),
        );
        const box = element.getBoundingClientRect();
        return {
          fits: element.scrollWidth <= element.clientWidth,
          lines: new Set(buttons.map((each) => Math.round(each.top))).size,
          inside: buttons.every((each) => each.right <= box.right),
        };
      }),
    ).toEqual({ fits: true, lines: 1, inside: true });
    await page.keyboard.press(PANEL);
    await expect(panel(page)).toHaveCount(0);
    await settled(page);
  });
});

/** A threads panel row as one frame shows it. */
interface Drawn {
  key: string;
  top: number;
  height: number;
  /** What the row says after its author: the opening of the thread's first comment. */
  words: string;
}

/**
 * Every frame from now in which the threads panel has rows, until a second and a half after the
 * first one: each row's place and size, and its words.
 */
function framesOfRows(page: Page): Promise<Drawn[][]> {
  return page.evaluate(
    () =>
      new Promise<Drawn[][]>((resolve) => {
        const frames: Drawn[][] = [];
        const start = performance.now();
        let first: number | undefined;
        const tick = (now: number) => {
          const list = document.querySelector('[data-lo-threads] [role="listbox"]');
          const found = [
            ...document.querySelectorAll<HTMLElement>('[data-lo-threads] [role="option"]'),
          ];
          if (list && found.length > 0) {
            first ??= now;
            const listTop = list.getBoundingClientRect().top;
            frames.push(
              found.map((row) => {
                const box = row.getBoundingClientRect();
                const text = row.querySelector('p');
                const author = text?.querySelector('.font-semibold')?.textContent ?? '';
                return {
                  key: row.dataset['key'] ?? '',
                  top: Math.round(box.top - listTop),
                  height: Math.round(box.height),
                  words: (text?.textContent ?? '').slice(author.length).trim(),
                };
              }),
            );
          }
          if ((first !== undefined && now - first > 1500) || now - start > 25_000) resolve(frames);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

test('the threads panel draws each row whole, and nothing in it moves as the openings are read', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page, COMMENTS_PULL.number);
  await expect(page.locator('[data-lo-right-toggle]')).toBeVisible();
  // Opened as the tab is, before its threads are read, so the openings are read as the rows come.
  const sampling = framesOfRows(page);
  await page.keyboard.press(PANEL);
  await expect(panel(page)).toBeVisible();
  const frames = await sampling;
  expect(frames.length).toBeGreaterThan(5);
  // The first frame that has rows has all of them, each with its words.
  const [first] = frames;
  expect(first).toHaveLength(10);
  for (const row of first ?? []) expect(row.words, row.key).not.toBe('');
  // And no frame after it has them anywhere else, or any other size: not one moved.
  expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(1);
});

test.describe('while the local copy is still coming', () => {
  // So r1's whole diff, which needs it, stays coming until the test lets it come.
  test.use({ lateRemote: true });

  test('the last thread asked for is the one the diff shows', async ({ page }) => {
    test.setTimeout(60_000);
    const id = await open(page, COMMENTS_PULL.number);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    await settled(page);
    await page.keyboard.press(PANEL);
    await expect.poll(() => rows(page)).toHaveLength(10);
    for (let step = 0; step < 3; step++) await page.keyboard.press('j');
    await expect(focusedRow(page)).toContainText('Line 9 · r1');
    // The outdated thread asks for r1's whole diff; before it comes, a thread the diff on screen
    // shows is asked for, and stays.
    await page.keyboard.press('Enter');
    await expect.poll(() => compared(page, id)).toBe('coming');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 15');
    // r1 was called off: nothing is coming, and the whole pull request is what's compared, before
    // and after the local copy comes.
    await expect.poll(() => compared(page, id)).toBe('whole');
    writeCommentsRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect(page.locator('footer').getByText('GitHub’s diff', { exact: true })).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    expect(await compared(page, id)).toBe('whole');
    await expect.poll(() => placed(page)).toEqual(AT_HEAD);
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 15');
  });

  test('⌃o calls off a comparison still coming, and takes back what it said', async ({ page }) => {
    test.setTimeout(60_000);
    const id = await open(page, COMMENTS_PULL.number);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(AT_HEAD);
    await settled(page);
    await page.keyboard.press(PANEL);
    await expect.poll(() => rows(page)).toHaveLength(10);
    // new 8, then new 15, past the outdated thread between them.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 15');
    // The outdated thread asks for r1's whole diff, which needs the local copy, so it's coming.
    await page.keyboard.press('k');
    await expect(focusedRow(page)).toContainText('Line 9 · r1');
    await page.keyboard.press('Enter');
    await expect.poll(() => compared(page, id)).toBe('coming');
    const note = page.getByRole('status').filter({ hasText: 'Showing r1 for this thread' });
    await expect(note).toBeVisible();
    // Going back is the last move: r1 is called off, and so is what was said of it.
    await page.keyboard.press('Control+o');
    await expect.poll(() => compared(page, id)).toBe('whole');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
    await expect(note).toHaveCount(0);
    // Nor does r1 come with the local copy.
    writeCommentsRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect(page.locator('footer').getByText('GitHub’s diff', { exact: true })).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    expect(await compared(page, id)).toBe('whole');
    await expect.poll(() => placed(page)).toEqual(AT_HEAD);
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
  });
});

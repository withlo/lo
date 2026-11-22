// Writing comments in the diff: Lo, started on the replay server as rozed-bot, on the comments
// fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94. `c` on a line opens a box under it,
// whose head says what the comment is on, typed in at once, and `⌘⏎` adds it to a pending review
// it starts, as `app_comments_write` recorded from the app; the thread comes under the line. `C`
// opens one whose button sends it at once, as `app_comments_now` recorded. `c` with lines selected
// opens one on them, `s` one with them in a suggestion block, and `c` on a file's header one on
// the file. A box closed with `Esc` keeps its draft on this computer, and after a restart, here
// with GitHub out of reach, it's back, unfocused, saying so; offline, nothing sends, and it stays
// until it's discarded. With Vim keys on, a box has Vim's modes, and says which. With the comment
// pending, `⌘⏎` opens the submit dialog, which offers only Comment on rozed-bot's own pull request
// and submits the review as `app_comments_write` recorded; Approve is offered, and goes, on
// `app_comments_write_others`, derived from it as if someone else had opened the pull request
// (`testing/src/derivations.ts`).

import { writeFileSync } from 'node:fs';

import { cassette as recorded, Replay } from '@lo/testing';
import { COMMENTS_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  dataFolder,
  DIFF_FIRST,
  DIFF_FIRST_VIM,
  expect,
  KEYCHAIN,
  test as base,
} from './app.ts';
import { type BodiesServer, serveBodies } from './bodies.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const cmd = process.platform === 'darwin' ? 'Meta' : 'Control';

const test = base.extend<{
  cassette: string;
  /** The GraphQL operation whose connection drops once its request has come, if any. */
  cut: string | undefined;
  github: ReplayServer;
  front: BodiesServer;
  githubOrigin: string;
  remote: string;
}>({
  cassette: ['app_comments', { option: true }],
  cut: [undefined, { option: true }],
  github: async ({ cassette }, use) => {
    const answers = recorded(cassette).interactions.map(({ interaction }) => interaction);
    const server = await serveReplay(new Replay(cassette, answers));
    await use(server);
    await server.close();
  },
  front: async ({ cassette, cut, github }, use) => {
    const front = await serveBodies(cassette, new URL(github.urls.api).origin, undefined, { cut });
    await use(front);
    await front.close();
  },
  githubOrigin: async ({ front }, use) => {
    await use(front.origin);
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeCommentsRemote(test.info().outputPath('remote')));
  },
  launch: async ({ githubOrigin, remote }, use) => {
    await use({ args: [appFolder, ...KEYCHAIN], env: launchEnvironment(githubOrigin, remote) });
  },
});

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

/** What Lo starts with: GitHub's stand-in, the stand-in token, and the fixture's git. */
function launchEnvironment(githubOrigin: string, remote: string): Record<string, string> {
  const tokenFile = test.info().outputPath('token');
  writeFileSync(tokenFile, `${TOKEN}\n`);
  return { LO_GITHUB: githubOrigin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT_REMOTE: remote };
}

/** Waits for the account from the token file, then opens #94's tab. Its id. */
async function open(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    COMMENTS_PULL.number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** How many threads the diff on screen draws under `line` of `path`'s newer side. */
function threadsUnder(page: Page, path: string, line: number): Promise<number> {
  return page.evaluate(
    ([file, at]) => {
      const diff = window.loDiff;
      const id = diff?.files.find((each) => each.path === file)?.id;
      return (diff?.threads() ?? []).filter(
        (thread) => 'line' in thread.at && thread.at.file === id && thread.at.line === at,
      ).length;
    },
    [path, line] as const,
  );
}

/** Where the diff's cursor is: a file's path, and its side and line, or `header`. */
function cursor(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const diff = window.loDiff;
    const spot = diff?.probe.cursor()?.at;
    if (!spot) return undefined;
    const file = spot.kind === 'line' ? spot.at.file : spot.file;
    const path = diff?.files.find((each) => each.id === file)?.path;
    return spot.kind === 'line' ? `${path} ${spot.at.side} ${spot.at.line}` : `${path} header`;
  });
}

/**
 * Waits for the diff to draw its threads and take focus, then puts the cursor on line 2 of
 * src/backoff.ts, a file the pull request adds, on the newer side, where the first thread is.
 */
async function onLineTwo(page: Page): Promise<void> {
  await expect.poll(() => threadsUnder(page, 'src/backoff.ts', 2), { timeout: 20_000 }).toBe(1);
  await expect
    .poll(
      () => page.evaluate(() => document.activeElement?.closest('[data-lo-middle-view]') !== null),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect(async () => {
    if ((await cursor(page))?.includes(' old ')) await page.keyboard.press('Tab');
    for (const key of ['g', 'g', ']', 'f']) await page.keyboard.press(key);
    expect(await cursor(page)).toBe('src/backoff.ts header');
  }).toPass({ timeout: 30_000 });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
}

/** The comment boxes in the diff. */
const boxes = (page: Page) => page.locator('[data-lo-diff] .lo-diffcomposer');

/** The toast that says `text`. */
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** The comment the review's tests add, and the summary they submit it with, as recorded. */
const COMMENT = 'Does the first wait need a cap?';
const SUMMARY = 'One question inline.';

/**
 * `c` on line 2 of src/backoff.ts, the comment typed and `⌘⏎`, which starts rozed-bot's pending
 * review with it: the box goes, its room held until the reader's next key, and the thread GitHub
 * made comes under the line, pending. The thread.
 */
async function addComment(page: Page): Promise<Locator> {
  await open(page);
  await onLineTwo(page);
  await page.keyboard.press('c');
  const box = boxes(page);
  await expect(box).toHaveCount(1);
  await expect(box.locator('.lo-diffcomposer__head')).toContainText('Line 2');
  // One account is signed in: the head doesn't say whose comment it is.
  await expect(box).not.toContainText('as rozed-bot');
  await expect(box.getByRole('button', { name: /Add to review/ })).toBeVisible();
  // With Vim keys off, as Lo starts, the box is typed in at once, and says no mode.
  await expect(box.locator('.mode-chip')).toHaveCount(0);
  await page.keyboard.type(COMMENT);
  await page.keyboard.press(`${cmd}+Enter`);
  await expect(box).toHaveCount(0, { timeout: 20_000 });
  // The key comes once the thread is read: one read after it would be above the screen, which a
  // thread arriving there doesn't move.
  await expect.poll(() => threadsUnder(page, 'src/backoff.ts', 2), { timeout: 20_000 }).toBe(2);
  await page.keyboard.press('Shift');
  const thread = page.locator('[data-lo-diff] [role="group"]').filter({ hasText: COMMENT });
  await expect(thread).toContainText('Pending', { timeout: 20_000 });
  return thread;
}

/**
 * Opens the submit dialog with `⌘⏎` from the diff, once the status bar counts the pending comment,
 * and waits for its summary to take focus. The dialog.
 */
async function openSubmit(page: Page): Promise<Locator> {
  await expect(page.getByTitle('Submit your review: 1 pending comment')).toContainText('1 pending');
  await page.keyboard.press(`${cmd}+Enter`);
  const dialog = page.getByTestId('submit-review');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 pending comment goes with it');
  await expect(dialog).toContainText(`backoff.ts · line 2${COMMENT}`);
  // The summary's editor takes focus once it's made, in insert mode.
  await expect(dialog.getByRole('textbox', { name: 'Summary' })).toBeFocused();
  return dialog;
}

test.describe('with a write recorded', () => {
  test.use({ cassette: 'app_comments_write' });

  test('`c` on a line opens a box under it, `⌘⏎` adds the comment to a pending review, and `⌘⏎` again submits it', async ({
    page,
  }) => {
    const thread = await addComment(page);
    await test.step('on rozed-bot’s own pull request, the dialog offers only Comment', async () => {
      const dialog = await openSubmit(page);
      await expect(dialog).toContainText('e2e #94 · your PR, so GitHub takes comments only');
      await expect(dialog.getByRole('radio')).toHaveCount(1);
      await expect(dialog.getByRole('radio', { name: /Comment/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(dialog.getByRole('button', { name: /^Comment/ })).toBeVisible();
    });
    await test.step('the summary typed, `⌘⏎` submits the review, and the comment is no longer pending', async () => {
      await page.keyboard.type(SUMMARY);
      await page.keyboard.press(`${cmd}+Enter`);
      await expect(toast(page, 'Commented on #94')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('submit-review')).toBeHidden();
      await expect(thread).not.toContainText('Pending', { timeout: 20_000 });
    });
  });
});

test.describe('as if someone else had opened the pull request', () => {
  test.use({ cassette: 'app_comments_write_others' });

  test('the submit dialog offers every verdict, and Approve submits the review', async ({
    page,
  }) => {
    await addComment(page);
    const dialog = await openSubmit(page);
    await expect(dialog.getByRole('radio')).toHaveText([
      /^Comment/,
      /^Approve/,
      /^Request changes/,
    ]);
    await page.keyboard.type(SUMMARY);
    await dialog.getByRole('radio', { name: /Approve/ }).click();
    await dialog.getByRole('button', { name: /^Approve/ }).click();
    await expect(toast(page, 'Approved #94')).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toBeHidden();
  });
});

test.describe('when the connection drops once a comment has gone', () => {
  test.use({ cassette: 'app_comments_write', cut: 'AddPullRequestReview' });

  test('the comment goes to GitHub once, and Lo looks for it', async ({ page, front }) => {
    const tab = await open(page);
    await onLineTwo(page);
    await page.keyboard.press('c');
    await expect(boxes(page)).toHaveCount(1);
    await page.keyboard.type('Does the first wait need a cap?');
    await page.keyboard.press(`${cmd}+Enter`);
    // Its answer lost, it may have posted: Lo looks for it rather than send it again.
    await expect
      .poll(
        async () =>
          JSON.stringify(
            await page.evaluate((id) => window.lo.invoke('comments.current', { id }), tab),
          ),
        { timeout: 20_000 },
      )
      .toContain('"sending":"checking"');
    expect(front.operations.filter((name) => name === 'AddPullRequestReview')).toHaveLength(1);
  });
});

test.describe('with a comment posted at once recorded', () => {
  test.use({ cassette: 'app_comments_now' });

  test('`C` opens a box whose button sends the comment at once', async ({ page }) => {
    const tab = await open(page);
    await onLineTwo(page);
    await page.keyboard.press('Shift+C');
    const box = boxes(page);
    await expect(box).toHaveCount(1);
    const primary = box.locator('.lo-diffcomposer__foot button').last();
    await expect(primary).toContainText('Send now');
    await page.keyboard.type('Is two the right start?');
    await primary.click();
    // The box goes, its room held until the reader's next key, and then the thread GitHub made
    // comes under the line, posted.
    await expect(box).toHaveCount(0, { timeout: 20_000 });
    // The box can go before the thread is read back: the key comes once Lo has it.
    await expect
      .poll(
        async () =>
          JSON.stringify(
            await page.evaluate((id) => window.lo.invoke('comments.current', { id }), tab),
          ),
        { timeout: 20_000 },
      )
      .toContain('Is two the right start?');
    await page.keyboard.press('Shift');
    await expect.poll(() => threadsUnder(page, 'src/backoff.ts', 2), { timeout: 20_000 }).toBe(2);
    const thread = page
      .locator('[data-lo-diff] [role="group"]')
      .filter({ hasText: 'Is two the right start?' });
    await expect(thread).toBeVisible();
    await expect(thread).not.toContainText('Pending');
  });
});

/**
 * Starts Lo on the test's data folder, with GitHub at `githubOrigin`, out of reach now, and waits
 * for its window.
 */
async function launchOffline(
  githubOrigin: string,
  remote: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      ...launchEnvironment(githubOrigin, remote),
      // Offline shows once it has lasted, here a second rather than the app's own wait.
      LO_OFFLINE_AFTER_MS: '1000',
    },
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { app, page };
}

/** Closes the box focus is in, as `Esc` does, once its head says `where`, emptied first. */
async function closeEmpty(page: Page, where: string): Promise<void> {
  const box = boxes(page);
  await expect(box).toHaveCount(1);
  await expect(box.locator('.lo-diffcomposer__head')).toContainText(where);
  for (const key of [`${cmd}+a`, 'Backspace', 'Escape']) await page.keyboard.press(key);
  await expect(box).toHaveCount(0);
}

test('the `+` the pointer brings beside a line opens a box on that line', async ({ page }) => {
  await open(page);
  await onLineTwo(page);
  // Line 2 of src/backoff.ts is the line over its thread.
  const thread = await page.evaluate(() => {
    const diff = window.loDiff;
    const file = diff?.files.find((each) => each.path === 'src/backoff.ts')?.id;
    return diff
      ?.threads()
      .find((each) => 'line' in each.at && each.at.file === file && each.at.line === 2)?.id;
  });
  expect(thread).toBeDefined();
  const line = page
    .locator(`[data-lo-diff] .cm-content[aria-label="After"] [data-thread-id="${thread}"]`)
    .locator('xpath=preceding::div[contains(concat(" ", @class, " "), " cm-line ")][1]');
  const add = page.locator('[data-lo-diff] .lo-gutteradd');
  await expect(add).toBeHidden();
  // A scroll takes the `+` away until the pointer next moves, so the pointer moves once the line
  // is where it stays.
  await line.scrollIntoViewIfNeeded();
  await expect(async () => {
    await line.hover({ position: { x: 60, y: 6 } });
    await line.hover({ position: { x: 64, y: 8 } });
    await expect(add).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(add).toHaveAccessibleName('Comment');
  await add.click();
  const box = boxes(page);
  await expect(box).toHaveCount(1);
  await expect(box.locator('.lo-diffcomposer__head')).toContainText('Line 2');
  await expect(box.locator('.cm-content')).toBeFocused();
  await expect(add).toBeHidden();
});

test('`c` on lines selected, `s` and a header’s `c` open their boxes; one kept with `Esc` is back after a restart, offline, sending nothing until it’s discarded', async ({
  app,
  page,
  front,
  remote,
}) => {
  test.setTimeout(90_000);
  const tab = await open(page);
  await onLineTwo(page);
  // Shift selects, as in text anywhere, and `c` opens a box under the last of the lines selected,
  // on them all. Closed, the cursor is there.
  for (const key of ['Shift+ArrowDown', 'Shift+ArrowDown', 'c']) await page.keyboard.press(key);
  await closeEmpty(page, 'Lines 2–3');
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 3');
  // `s`: the line in a suggestion block, the cursor in it.
  await page.keyboard.press('s');
  await expect(boxes(page).locator('.cm-content')).toContainText('```suggestion');
  await closeEmpty(page, 'Line 3');
  // `c` on the file's header: on the file, under it.
  for (const key of ['g', 'g', ']', 'f']) await page.keyboard.press(key);
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts header');
  await page.keyboard.press('c');
  await closeEmpty(page, 'File');
  for (const key of ['j', 'j']) await page.keyboard.press(key);
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
  await page.keyboard.press('c');
  const kept = boxes(page);
  await expect(kept).toHaveCount(1);
  // The box opens in view, all of it, with its controls for closing and discarding.
  await expect(kept).toBeInViewport({ ratio: 1 });
  await expect(kept.getByRole('button', { name: 'Close comment box' })).toBeVisible();
  await expect(kept.getByRole('button', { name: 'Discard draft' })).toBeVisible();
  await page.keyboard.type('Kept for later.');
  // One `Esc` closes it, and keeps the draft.
  await page.keyboard.press('Escape');
  await expect(kept).toHaveCount(0);
  // Saved on this computer, as the box closed.
  await expect
    .poll(async () =>
      JSON.stringify(
        await page.evaluate((id) => window.lo.invoke('comments.current', { id }), tab),
      ),
    )
    .toContain('Kept for later.');
  await app.close();

  // GitHub goes away, at the same address.
  await front.close();
  const again = await launchOffline(front.origin, remote);
  try {
    const box = boxes(again.page);
    await expect(box).toHaveCount(1, { timeout: 30_000 });
    await expect(box).toContainText(/Draft from .+/);
    await expect(box.locator('.cm-content')).toHaveText('Kept for later.');
    await expect
      .poll(() =>
        again.page.evaluate(() => document.activeElement?.closest('.lo-diffcomposer') === null),
      )
      .toBe(true);
    // Offline, its buttons are dimmed, saying why, and `⌘⏎` sends nothing: the draft stays.
    const add = box.getByRole('button', { name: /Add to review/ });
    await expect(add).toHaveAccessibleDescription('Offline', { timeout: 20_000 });
    await box.locator('.cm-content').click();
    await again.page.keyboard.press(`${cmd}+Enter`);
    await expect(box).toHaveCount(1);
    await expect
      .poll(async () =>
        JSON.stringify(
          await again.page.evaluate((id) => window.lo.invoke('comments.current', { id }), tab),
        ),
      )
      .toMatch(/"text":"Kept for later\.".*"sending":null/);
    // What the foot's "Discard draft" does is on the frame's right-click menu too, and only what
    // the box offers.
    await box.locator('.lo-diffcomposer__head').click({ button: 'right' });
    const menu = again.page.getByRole('menu', { name: 'Comment box actions' });
    await expect(menu.getByRole('menuitem', { name: /^Discard draft/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Send it anyway/ })).toHaveCount(0);
    await again.page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await box.getByRole('button', { name: 'Discard draft' }).click();
    await expect(box).toHaveCount(0);
    // A toast says so, and its "Undo" opens the box again where it was, with its text.
    const discarded = again.page.locator('.toast', { hasText: 'Discarded draft' });
    await discarded.getByRole('button', { name: 'Undo' }).click();
    await expect(box).toHaveCount(1);
    await expect(box.locator('.cm-content')).toHaveText('Kept for later.');
    await expect(discarded).toHaveCount(0);
    // Emptied, the box has nothing to discard, and says so.
    await box.locator('.cm-content').click();
    await again.page.keyboard.press(`${cmd}+a`);
    await again.page.keyboard.press('Backspace');
    const discard = box.getByRole('button', { name: 'Discard draft' });
    await expect(discard).toBeDisabled();
    await expect(discard).toHaveAccessibleDescription('Nothing to discard');
  } finally {
    await again.app.close();
  }
});

test.describe('with Vim keys on', () => {
  test.use({ settings: DIFF_FIRST_VIM });

  test('a box opens in insert mode and says so; `Esc` leaves it, and `Esc` again closes the box', async ({
    page,
  }) => {
    await open(page);
    await onLineTwo(page);
    const status = page.locator('footer[aria-label="Status"]');
    await expect(status).toContainText('NORMAL');
    // `v` then `c`: on the lines selected.
    for (const key of ['v', 'j', 'c']) await page.keyboard.press(key);
    const box = boxes(page);
    await expect(box.locator('.lo-diffcomposer__head')).toContainText('Lines 2–3');
    // The mode shows once in the focused box, and once in the status bar.
    await expect(box.locator('.mode-chip')).toHaveText('INSERT');
    await expect(status).toContainText('INSERT');
    await page.keyboard.type('Kept.');
    await page.keyboard.press('Escape');
    await expect(box.locator('.mode-chip')).toHaveText('NORMAL');
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 3');
  });
});

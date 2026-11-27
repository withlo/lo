// Acting on review threads in the diff: Lo, started on the replay server as rozed-bot, on the
// comments fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94, as `app_comments_act`
// recorded from the app, beside lines, as Lo starts, and between lines. On line 2's thread, `r`
// opens a reply box, beside lines in its popover where its card offers a reply, between lines
// right after its card, and `⌥⏎` posts the reply; `i` opens a box with the reply's text in its
// place, and `⌘⏎` saves the edit over it; `dd` asks first, and `⏎` deletes it. On line 5's
// resolved thread, `x` unresolves it, and `x` again resolves it; beside lines, the first `x` from
// the line pins its popover, changing nothing. Each change comes into the card as GitHub reads it
// back. In the timeline, as
// `app_comments_box` recorded, `c` puts focus in the box at its end, and `⌘⏎` posts a comment on
// the pull request itself, which `i` edits in its card and `dd` deletes.

import { cassette as recorded, recordedKey } from '@lo/testing';
import { COMMENTS_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  dataFolder,
  DIFF_FIRST,
  DIFF_FIRST_BETWEEN,
  expect,
  settingsPath,
  test as base,
} from './app.ts';
import { type BodiesServer, serveBodies } from './bodies.ts';
import { Staged } from './staged.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** The cassette of acting on threads in the diff. */
const CASSETTE = 'app_comments_act';

/** The cassette of writing on the pull request itself, in the timeline. */
const BOX = 'app_comments_box';

/**
 * The cassette that recorded the images #94's comments show, which the threads' cards load as they
 * come on screen, though `app_comments_act` scrolled past them before they did.
 */
const IMAGES = 'app_comments';

const cmd = process.platform === 'darwin' ? 'Meta' : 'Control';

/** The writes the recording sent, by their GraphQL operations. */
const WRITES = new Set([
  'AddPullRequestReviewThreadReply',
  'UpdatePullRequestReviewComment',
  'DeletePullRequestReviewComment',
  'UnresolveReviewThread',
  'ResolveReviewThread',
  'AddComment',
  'UpdateIssueComment',
  'DeleteIssueComment',
]);

/**
 * The cassette `name` a stage at a time, a stage ending with each write (`./staged.ts`), with the
 * images it didn't record from the start.
 */
function staged(name: string): Staged {
  const keys = new Set(
    recorded(name).interactions.map(({ interaction }) => recordedKey(interaction.request)),
  );
  const images = recorded(IMAGES)
    .interactions.map(({ interaction }) => interaction)
    .filter(
      (each) =>
        new URL(each.request.url).host !== 'api.github.com' && !keys.has(recordedKey(each.request)),
    );
  return new Staged(name, ({ operation }) => WRITES.has(operation ?? ''), { first: images });
}

const test = base.extend<{
  cassette: string;
  github: ReplayServer;
  front: BodiesServer;
  remote: string;
}>({
  cassette: [CASSETTE, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(staged(cassette));
    await use(server);
    await server.close();
  },
  front: async ({ cassette, github }, use) => {
    const front = await serveBodies(cassette, new URL(github.urls.api).origin);
    await use(front);
    await front.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeCommentsRemote(test.info().outputPath('remote')));
  },
  launch: async ({ front, remote }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      env: { LO_GITHUB: front.origin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT_REMOTE: remote },
    });
  },
});

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens #94's tab. */
async function open(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    COMMENTS_PULL.number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
}

/** How many threads the diff on screen places under `line` of src/backoff.ts's newer side. */
function threadsUnder(page: Page, line: number): Promise<number> {
  return page.evaluate((at) => {
    const diff = window.loDiff;
    const id = diff?.files.find((each) => each.path === 'src/backoff.ts')?.id;
    return (diff?.threads() ?? []).filter(
      (thread) => 'line' in thread.at && thread.at.file === id && thread.at.line === at,
    ).length;
  }, line);
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

/** The settings file as an object, or nothing while there's no file. */
function saved(): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath(dataFolder()), 'utf8'));
  } catch {
    return undefined;
  }
}

/** The comment boxes in the diff. */
const boxes = (page: Page) => page.locator('[data-lo-diff] .lo-diffcomposer');

/** The card of the thread whose text says `text`. */
const card = (page: Page, text: string) =>
  page.locator('[data-lo-diff] [data-thread-state]').filter({ hasText: text });

for (const mode of ['beside', 'between'] as const) {
  test.describe(`${mode} lines`, () => {
    if (mode === 'between') test.use({ settings: DIFF_FIRST_BETWEEN });

    test('`r` replies, `i` edits the reply, `dd` deletes it, and `x` unresolves and resolves a thread', async ({
      page,
    }) => {
      await actOnThreads(page, mode);
    });
  });
}

/** The thread test, with threads `mode` lines. */
async function actOnThreads(page: Page, mode: 'beside' | 'between'): Promise<void> {
  test.setTimeout(120_000);
  const beside = mode === 'beside';
  await open(page);
  await expect.poll(() => threadsUnder(page, 2), { timeout: 30_000 }).toBe(1);
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
  for (const key of ['j', 'j']) await page.keyboard.press(key);
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
  // The threads that came while their lines were on screen come in as the layout changes: inline,
  // then side by side again, each saved before the next.
  for (const layout of ['inline', 'split']) {
    for (const key of ['g', 'i']) await page.keyboard.press(key);
    await expect.poll(saved).toMatchObject({ 'diff.layout': layout });
  }
  const thread = card(page, 'Start a little higher?');
  if (beside) {
    // Its card is in the popover its mark opens, which is closed: made as the cursor came to its
    // line, and hidden.
    await expect(
      page.getByRole('button', { name: 'Unresolved thread · line 2', exact: true }),
    ).toBeVisible();
    await expect(thread).toBeHidden();
  } else {
    await expect(thread).toBeVisible();
  }
  const box = boxes(page);

  const where = beside ? 'the popover with a reply box in the card' : 'a reply box after the card';
  await test.step(`\`r\` opens ${where}, and \`⌥⏎\` posts the reply`, async () => {
    await page.keyboard.press('r');
    await expect(thread).toBeVisible();
    await expect(box).toHaveCount(1);
    await expect(box.locator('.lo-diffcomposer__head')).toContainText('Reply');
    await expect(box.getByRole('button', { name: /Send now/ })).toBeVisible();
    // The card's own row that offers a reply gives way to the box.
    await expect(thread.getByRole('button', { name: 'Reply…' })).toHaveCount(0);
    await page.keyboard.type('Three tries at most.');
    await page.keyboard.press('Alt+Enter');
    await expect(box).toHaveCount(0, { timeout: 20_000 });
    await page.keyboard.press('Shift');
    await expect(thread).toContainText('Three tries at most.', { timeout: 20_000 });
  });

  await test.step('`i` opens the reply’s text in a box, and `⌘⏎` saves the edit', async () => {
    await page.keyboard.press('i');
    await expect(box).toHaveCount(1);
    await expect(box.locator('.lo-diffcomposer__head')).toContainText('Edit');
    // In the comment's place in its card, so its text shows once.
    await expect(thread.locator('[data-edit-slot] .lo-diffcomposer')).toHaveCount(1);
    await expect(box.locator('.cm-content')).toHaveText('Three tries at most.');
    await expect(box.getByRole('button', { name: /^Save/ })).toBeVisible();
    await page.keyboard.type(' Then it gives up.');
    await page.keyboard.press(`${cmd}+Enter`);
    await expect(box).toHaveCount(0, { timeout: 20_000 });
    await page.keyboard.press('Shift');
    await expect(thread).toContainText('Three tries at most. Then it gives up.', {
      timeout: 20_000,
    });
  });

  await test.step('`dd` asks first, and `⏎` deletes the reply', async () => {
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    const dialog = page.getByTestId('delete-comment');
    await expect(dialog).toContainText('Delete comment?');
    await expect(dialog).toContainText('Three tries at most. Then it gives up.');
    await expect(dialog.getByRole('button', { name: /Cancel/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(thread).not.toContainText('Three tries at most.', { timeout: 20_000 });
  });

  await test.step('`x` on a resolved thread unresolves it, and `x` again resolves it', async () => {
    for (const key of ['j', 'j', 'j']) await page.keyboard.press(key);
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 5');
    const fifth = card(page, 'Is doubling enough?');
    if (beside) {
      // The cursor left line 2's lines: its popover closed.
      await expect(thread).toBeHidden();
      await expect(fifth).toBeHidden();
      // A key never changes a thread that isn't on screen: the first `x` pins its popover.
      await page.keyboard.press('x');
    }
    await expect(fifth).toHaveAttribute('data-thread-state', 'resolved');
    await page.keyboard.press('x');
    await expect(fifth).toHaveAttribute('data-thread-state', 'unresolved', { timeout: 20_000 });
    // The card shows what was asked at once, its button at rest once GitHub answers, named for
    // what it does next: `x` again is for after that. Between lines it opens, as it's unresolved.
    const working = fifth.locator('button[aria-busy="true"]');
    if (!beside) {
      await expect(fifth.getByRole('button', { name: 'Collapse thread' })).toBeVisible({
        timeout: 20_000,
      });
    }
    await expect(working).toHaveCount(0, { timeout: 20_000 });
    await expect(fifth.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
    await page.keyboard.press('x');
    await expect(fifth).toHaveAttribute('data-thread-state', 'resolved', { timeout: 20_000 });
    await expect(working).toHaveCount(0, { timeout: 20_000 });
  });
}

test.describe('in the timeline', () => {
  test.use({ cassette: BOX });

  test('`c` and `⌘⏎` post a comment from the box at its end, and `i` and `dd` edit and delete it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.activeElement
                ?.closest('[data-lo-middle-view]')
                ?.getAttribute('data-lo-middle-view') ?? null,
          ),
        { timeout: 20_000 },
      )
      .toBe('diff.view');
    await page.keyboard.press('`');
    const timeline = page.getByRole('listbox', { name: 'Timeline' });
    await expect(timeline).toBeFocused({ timeout: 20_000 });
    const box = page.locator('[data-lo-timeline="box"]');
    const editor = box.locator('.cm-content');
    const comment = timeline
      .locator('li[data-key]')
      .filter({ hasText: 'Posted from the timeline’s box.' });
    /** The row the keyboard is on, by its key. */
    const on = () =>
      timeline.evaluate((list) => {
        const id = list.getAttribute('aria-activedescendant');
        return id === null ? null : document.getElementById(id)?.getAttribute('data-key');
      });

    await test.step('`c` puts focus in the box at the end, and `⌘⏎` posts the comment', async () => {
      await expect(box).toContainText('Pull request');
      await expect(box.getByRole('button', { name: /^Send/ })).toBeVisible();
      await page.keyboard.press('c');
      await expect(editor).toBeFocused();
      await page.keyboard.type('Posted from the timeline’s box.');
      await page.keyboard.press(`${cmd}+Enter`);
      await expect(comment).toContainText('rozed-bot (you) commented', { timeout: 20_000 });
      // Empty again, it says what it's for.
      await expect(editor).toHaveText('Comment on #94');
      // Focus goes back to the list as the sent box goes.
      await expect(timeline).toBeFocused();
    });

    await test.step('`i` opens the comment’s text in a box in its card, and `⌘⏎` saves the edit', async () => {
      await comment.click();
      await page.keyboard.press('i');
      const edit = comment.locator('[data-lo-timeline="edit"]');
      await expect(edit).toContainText('Edit');
      await expect(edit.locator('.cm-content')).toHaveText('Posted from the timeline’s box.');
      await expect(edit.locator('.cm-content')).toBeFocused();
      await page.keyboard.type(' Then edited.');
      await page.keyboard.press(`${cmd}+Enter`);
      await expect(edit).toHaveCount(0, { timeout: 20_000 });
      await expect(comment).toContainText('Posted from the timeline’s box. Then edited.', {
        timeout: 20_000,
      });
    });

    await test.step('`dd` asks first, and `⏎` deletes the comment, the keyboard going to the row before it', async () => {
      // The comment is the newest event: the row before it is its neighbour once it goes.
      const before = await comment.evaluate(
        (row) => row.previousElementSibling?.getAttribute('data-key') ?? null,
      );
      expect(before).not.toBeNull();
      await page.keyboard.press('d');
      await page.keyboard.press('d');
      const dialog = page.getByTestId('delete-comment');
      await expect(dialog).toContainText('Delete comment?');
      await expect(dialog).toContainText('Posted from the timeline’s box. Then edited.');
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(comment).toHaveCount(0, { timeout: 20_000 });
      // Not back at the description, at the top.
      await expect.poll(on).toBe(before);
    });
  });
});

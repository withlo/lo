// Acting on review threads in the diff: Lo, started on the replay server as rozed-bot, on the
// comments fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94, as `app_comments_act`
// recorded from the app. On line 2's thread, `r` opens a reply box right after its card, and `⌥⏎`
// posts the reply; `i` opens a box with the reply's text, and `⌘⏎` saves the edit over it; `dd`
// asks first, and `⏎` deletes it. On line 5's resolved thread, `x` unresolves it, and `x` again
// resolves it. Each change comes into the card as GitHub reads it back. In the timeline, as
// `app_comments_box` recorded, `c` puts focus in the box at its end, and `⌘⏎` posts a comment on
// the pull request itself, which `i` edits in its card and `dd` deletes.

import {
  cassette as recorded,
  type Interaction,
  recordedKey,
  Replay,
  type SeenRequest,
} from '@lo/testing';
import { COMMENTS_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

import { DIFF_FIRST, expect, test as base } from './app.ts';
import { type BodiesServer, serveBodies } from './bodies.ts';

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

/** The GraphQL operation a request names, if it names one. */
function operationOf(request: SeenRequest): string | undefined {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/graphql') return undefined;
  const body: unknown = JSON.parse(new TextDecoder().decode(request.body));
  const name =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'operationName') : undefined;
  return typeof name === 'string' ? name : undefined;
}

/**
 * The cassette a stage at a time, a stage ending with each write: until Lo sends the next write,
 * each request gets the answers recorded before it, the last repeating, and once it's sent, those
 * recorded after. However many polls come between, a read never gets an answer from past a write
 * Lo hasn't sent yet, nor one from before a write it has.
 */
class Staged extends Replay {
  readonly #stages: Replay[];
  #at = 0;

  constructor(name: string) {
    const interactions = recorded(name).interactions.map(({ interaction }) => interaction);
    super(name, interactions);
    // The images it didn't record, from the start.
    const keys = new Set(interactions.map((each) => recordedKey(each.request)));
    const images = recorded(IMAGES)
      .interactions.map(({ interaction }) => interaction)
      .filter(
        (each) =>
          new URL(each.request.url).host !== 'api.github.com' &&
          !keys.has(recordedKey(each.request)),
      );
    const stages: Interaction[][] = [[...images]];
    for (const each of interactions) {
      stages.at(-1)!.push(each);
      if (WRITES.has(each.request.operation ?? '')) stages.push([]);
    }
    // A request a stage has no answer for gets the last one recorded before it.
    const last = new Map<string, Interaction>();
    this.#stages = stages.map((stage, index) => {
      const own = new Set(stage.map((each) => recordedKey(each.request)));
      const carried = [...last].filter(([key]) => !own.has(key)).map(([, each]) => each);
      for (const each of stage) last.set(recordedKey(each.request), each);
      return new Replay(`${name}, stage ${index}`, [...carried, ...stage]);
    });
  }

  override answer(request: SeenRequest): Response {
    this.seen.push(request);
    const response = this.#stages[this.#at]!.answer(request);
    if (WRITES.has(operationOf(request) ?? '')) {
      this.#at = Math.min(this.#at + 1, this.#stages.length - 1);
    }
    return response;
  }
}

const test = base.extend<{
  cassette: string;
  github: ReplayServer;
  front: BodiesServer;
  remote: string;
}>({
  cassette: [CASSETTE, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(new Staged(cassette));
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

/** The comment boxes in the diff. */
const boxes = (page: Page) => page.locator('[data-lo-diff] .lo-diffcomposer');

/** The card of the thread whose text says `text`. */
const card = (page: Page, text: string) =>
  page.locator('[data-lo-diff] [data-thread-state]').filter({ hasText: text });

test('`r` replies, `i` edits the reply, `dd` deletes it, and `x` unresolves and resolves a thread', async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  // The threads that came while their lines were on screen come in as the layout changes.
  for (const key of ['g', 'i', 'g', 'i']) await page.keyboard.press(key);
  const thread = card(page, 'Start a little higher?');
  await expect(thread).toBeVisible();
  const box = boxes(page);

  await test.step('`r` opens a reply box after the card, and `⌥⏎` posts the reply', async () => {
    await page.keyboard.press('r');
    await expect(box).toHaveCount(1);
    await expect(box).toContainText('Reply to rozed-bot’s thread');
    await expect(box.getByRole('button', { name: /Reply now/ })).toBeVisible();
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
    await expect(box).toContainText('Edit your comment');
    await expect(box.locator('.cm-content')).toHaveText('Three tries at most.');
    await expect(box.getByRole('button', { name: /Save the edit/ })).toBeVisible();
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
    await expect(dialog).toContainText('Delete your comment?');
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
    await expect(fifth).toHaveAttribute('data-thread-state', 'resolved');
    await page.keyboard.press('x');
    await expect(fifth).toHaveAttribute('data-thread-state', 'unresolved', { timeout: 20_000 });
    await page.keyboard.press('x');
    await expect(fifth).toHaveAttribute('data-thread-state', 'resolved', { timeout: 20_000 });
  });
});

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

    await test.step('`c` puts focus in the box at the end, and `⌘⏎` posts the comment', async () => {
      await expect(box).toContainText('On the pull request');
      await expect(box).toContainText('as rozed-bot');
      await page.keyboard.press('c');
      await expect(editor).toBeFocused();
      await page.keyboard.type('Posted from the timeline’s box.');
      await page.keyboard.press(`${cmd}+Enter`);
      await expect(comment).toContainText('rozed-bot (you) commented', { timeout: 20_000 });
      await expect(editor).toHaveText('');
      // Focus goes back to the list as the sent box goes.
      await expect(timeline).toBeFocused();
    });

    await test.step('`i` opens the comment’s text in a box in its card, and `⌘⏎` saves the edit', async () => {
      await comment.click();
      await page.keyboard.press('i');
      const edit = comment.locator('[data-lo-timeline="edit"]');
      await expect(edit).toContainText('Edit your comment');
      await expect(edit.locator('.cm-content')).toHaveText('Posted from the timeline’s box.');
      await expect(edit.locator('.cm-content')).toBeFocused();
      await page.keyboard.type(' Then edited.');
      await page.keyboard.press(`${cmd}+Enter`);
      await expect(edit).toHaveCount(0, { timeout: 20_000 });
      await expect(comment).toContainText('Posted from the timeline’s box. Then edited.', {
        timeout: 20_000,
      });
    });

    await test.step('`dd` asks first, and `⏎` deletes the comment', async () => {
      await page.keyboard.press('d');
      await page.keyboard.press('d');
      const dialog = page.getByTestId('delete-comment');
      await expect(dialog).toContainText('Delete your comment?');
      await expect(dialog).toContainText('Posted from the timeline’s box. Then edited.');
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(comment).toHaveCount(0, { timeout: 20_000 });
    });
  });
});

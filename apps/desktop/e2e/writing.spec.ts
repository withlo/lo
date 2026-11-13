// Writing comments in the diff: Lo, started on the replay server as rozed-bot, on the comments
// fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94. `c` on a line opens a box under it,
// whose frame says where the comment goes and who it's from, and `⌘⏎` adds it to a pending review
// it starts, as `app_comments_write` recorded from the app; the thread comes under the line. A box
// closed with `Esc Esc` keeps its draft on this computer, and after a restart it's back, unfocused,
// saying so, until it's discarded from its frame's right-click menu.

import { writeFileSync } from 'node:fs';

import { cassette as recorded, Replay, ReplayError, type SeenRequest } from '@lo/testing';
import { COMMENTS_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  dataFolder,
  DIFF_FIRST,
  expect,
  KEYCHAIN,
  test as base,
} from './app.ts';
import { serveBodies } from './bodies.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const cmd = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * A cassette's answers, as Lo reads them after a restart too: its cache from before has the tags
 * of what it read, so a conditional read the cassette has no answer for is answered as the plain
 * read was.
 */
class Restarting extends Replay {
  override answer(request: SeenRequest): Response {
    if (!request.headers.has('if-none-match')) return super.answer(request);
    try {
      return super.answer(request);
    } catch (error) {
      if (!(error instanceof ReplayError)) throw error;
      this.failures.pop();
      this.seen.pop();
      const headers = new Headers(request.headers);
      headers.delete('if-none-match');
      return super.answer({ ...request, headers });
    }
  }
}

const test = base.extend<{
  cassette: string;
  github: ReplayServer;
  githubOrigin: string;
  remote: string;
}>({
  cassette: ['app_comments', { option: true }],
  github: async ({ cassette }, use) => {
    const answers = recorded(cassette).interactions.map(({ interaction }) => interaction);
    const server = await serveReplay(new Restarting(cassette, answers));
    await use(server);
    await server.close();
  },
  githubOrigin: async ({ cassette, github }, use) => {
    const front = await serveBodies(cassette, new URL(github.urls.api).origin);
    await use(front.origin);
    await front.close();
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

test.describe('with a write recorded', () => {
  test.use({ cassette: 'app_comments_write' });

  test('`c` on a line opens a box under it, and `⌘⏎` adds the comment to a pending review', async ({
    page,
  }) => {
    await open(page);
    await onLineTwo(page);
    await page.keyboard.press('c');
    const box = boxes(page);
    await expect(box).toHaveCount(1);
    await expect(box).toContainText('On line 2, new side');
    await expect(box).toContainText('as rozed-bot');
    await expect(box.getByRole('button', { name: /Add to review/ })).toBeVisible();
    await expect(box.locator('.mode-chip')).toHaveText('INSERT');
    await page.keyboard.type('Does the first wait need a cap?');
    await page.keyboard.press(`${cmd}+Enter`);
    // The box goes, and the thread GitHub made comes under the line, pending.
    await expect(box).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => threadsUnder(page, 'src/backoff.ts', 2), { timeout: 20_000 }).toBe(2);
    const thread = page
      .locator('[data-lo-diff] [role="group"]')
      .filter({ hasText: 'Does the first wait need a cap?' });
    await expect(thread).toContainText('Pending');
  });
});

/** Starts Lo on the test's data folder, and waits for its window. */
async function launch(
  githubOrigin: string,
  remote: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      ...launchEnvironment(githubOrigin, remote),
    },
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { app, page };
}

test('a draft kept with `Esc Esc` is back after a restart, unfocused, until it’s discarded', async ({
  app,
  page,
  githubOrigin,
  remote,
}) => {
  const tab = await open(page);
  await onLineTwo(page);
  await page.keyboard.press('c');
  await expect(boxes(page)).toHaveCount(1);
  await page.keyboard.type('Kept for later.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(boxes(page)).toHaveCount(0);
  // Saved on this computer, as the box closed.
  await expect
    .poll(async () =>
      JSON.stringify(
        await page.evaluate((id) => window.lo.invoke('comments.current', { id }), tab),
      ),
    )
    .toContain('Kept for later.');
  await app.close();

  const again = await launch(githubOrigin, remote);
  try {
    const box = boxes(again.page);
    await expect(box).toHaveCount(1, { timeout: 30_000 });
    await expect(box).toContainText(/Restored your draft from today, .+\./);
    await expect(box.locator('.cm-content')).toHaveText('Kept for later.');
    await expect
      .poll(() =>
        again.page.evaluate(() => document.activeElement?.closest('.lo-diffcomposer') === null),
      )
      .toBe(true);
    // What the note's button does is on the frame's right-click menu too, and only what the box
    // offers.
    await box.locator('.lo-diffcomposer__head').click({ button: 'right' });
    const menu = again.page.getByRole('menu', { name: 'Comment box actions' });
    await expect(menu.getByRole('menuitem', { name: /^Discard the draft/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Send it anyway/ })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: /^Discard the draft/ }).click();
    await expect(box).toHaveCount(0);
  } finally {
    await again.app.close();
  }
});

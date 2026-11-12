// Viewed marks in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#80,
// whose GitHub keeps each file's viewed mark as GitHub does. `e` in the diff marks the file at the
// cursor viewed, closes it and goes on to the next file that isn't viewed, round the end, keeping
// the next file's header where the reader expects it; it's refused in GitHub's pause; clearing a
// mark opens the file again; a write GitHub refuses takes back the mark alone; and a file a push
// changed since it was viewed opens to what changed since.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { cassette, Replay, type SeenRequest } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** Where a header was drawn and how far the diff was scrolled, as a frame started. */
interface HeaderFrame {
  /** How far down the page the header was, if it was drawn. */
  y: number | undefined;
  scroll: number;
  /** How far the diff scrolls. */
  end: number;
  /** Whether the cursor was in the header's file. */
  cursor: boolean;
}

declare global {
  interface Window {
    /** Each frame's {@link HeaderFrame}, while a test watches a header. */
    loHeader?: HeaderFrame[];
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** A viewed mark, as GitHub's API names it. */
type Mark = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

/** How GitHub answers the next viewed-mark write: takes it, asks Lo to slow down, or refuses it. */
type Answer = 'take' | 'slowDown' | 'refuse';

/** `value`'s field `name`, if `value` is an object that has one. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && name in value
    ? Reflect.get(value, name)
    : undefined;
}

/** `value` at the end of `path`, its fields one after another. */
function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce((at, name) => field(at, name), value);
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/**
 * #80's GitHub, from the app's cassette, keeping viewed marks as GitHub does: a write it takes
 * changes the mark the pull request's details give from then on.
 */
class ViewedGithub extends Replay {
  /** Each file's mark, by path, where it isn't the recorded one. */
  readonly marks = new Map<string, Mark>();
  /** The viewed-mark writes GitHub got, in order: the operation and the path. */
  readonly writes: string[] = [];
  /** How the next write is answered: `take` from then on. */
  next: Answer = 'take';
  /** Until when the pull request's details are held back, in milliseconds since the epoch. */
  holdDetailsUntil = 0;

  constructor() {
    super(
      'app_e2e',
      cassette('app_e2e').interactions.map(({ interaction }) => interaction),
    );
  }

  override answer(request: SeenRequest): Response {
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || pathname !== '/graphql') return super.answer(request);
    const body: unknown = JSON.parse(new TextDecoder().decode(request.body));
    const operationName = field(body, 'operationName');
    if (operationName === 'MarkFileAsViewed' || operationName === 'UnmarkFileAsViewed') {
      const path = dig(body, 'variables', 'path');
      return this.#write(operationName, typeof path === 'string' ? path : '');
    }
    const recorded = super.answer(request);
    return operationName === 'PullRequest' ? this.#withMarks(recorded) : recorded;
  }

  #write(operation: 'MarkFileAsViewed' | 'UnmarkFileAsViewed', path: string): Response {
    this.writes.push(`${operation} ${path}`);
    const answer = this.next;
    this.next = 'take';
    switch (answer) {
      case 'take': {
        this.marks.set(path, operation === 'MarkFileAsViewed' ? 'VIEWED' : 'UNVIEWED');
        const name = operation === 'MarkFileAsViewed' ? 'markFileAsViewed' : 'unmarkFileAsViewed';
        return json({ data: { [name]: { pullRequest: { id: 'PR_kwDOVleUfc8AAAABOgnSkg' } } } });
      }
      case 'slowDown':
        return json(
          {
            message:
              'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
          },
          403,
          { 'retry-after': '60', 'x-ratelimit-remaining': '4990' },
        );
      case 'refuse':
        return json({
          data: { markFileAsViewed: null },
          errors: [
            {
              type: 'UNPROCESSABLE',
              path: ['markFileAsViewed'],
              message: 'Filepath must be part of pull request',
            },
          ],
        });
      default:
        answer satisfies never;
        throw new Error(`An answer the test doesn't know: ${String(answer)}`);
    }
  }

  /** The recorded details, with the marks as they are now. */
  #withMarks(recorded: Response): Response {
    const marks = this.marks;
    const until = this.holdDetailsUntil;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, until - Date.now())));
        const read: unknown = JSON.parse(await recorded.text());
        const nodes = dig(read, 'data', 'repository', 'pullRequest', 'files', 'nodes');
        for (const node of Array.isArray(nodes) ? nodes : []) {
          const mark = marks.get(String(field(node, 'path')));
          if (mark !== undefined && typeof node === 'object' && node !== null) {
            Reflect.set(node, 'viewerViewedState', mark);
          }
        }
        controller.enqueue(new TextEncoder().encode(JSON.stringify(read)));
        controller.close();
      },
    });
    const headers = new Headers(recorded.headers);
    headers.delete('content-length');
    return new Response(body, { status: recorded.status, headers });
  }
}

const test = base.extend<{
  fake: ViewedGithub;
  github: ReplayServer;
  remote: string;
  tokenFile: string;
}>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    await use(new ViewedGithub());
  },
  github: async ({ fake }, use) => {
    const server = await serveReplay(fake);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeAppRemote(test.info().outputPath('remote')));
  },
  // oxlint-disable-next-line no-empty-pattern
  tokenFile: async ({}, use) => {
    const file = test.info().outputPath('token');
    writeFileSync(file, `${TOKEN}\n`);
    await use(file);
  },
  launch: async ({ github, remote, tokenFile }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/** Waits for the account from the token file, then opens #80's tab, and returns its id. */
async function openE2e(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    APP_PULL.number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** Opens #80 and waits for its diff from the local copy, and for GitHub's marks in the tree. */
async function shown(page: Page): Promise<{ id: string; path: string }[]> {
  const id = await openE2e(page);
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate(
          (tab) => window.lo.invoke('diff.versions', { id: tab }),
          id,
        );
        return reply.ok ? JSON.stringify(reply.value) : '';
      },
      { timeout: 30_000 },
    )
    .toContain('"from":"local"');
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  await expect(ball(page, 'src/format.ts')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => files(page)).toHaveLength(7);
  return files(page);
}

/** The diff's files, in the order it shows them. */
function files(page: Page): Promise<{ id: string; path: string }[]> {
  return page.evaluate(() => window.loDiff?.files ?? []);
}

/** The path of the file the diff's cursor is in. */
function cursorPath(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const at = window.loDiff?.probe.cursor()?.at;
    const id = at?.kind === 'line' ? at.at.file : at?.file;
    return window.loDiff?.files.find((file) => file.id === id)?.path;
  });
}

/** How far down the page file `id`'s header is drawn, on the new side, if it's drawn. */
function headerTop(page: Page, id: string): Promise<number | undefined> {
  return page.evaluate(
    (file) => window.loDiff?.probe.spotTop({ kind: 'header', file, side: 'new' }),
    id,
  );
}

/** Puts the diff's cursor on `path`'s header, from the first file's, with `]f`. */
async function cursorTo(page: Page, path: string): Promise<void> {
  const order = await files(page);
  const at = order.findIndex((file) => file.path === path);
  if (at < 0) throw new Error(`the diff has no ${path}`);
  await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(() => cursorPath(page)).toBe(order[0]?.path);
  for (let step = 0; step < at; step++) {
    await page.keyboard.press(']');
    await page.keyboard.press('f');
  }
  await expect.poll(() => cursorPath(page)).toBe(path);
}

const tree = (page: Page) => page.locator('[role="tree"][data-lo-scope="tree"]');
/** A changed file's viewed ball in the tree. */
const ball = (page: Page, path: string) =>
  tree(page)
    .locator(`[data-key="${path}"]`)
    .locator('[title="Viewed"], [title="Not viewed"], [title="Changed since you viewed it"]');
/**
 * Whether `path`'s file shows closed, its lines in one block: in the new side's editor, its header
 * is followed by a note that says so.
 */
function closed(page: Page, path: string): Promise<boolean> {
  return page.evaluate((file) => {
    const after = document.querySelector('.lo-diffview .cm-content[aria-label="After"]');
    const header = [...(after?.querySelectorAll('.lo-diffhead') ?? [])].find((each) =>
      each.textContent?.includes(file),
    );
    let next = header?.nextElementSibling;
    // Past the spacers that keep the sides level.
    while (next?.classList.contains('lo-spacer')) next = next.nextElementSibling;
    return Boolean(
      next?.classList.contains('lo-filenote') && next.textContent?.includes('closed: za opens it'),
    );
  }, path);
}

/** A file's viewed ball in its header. */
const headerBall = (page: Page, path: string) =>
  page
    .locator('.lo-diffview .lo-diffhead', { hasText: path })
    .first()
    .locator('.lo-diffhead__ball');

/** How far down the page the diff's scrolling box starts, how tall it is, and its scroll. */
function box(page: Page): Promise<{ top: number; height: number; scroll: number; end: number }> {
  return page.evaluate(() => {
    const view = document.querySelector('.lo-diffview');
    if (!view) throw new Error('no diff');
    return {
      top: view.getBoundingClientRect().top,
      height: view.clientHeight,
      scroll: view.scrollTop,
      end: view.scrollHeight - view.clientHeight,
    };
  });
}

/** Scrolls the diff so `path`'s header is `down` pixels below the top of the screen. */
async function headerAt(page: Page, path: string, down = 0): Promise<void> {
  const order = await files(page);
  const id = order.find((file) => file.path === path)?.id;
  if (id === undefined) throw new Error(`the diff has no ${path}`);
  await page.evaluate(
    ([file, offset]) =>
      window.loDiff?.scrollTo({ at: { kind: 'header', file, side: 'new' }, offset: -offset }),
    [id, down] as const,
  );
  const { top } = await box(page);
  await expect
    .poll(async () => Math.round((await headerTop(page, id)) ?? Number.NaN))
    .toBe(Math.round(top + down));
}

test('`e` marks the file viewed and closes it, and the next file’s header stays where it was', async ({
  page,
  fake,
}) => {
  const order = await shown(page);
  const format = order.find((file) => file.path === 'src/format.ts');
  if (!format) throw new Error('the diff has no src/format.ts');
  await cursorTo(page, 'src/text/wrap.ts');
  // src/format.ts's header a little way down the screen, src/text/wrap.ts's lines above it, and its
  // header, where the cursor is, scrolled away above: `e` acts on the file at the top.
  await headerAt(page, 'src/format.ts', 100);
  const before = (await headerTop(page, format.id)) ?? Number.NaN;

  await page.keyboard.press('e');
  // The mark shows at once, in the tree and the header, and GitHub gets it.
  await expect(ball(page, 'src/text/wrap.ts')).toHaveAttribute('title', 'Viewed');
  await expect(headerBall(page, 'src/text/wrap.ts')).toHaveClass(/is-viewed/);
  await expect.poll(() => closed(page, 'src/text/wrap.ts')).toBe(true);
  await expect.poll(() => fake.writes).toEqual(['MarkFileAsViewed src/text/wrap.ts']);
  // The cursor is on src/format.ts's header, which hasn't moved: what was above it closed up.
  await expect.poll(() => cursorPath(page)).toBe('src/format.ts');
  await expect
    .poll(async () => Math.abs(((await headerTop(page, format.id)) ?? Number.NaN) - before))
    .toBeLessThan(2);
  await page.waitForTimeout(300);
  expect(Math.abs(((await headerTop(page, format.id)) ?? Number.NaN) - before)).toBeLessThan(2);

  // GitHub's details, read again after the write, say so too: the mark stays.
  await page.waitForTimeout(1500);
  await expect(ball(page, 'src/text/wrap.ts')).toHaveAttribute('title', 'Viewed');
});

/**
 * Notes, as each frame starts, where file `id`'s header is drawn, how far the diff is scrolled and
 * whether the cursor is in the file, until the function it returns is called, which returns the
 * frames.
 */
async function watchHeader(page: Page, id: string): Promise<() => Promise<HeaderFrame[]>> {
  await page.evaluate((file) => {
    const frames: HeaderFrame[] = [];
    window.loHeader = frames;
    const tick = () => {
      const view = document.querySelector('.lo-diffview');
      const at = window.loDiff?.probe.cursor()?.at;
      if (view) {
        frames.push({
          y: window.loDiff?.probe.spotTop({ kind: 'header', file, side: 'new' }),
          scroll: view.scrollTop,
          end: view.scrollHeight - view.clientHeight,
          cursor: (at?.kind === 'line' ? at.at.file : at?.file) === file,
        });
      }
      if (window.loHeader === frames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
  return () =>
    page.evaluate(() => {
      const frames = window.loHeader ?? [];
      window.loHeader = undefined;
      return frames;
    });
}

test('`e` goes on to the next file not viewed, its header staying put or coming up, and round the end', async ({
  page,
  fake,
}) => {
  test.setTimeout(90_000);
  const order = await shown(page);
  const at = order.findIndex((file) => file.path === 'src/format.ts');
  const rest = order.slice(at);
  await cursorTo(page, 'src/format.ts');
  await headerAt(page, 'src/format.ts');

  for (const [step, file] of rest.entries()) {
    const following = rest[step + 1] ?? order[0];
    await expect.poll(() => cursorPath(page)).toBe(file.path);
    if (!following) throw new Error('the diff has no files');
    const before = await headerTop(page, following.id);
    const { top, height } = await box(page);
    const onScreen = before !== undefined && before >= top && before < top + height;
    const watched = await watchHeader(page, following.id);
    await page.keyboard.press('e');
    await expect(ball(page, file.path)).toHaveAttribute('title', 'Viewed');
    await expect.poll(() => cursorPath(page)).toBe(following.path);
    await page.waitForTimeout(1000);
    const frames = await watched();
    // The next header is where it was, if it was on screen; else at the top of the screen, or as
    // near as the scroll goes. It's there from the first frame after the key moved the cursor to
    // it, and stays as the file closed above it is measured and the sides are levelled: away for
    // two frames running, it moved on screen, since a frame that starts before the view puts it
    // back isn't painted so.
    const there = ({ y, scroll, end }: HeaderFrame) =>
      y !== undefined &&
      (onScreen
        ? Math.abs(y - (before ?? Number.NaN)) < 2
        : Math.abs(y - top) < 2 || end - scroll < 2);
    const moving = frames.findIndex((frame) => frame.cursor);
    expect(moving, JSON.stringify(frames)).toBeGreaterThanOrEqual(0);
    // On screen, from before the key too.
    const watchedFrames = frames.slice(onScreen ? 0 : moving);
    const moved = watchedFrames.findIndex(
      (frame, index) => !there(frame) && !there(watchedFrames[index + 1] ?? frame),
    );
    expect(moved, JSON.stringify(watchedFrames)).toBe(-1);
  }
  // Round the end, to the first file, which isn't viewed.
  await expect.poll(() => cursorPath(page)).toBe(order[0]?.path);
  await expect
    .poll(() => fake.writes, { timeout: 20_000 })
    .toEqual(rest.map((file) => `MarkFileAsViewed ${file.path}`));
});

/** The key of the tree's row the keyboard is on. */
function treeFocus(page: Page): Promise<string | null> {
  return tree(page).evaluate((element) => {
    const id = element.getAttribute('aria-activedescendant');
    return id === null ? null : (document.getElementById(id)?.getAttribute('data-key') ?? null);
  });
}

test('`e` in the tree marks the file viewed and goes on to the next changed file not viewed', async ({
  page,
  fake,
}) => {
  await shown(page);
  // In the tree's order, folders first: src/text/wrap.ts, then src/format.ts.
  await tree(page).locator('[data-key="src/text/wrap.ts"]').click();
  await expect(tree(page)).toBeFocused();
  await expect.poll(() => treeFocus(page)).toBe('src/text/wrap.ts');

  await page.keyboard.press('e');
  await expect(ball(page, 'src/text/wrap.ts')).toHaveAttribute('title', 'Viewed');
  await expect.poll(() => treeFocus(page)).toBe('src/format.ts');
  await expect.poll(() => fake.writes).toEqual(['MarkFileAsViewed src/text/wrap.ts']);
  // The diff's header shows it too.
  await expect(headerBall(page, 'src/text/wrap.ts')).toHaveClass(/is-viewed/);

  // Again on a viewed file clears its mark, and the keyboard stays.
  await page.keyboard.press('k');
  await expect.poll(() => treeFocus(page)).toBe('src/text/wrap.ts');
  await page.keyboard.press('e');
  await expect(ball(page, 'src/text/wrap.ts')).toHaveAttribute('title', 'Not viewed');
  expect(await treeFocus(page)).toBe('src/text/wrap.ts');
  await expect
    .poll(() => fake.writes)
    .toEqual(['MarkFileAsViewed src/text/wrap.ts', 'UnmarkFileAsViewed src/text/wrap.ts']);
});

test('`e` is refused while GitHub has asked Lo to hold off, and the mark goes back', async ({
  page,
  fake,
}) => {
  test.setTimeout(60_000);
  await shown(page);
  await cursorTo(page, 'src/format.ts');
  fake.next = 'slowDown';

  await page.keyboard.press('e');
  await expect.poll(() => fake.writes).toEqual(['MarkFileAsViewed src/format.ts']);
  // GitHub turned it away: the mark goes back, and Lo says why.
  await expect(ball(page, 'src/format.ts')).toHaveAttribute('title', 'Not viewed');
  await expect(page.getByText('GitHub asked Lo to slow down').first()).toBeVisible();

  // Now nothing is sent until the pause ends, marking or clearing.
  await cursorTo(page, 'src/format.ts');
  await page.keyboard.press('e');
  await expect(page.getByText(/GitHub asked Lo to hold off until/).first()).toBeVisible();
  await expect(ball(page, 'src/format.ts')).toHaveAttribute('title', 'Not viewed');
  await page.waitForTimeout(1000);
  expect(fake.writes).toEqual(['MarkFileAsViewed src/format.ts']);
});

test('a write GitHub refuses takes back the mark alone, not the closing, the cursor or the scroll', async ({
  page,
  fake,
}) => {
  test.setTimeout(60_000);
  const order = await shown(page);
  await cursorTo(page, 'src/format.ts');
  fake.next = 'refuse';

  await page.keyboard.press('e');
  const next = order[order.findIndex((file) => file.path === 'src/format.ts') + 1]?.path;
  await expect.poll(() => cursorPath(page)).toBe(next);
  const viewport = await page.evaluate(() => window.loDiff?.viewport());
  await expect.poll(() => fake.writes).toEqual(['MarkFileAsViewed src/format.ts']);
  await expect(ball(page, 'src/format.ts')).toHaveAttribute('title', 'Not viewed');
  await expect(headerBall(page, 'src/format.ts')).not.toHaveClass(/is-viewed/);
  await expect(page.getByText(/GitHub doesn't list src\/format.ts/).first()).toBeVisible();

  // The file stays closed, and the cursor and what's at the top of the screen stay put.
  await expect.poll(() => closed(page, 'src/format.ts')).toBe(true);
  expect(await cursorPath(page)).toBe(next);
  const after = await page.evaluate(() => window.loDiff?.viewport());
  expect(after?.at).toEqual(viewport?.at);
  expect(Math.abs((after?.offset ?? 0) - (viewport?.offset ?? 0))).toBeLessThan(2);
});

test('clearing a viewed file’s mark opens it again, and the cursor stays', async ({
  page,
  fake,
}) => {
  test.setTimeout(60_000);
  fake.marks.set('src/format.ts', 'VIEWED');
  await shown(page);
  await expect(ball(page, 'src/format.ts')).toHaveAttribute('title', 'Viewed');
  await expect(headerBall(page, 'src/format.ts')).toHaveClass(/is-viewed/);
  await cursorTo(page, 'src/format.ts');
  // A viewed file starts closed, unless GitHub said so once it was on screen: then the reader
  // closes it.
  if (!(await closed(page, 'src/format.ts'))) {
    await page.keyboard.press('z');
    await page.keyboard.press('a');
  }
  await expect.poll(() => closed(page, 'src/format.ts')).toBe(true);

  await page.keyboard.press('e');
  await expect(ball(page, 'src/format.ts')).toHaveAttribute('title', 'Not viewed');
  await expect.poll(() => fake.writes).toEqual(['UnmarkFileAsViewed src/format.ts']);
  await expect.poll(() => closed(page, 'src/format.ts')).toBe(false);
  expect(await cursorPath(page)).toBe('src/format.ts');
});

test('a viewed file a later push changed opens to what changed since it was viewed', async ({
  app,
  fake,
  github,
  remote,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // GitHub says the second push changed src/parser.ts since the reader viewed it at the first.
  fake.marks.set('src/parser.ts', 'DISMISSED');
  const again = await relaunchViewedAtFirstPush(app, github, remote, tokenFile);
  try {
    const page = await again.firstWindow();
    await page.waitForLoadState('load');
    const id = await openE2e(page);
    await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
    await expect(ball(page, 'src/parser.ts')).toHaveAttribute(
      'title',
      'Changed since you viewed it',
      { timeout: 20_000 },
    );
    // Only the second push's change to it: two lines added and one deleted since r1, not the
    // rename the first push made.
    await expect
      .poll(
        async () => {
          const reply = await page.evaluate(
            (tab) => window.lo.invoke('diff.versions', { id: tab }),
            id,
          );
          const list = reply.ok ? field(reply.value, 'files') : undefined;
          return JSON.stringify(
            (Array.isArray(list) ? list : []).find(
              (file) => dig(file, 'path', 'text') === 'src/parser.ts',
            ),
          );
        },
        { timeout: 30_000 },
      )
      .toMatch(/"additions":2,"deletions":1.*"since":\{"label":"r1","why":"viewed"\}/);
    // Its header, brought on screen from the tree.
    await tree(page).locator('[data-key="src/parser.ts"]').click();
    const header = page.locator('.lo-diffview .lo-diffhead', { hasText: 'src/parser.ts' }).first();
    await expect(header).toContainText('since r1');
    await expect(header).toContainText('+2');
    await expect(header.locator('.lo-diffhead__ball')).toHaveClass(/is-stale/);
  } finally {
    await again.close();
  }
});

/**
 * Lo started again on the test's data folder, the first run's database holding that the reader
 * marked src/parser.ts viewed at the first push.
 */
async function relaunchViewedAtFirstPush(
  app: ElectronApplication,
  github: ReplayServer,
  remote: string,
  tokenFile: string,
): Promise<ElectronApplication> {
  await app.close();
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'));
  try {
    database
      .prepare(
        'INSERT INTO revisions_viewed (login, pull, path, head, marked_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('rozed-bot', 'rozed-dev/e2e#80', 'src/parser.ts', APP_PULL.firstHead, Date.now());
  } finally {
    database.close();
  }
  return electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_TEST_TOKEN_FILE: tokenFile,
      LO_GIT_REMOTE: remote,
    },
    chromiumSandbox: true,
  });
}

/** What main has of a tab's diff: which files show from where, and src/parser.ts's versions. */
async function narrowing(page: Page, id: string): Promise<{ since: unknown; parser: unknown }> {
  const reply = await page.evaluate((tab) => window.lo.invoke('diff.versions', { id: tab }), id);
  const state = reply.ok ? reply.value : undefined;
  const list = field(state, 'files');
  return {
    since: field(state, 'since'),
    parser: (Array.isArray(list) ? list : []).find(
      (file) => dig(file, 'path', 'text') === 'src/parser.ts',
    ),
  };
}

test('a file that comes to show what changed since after the diff is drawn moves nothing on screen', async ({
  app,
  fake,
  github,
  remote,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  fake.marks.set('src/parser.ts', 'DISMISSED');
  const again = await relaunchViewedAtFirstPush(app, github, remote, tokenFile);
  try {
    // GitHub's details, with the marks that say src/parser.ts changed since it was viewed, come
    // late: the local copy's diff of the whole pull request is drawn first.
    fake.holdDetailsUntil = Date.now() + 10_000;
    const page = await again.firstWindow();
    await page.waitForLoadState('load');
    const id = await openE2e(page);
    await expect
      .poll(
        async () => {
          const reply = await page.evaluate(
            (tab) => window.lo.invoke('diff.versions', { id: tab }),
            id,
          );
          return reply.ok ? field(reply.value, 'from') : undefined;
        },
        { timeout: 30_000 },
      )
      .toBe('local');
    await expect(page.locator('.lo-diffview')).toBeVisible();
    expect((await narrowing(page, id)).since).toBeNull();

    // src/parser.ts on screen, a little way down, and the file after it.
    const order = await files(page);
    const parser = order.find((file) => file.path === 'src/parser.ts');
    const after = order[order.findIndex((file) => file.path === 'src/parser.ts') + 1];
    if (!parser || !after)
      throw new Error(`no src/parser.ts, or nothing after it: ${JSON.stringify(order)}`);
    // As far down the diff as it goes, which is the end of it here.
    await page.evaluate(
      (file) => window.loDiff?.scrollTo({ at: { kind: 'header', file, side: 'new' }, offset: -60 }),
      parser.id,
    );
    // Once the scroll has been put back and let go.
    await page.waitForTimeout(1000);
    const draws = await page.evaluate(() => window.loDiff?.draws);
    const before = {
      parser: await headerTop(page, parser.id),
      after: await headerTop(page, after.id),
      onScreen: await page.evaluate(() => window.loDiff?.filesOnScreen()),
    };
    expect(before.onScreen).toContain(parser.id);
    expect((await narrowing(page, id)).since).toBeNull();

    // The marks come, and with them src/parser.ts shows from the first push.
    await expect
      .poll(async () => JSON.stringify((await narrowing(page, id)).parser), { timeout: 30_000 })
      .toContain('"since":{"label":"r1","why":"viewed"}');
    await page.waitForTimeout(1000);

    // Nothing on screen moved: src/parser.ts keeps the lines it had while the reader looks at it,
    // so the file after it stays where it was too, and the view wasn't drawn again.
    expect(Math.abs((await headerTop(page, parser.id))! - before.parser!)).toBeLessThan(2);
    expect(Math.abs((await headerTop(page, after.id))! - before.after!)).toBeLessThan(2);
    expect(await page.evaluate(() => window.loDiff?.filesOnScreen())).toEqual(before.onScreen);
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(draws);
    // Its header says it changed since, in place.
    const header = page.locator('.lo-diffview .lo-diffhead', { hasText: 'src/parser.ts' }).first();
    await expect(header).toContainText('since r1');
    await expect(header.locator('.lo-diffhead__ball')).toHaveClass(/is-stale/);
  } finally {
    await again.close();
  }
});

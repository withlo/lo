// The diff in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#78 and
// draws every changed file in one scroll, in the left panel's order, each starting out as it should,
// and answers the diff's keys. Without git, it draws GitHub's diff, hunks only.

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Probe, Viewport } from '@lo/ui/code';
import type { ElectronApplication, Page } from '@playwright/test';

import {
  appFolder,
  browsed,
  dataFolder,
  expect,
  KEYCHAIN,
  settingsPath,
  test as base,
} from './app.ts';

declare global {
  interface Window {
    /** The diff on screen, which a build run from source gives the smoke test. */
    loDiff?:
      | {
          probe: Probe;
          draws: number;
          files: { id: string; path: string }[];
          viewport(): Viewport;
          scrollTo(viewport: Viewport): boolean;
          filesOnScreen(): readonly string[];
        }
      | undefined;
    /** How long each frame took while a test timed them, in milliseconds. */
    loFrames?: number[];
    /** Where the diff was scrolled to at each frame while a test timed them. */
    loTops?: number[];
    /**
     * What moved on the page while a test watched it: the line at the top of the screen, or the one
     * in its middle, on a frame the reader gave no input.
     */
    loMoved?: string[];
    /** Stops watching. */
    loStill?: boolean;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** Whether Lo starts without git, so it has only GitHub's diff. */
  noGit: boolean;
  /** The cassette GitHub answers from. */
  cassette: string;
  /** Whether the remote is written only once the test says, so the local copy comes late. */
  lateRemote: boolean;
  /**
   * How long GitHub takes to list the repository's files, in milliseconds, which the tree waits
   * for: the tree has the changed files that long after the diff.
   */
  slowTree: number;
  /** Where Lo finds GitHub: the replay server, or a slower one in front of it. */
  githubOrigin: string;
}>({
  noGit: [false, { option: true }],
  cassette: ['app_e2e', { option: true }],
  lateRemote: [false, { option: true }],
  slowTree: [0, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  githubOrigin: async ({ github, slowTree }, use) => {
    const origin = new URL(github.urls.api).origin;
    if (slowTree === 0) {
      await use(origin);
      return;
    }
    // Passes each request on to the replay server, holding the repository's files back.
    const front = createServer((incoming, outgoing) => {
      void (async () => {
        const body = await buffer(incoming);
        if (incoming.url?.includes('/git/trees/')) {
          await new Promise((resolve) => setTimeout(resolve, slowTree));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string' && name !== 'host') headers.set(name, value);
        }
        const method = incoming.method ?? 'GET';
        const response = await fetch(`${origin}${incoming.url ?? '/'}`, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
          redirect: 'manual',
        });
        const out: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
            out[name] = value;
          }
        });
        outgoing.writeHead(response.status, out);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      })();
    });
    await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
    const address = front.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    await use(`http://127.0.0.1:${address.port}`);
    front.closeAllConnections();
    await new Promise((resolve) => front.close(resolve));
  },
  remote: async ({ lateRemote }, use) => {
    const folder = test.info().outputPath('remote');
    await use(lateRemote ? `file://${folder}` : writeAppRemote(folder));
  },
  // oxlint-disable-next-line no-empty-pattern
  tokenFile: async ({}, use) => {
    const file = test.info().outputPath('token');
    writeFileSync(file, `${TOKEN}\n`);
    await use(file);
  },
  launch: async ({ githubOrigin, remote, tokenFile, noGit }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: githubOrigin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
        ...(noGit ? { LO_GIT: 'none' } : {}),
      },
    });
  },
});

/** Waits for the account from the token file, then opens #78's tab, and returns its id. */
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

/** Opens #78 and waits for its diff, drawn from `from`. */
async function drawn(
  page: Page,
  from: 'local' | 'github' = 'local',
  { moves = true }: { moves?: boolean } = {},
): Promise<string> {
  const id = await openE2e(page);
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate(
          (tab) => window.lo.invoke('diff.versions', { id: tab }),
          id,
        );
        return reply.ok ? reply.value : reply;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ at: APP_PULL.head, from });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  if (from === 'local') {
    await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
  }
  // The local copy's diff takes GitHub's place a file at a time, which the status bar counts.
  await expect(page.getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, { timeout: 20_000 });
  // Every file's diff is in once the moves are: they're found last.
  if (moves) await expect(page.locator('.lo-movedlabel').first()).toBeVisible({ timeout: 20_000 });
  return id;
}

/** The paths of the files the diff shows, in its order. */
function paths(page: Page): Promise<string[]> {
  return page.evaluate(() => window.loDiff?.files.map((file) => file.path) ?? []);
}

/** Where the cursor is: on a line or a header, by the file's path. */
async function cursor(page: Page) {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (!reading) return undefined;
    const id = reading.at.kind === 'line' ? reading.at.at.file : reading.at.file;
    const path = window.loDiff?.files.find((file) => file.id === id)?.path;
    return {
      path,
      header: reading.at.kind === 'header',
      line: reading.at.kind === 'line' ? reading.at.at.line : 0,
      side: reading.at.kind === 'line' ? reading.at.at.side : reading.at.side,
      pane: reading.pane,
    };
  });
}

/** Presses keys one after another, as typed. */
async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Puts the cursor in the diff, at the first header, on the new side. */
async function focusDiff(page: Page): Promise<void> {
  const added = page.locator('.lo-diffview .cm-editor').nth(1);
  await added.locator('.cm-content').focus();
  await press(page, 'g', 'g');
  await expect.poll(async () => (await cursor(page))?.header).toBe(true);
}

test('draws every changed file in the left panel’s order, each as it starts out, with no styles refused', async ({
  page,
}) => {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  await drawn(page);

  // The tree's order: folders before files, at each level.
  expect(await paths(page)).toEqual([
    'assets/mark.png',
    'data/numbers.txt',
    'src/text/wrap.ts',
    'src/format.ts',
    'src/legacy.ts',
    'src/parser.ts',
    'pnpm-lock.yaml',
  ]);
  const view = page.locator('.lo-diffview');
  // A binary file shows its two sizes; a large one waits for `za`; a lockfile starts closed.
  await expect(view.locator('.lo-diffhead', { hasText: 'assets/mark.png' }).first()).toContainText(
    /binary, \d+ B → \d+ B/,
  );
  await expect(view.getByText(/changed lines: za loads them/).first()).toBeVisible();
  // The code src/format.ts moves to src/text/wrap.ts, highlighted, under the window's content
  // security policy.
  await expect(view.locator('.lo-movedlabel').first()).toContainText(/moved/i);
  await expect(view.locator('[class*="lo-syn-"]').first()).toBeVisible();
  // A rename, with the words it changed.
  await focusDiff(page);
  await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('src/parser.ts');
  await expect(view.getByText('src/parse.ts', { exact: true }).first()).toBeVisible();
  await expect(view.locator('.lo-word-add').first()).toBeVisible();
  // The lockfile, last, starts closed.
  await press(page, 'Shift+G');
  await expect(view.locator('.lo-diffhead', { hasText: 'pnpm-lock.yaml' }).first()).toContainText(
    'lockfile',
  );
  await expect(view.getByText(/closed: za opens it/).first()).toBeVisible();
  expect(refused).toEqual([]);
});

test('answers its keys: files, changes, sides, layout, whitespace and folds', async ({ page }) => {
  await drawn(page);
  await focusDiff(page);

  await press(page, ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('data/numbers.txt');
  await press(page, ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('src/text/wrap.ts');
  await press(page, '[', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('data/numbers.txt');

  // `za` loads the large file kept out.
  await press(page, 'z', 'a');
  await expect(page.locator('.lo-diffview').getByText(/za loads them/)).toHaveCount(0, {
    timeout: 20_000,
  });

  // To src/parser.ts's change, then across to the old side and back.
  await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'c');
  await expect
    .poll(() => cursor(page))
    .toMatchObject({
      path: 'src/parser.ts',
      header: false,
      pane: 'new',
    });
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('new');

  // `zR` opens the file's unchanged lines: src/parser.ts is the sixth file.
  const collapsed = page.locator('.lo-diffview [data-row^="c:5:"]');
  await expect(collapsed.first()).toBeVisible();
  await press(page, 'z', 'Shift+R');
  await expect(collapsed).toHaveCount(0);

  // `gi` lays it out inline, for every tab, and back.
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.loDiff?.probe.layout)).toBe('inline');
  await expect.poll(() => readSettings()).toMatchObject({ 'diff.layout': 'inline' });
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.loDiff?.probe.layout)).toBe('split');

  // `gw` hides changes to whitespace alone.
  await press(page, 'g', 'w');
  await expect(page.getByText('Whitespace hidden', { exact: true })).toBeVisible();
  await expect.poll(() => readSettings()).toMatchObject({ 'diff.whitespace': 'hide' });
  await press(page, 'g', 'w');
  await expect(page.getByText('Whitespace hidden', { exact: true })).toHaveCount(0);

  // `gx` opens the line in the pull request's changes on GitHub.
  await press(page, 'g', 'x');
  await expect
    .poll(() => browsed())
    .toEqual([
      expect.stringMatching(
        /^https:\/\/github\.com\/rozed-dev\/e2e\/pull\/78\/files#diff-[0-9a-f]{64}R\d+$/,
      ),
    ]);
});

test('copies the lines, the line’s link and the file’s path', async ({ app, page }) => {
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(process.platform === 'darwin', "The Mac's clipboard is its user's.");
  await drawn(page);
  await focusDiff(page);
  await press(page, ']', 'f', ']', 'f', ']', 'c');
  const clipboard = () => app.evaluate(({ clipboard: board }) => board.readText());

  await press(page, 'y', 'p');
  await expect.poll(clipboard).toBe('src/text/wrap.ts');
  await press(page, 'y', 'l');
  await expect
    .poll(clipboard)
    .toMatch(/^https:\/\/github\.com\/rozed-dev\/e2e\/pull\/78\/files#diff-[0-9a-f]{64}R1$/);
  await press(page, 'y', 'y');
  await expect
    .poll(clipboard)
    .toBe('/** `text` broken into lines of at most `width` characters, at spaces. */');
});

test('the tree follows the file on screen, and shows the file it’s asked for', async ({ page }) => {
  await drawn(page);
  const tree = page.locator('[role="tree"][data-lo-scope="tree"]');
  // A file in the tree, clicked, has its header brought on screen in the diff.
  await tree.locator('[data-key="pnpm-lock.yaml"]').click();
  await expect
    .poll(() => cursor(page))
    .toMatchObject({
      path: 'pnpm-lock.yaml',
      header: true,
    });
  // The file at the top of the diff is the one the tree marks.
  await page
    .locator('.lo-diffview .cm-editor')
    .nth(1)
    .locator('.lo-diffhead', { hasText: 'src/legacy.ts' })
    .evaluate((header) => header.scrollIntoView({ block: 'start' }));
  await expect(tree.locator('[data-key="src/legacy.ts"]')).toHaveClass(/tree-current/);
  await focusDiff(page);
  await expect(tree.locator('[data-key="assets/mark.png"]')).toHaveClass(/tree-current/);
});

/** What the settings file holds now. */
function readSettings(): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath(dataFolder()), 'utf8'));
  } catch {
    return undefined;
  }
}

test.describe('without git', () => {
  test.use({ noGit: true });

  test('draws GitHub’s diff, hunks only, with the lines between them not loaded', async ({
    page,
  }) => {
    await drawn(page, 'github');
    await expect(page.getByText('GitHub’s diff', { exact: true })).toBeVisible();
    // The unchanged lines before src/parser.ts's hunk aren't GitHub's to show.
    await focusDiff(page);
    await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'f');
    await expect.poll(async () => (await cursor(page))?.path).toBe('src/parser.ts');
    await expect(
      page.locator('.lo-diffview .lo-collapsed', { hasText: 'not loaded yet' }).first(),
    ).toBeVisible();
    expect(await paths(page)).toContain('src/parser.ts');
  });
});

test.describe('when the tree has the changed files after the diff does', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true, slowTree: 1500 });

  test('draws one view, in the panel’s order, from the tab’s opening to the local copy’s', async ({
    app,
    page,
  }) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 440));
    // Where the diff is scrolled to at each frame, from before the tab opens.
    await page.evaluate(() => {
      const tops: number[] = [];
      window.loTops = tops;
      const tick = () => {
        const view = document.querySelector('.lo-diffview');
        if (view) tops.push(view.scrollTop);
        if (window.loTops === tops) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const id = await drawn(page, 'github', { moves: false });
    const tree = page.locator('[role="tree"][data-lo-scope="tree"]');
    await expect(tree.locator('[data-key="src/parser.ts"]')).toHaveCount(0);
    // The reader scrolls down before the tree has the files.
    const box = await page.locator('.lo-diffview').boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + 200);
    await page.mouse.wheel(0, 360);
    await expect
      .poll(() => page.locator('.lo-diffview').evaluate((view) => view.scrollTop))
      .toBeGreaterThan(0);
    const scrolledAt = await page.evaluate(() => window.loTops?.length ?? 0);
    // The tree's order comes, then the local copy's files.
    await expect(tree.locator('[data-key="src/parser.ts"]')).toBeVisible({ timeout: 10_000 });
    writeAppRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect(page.locator('footer').getByText('GitHub’s diff', { exact: true })).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    await expect(page.locator('footer').getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, {
      timeout: 20_000,
    });
    const tops = await page.evaluate(() => {
      const seen = window.loTops ?? [];
      window.loTops = undefined;
      return seen;
    });

    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    // Once the reader had scrolled, no frame went back to the top.
    expect(Math.min(...tops.slice(scrolledAt))).toBeGreaterThan(0);
    // In the panel's order all along: folders before files, at each level.
    expect(await paths(page)).toEqual([
      'assets/mark.png',
      'data/numbers.txt',
      'src/text/wrap.ts',
      'src/format.ts',
      'src/legacy.ts',
      'src/parser.ts',
      'pnpm-lock.yaml',
    ]);
  });
});

/**
 * Watches, every frame until the test stops it, where the line at the top of the screen and the
 * one in its middle are on the page, and says each time either has moved on a frame without
 * the reader's input. Each is sampled as a frame starts, and counts as moved once it's been away
 * from its place for two frames running, so a change made up for before it's painted doesn't.
 */
async function watchStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.lo-diffview');
    const diff = window.loDiff;
    if (!view || !diff) throw new Error('no diff to watch');
    const box = view.getBoundingClientRect();
    const middle = (() => {
      for (let dy = 0; dy < box.height / 2; dy += 4) {
        const spot = diff.probe.spotAt(box.top + box.height / 2 + dy);
        if (spot) return spot;
      }
      return undefined;
    })();
    const watched = [
      { name: 'top', spot: diff.viewport().at },
      { name: 'middle', spot: middle },
    ].flatMap(({ name, spot }) => {
      const y = spot ? diff.probe.spotTop(spot) : undefined;
      return spot && y !== undefined ? [{ name, spot, y, away: 0 }] : [];
    });
    if (watched.length < 2) throw new Error('no line to watch in the middle of the screen');
    const moved: string[] = [];
    window.loMoved = moved;
    window.loStill = false;
    let input = false;
    for (const type of ['wheel', 'keydown', 'pointerdown']) {
      window.addEventListener(type, () => (input = true), { capture: true });
    }
    const tick = () => {
      for (const each of watched) {
        const y = window.loDiff?.probe.spotTop(each.spot);
        if (input) {
          // The reader moved it: where it is now is its place.
          if (y !== undefined) each.y = y;
          each.away = 0;
          continue;
        }
        const off = y === undefined || Math.abs(y - each.y) > 0.5;
        each.away = off ? each.away + 1 : 0;
        if (each.away === 2) {
          moved.push(`${each.name} ${JSON.stringify(each.spot)} from ${each.y} to ${y}`);
        }
      }
      input = false;
      if (!window.loStill) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test.describe('while the local copy takes GitHub’s place', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  for (const order of ['tree', 'review'] as const) {
    for (const depth of [0.25, 0.5, 0.75]) {
      test(`nothing on screen moves, in ${order} order, ${depth * 100}% of the way down`, async ({
        app,
        page,
      }) => {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.setSize(1100, 440),
        );
        const id = await drawn(page, 'github', { moves: false });
        const view = page.locator('.lo-diffview');
        if (order === 'review') {
          const tree = page.locator('[role="tree"][data-lo-scope="tree"]');
          await tree.focus();
          await page.keyboard.press('t');
          await expect(tree).toHaveAttribute('aria-label', 'Changed files in review order');
          await page.waitForTimeout(300);
        }
        // Wheeled down, with the banner that says the copy couldn't be fetched over the diff.
        const box = await view.boundingBox();
        await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + 200);
        const goal = await view.evaluate(
          (each, part) => Math.round((each.scrollHeight - each.clientHeight) * part),
          depth,
        );
        await expect
          .poll(
            async () => {
              const at = await view.evaluate((each) => each.scrollTop);
              if (at < goal) await page.mouse.wheel(0, Math.min(120, goal - at));
              return at >= goal - 1;
            },
            { timeout: 10_000 },
          )
          .toBe(true);
        await page.waitForTimeout(500);
        await watchStill(page);

        // The banner goes, the local copy comes and takes GitHub's place, and its moves and
        // highlighting follow.
        writeAppRemote(test.info().outputPath('remote'));
        await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
        const status = page.locator('footer');
        await expect(status.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
          timeout: 30_000,
        });
        await expect(status.getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, {
          timeout: 20_000,
        });
        await expect(page.locator('[data-lo-banners]')).toHaveCount(0);
        await page.waitForTimeout(1500);
        const moved = await page.evaluate(() => {
          window.loStill = true;
          return window.loMoved ?? [];
        });

        expect(moved).toEqual([]);
      });
    }
  }
});

test.describe('when the local copy comes after GitHub’s diff', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  test('takes its place in place: what’s at the top of the screen holds, and no frame runs long', async ({
    app,
    page,
  }) => {
    // A short window, so the pull request's few files scroll.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 440));
    // Without src/format.ts's patch, there's no move to find.
    const id = await drawn(page, 'github', { moves: false });
    // GitHub's list has no patch of src/format.ts, so GitHub's diff keeps it out.
    const formatNote = page.locator('.lo-diffview').getByText('20 changed lines: za loads them');
    await expect(formatNote.first()).toBeAttached();
    await page.evaluate(() => Object.assign(window.loDiff ?? {}, { first: true }));
    // Wheeled down until src/format.ts is above the screen.
    const box = await page.locator('.lo-diffview').boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + 200);
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 120);
          return page.evaluate(() => {
            const files = window.loDiff?.files ?? [];
            const at = window.loDiff?.viewport().at;
            const file = at?.kind === 'header' ? at.file : at?.at.file;
            return files.findIndex((each) => each.id === file);
          });
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(3);
    await page.waitForTimeout(300);
    // A row of src/parser.ts at the top of the screen, and where it is on the page.
    const row = await page.evaluate(() => {
      const view = document.querySelector('.lo-diffview');
      const top = view?.getBoundingClientRect().top ?? 0;
      const rows = [
        ...(view?.querySelectorAll<HTMLElement>('.cm-editor:last-of-type [data-row^="p:5:"]') ??
          []),
      ];
      return rows.find((each) => each.getBoundingClientRect().top >= top)?.dataset.row;
    });
    expect(row).toBeDefined();
    const where = () =>
      page.evaluate(
        (key) =>
          document
            .querySelector(`.lo-diffview .cm-editor:last-of-type [data-row="${key}"]`)
            ?.getBoundingClientRect().top,
        row,
      );
    const before = await where();

    // The local copy comes, and swaps GitHub's diff out a file at a time, frames timed meanwhile.
    await page.evaluate(() => {
      const frames: number[] = [];
      window.loFrames = frames;
      window.loTops = [];
      let last = performance.now();
      const tick = (now: number) => {
        frames.push(now - last);
        window.loTops?.push(document.querySelector('.lo-diffview')?.scrollTop ?? 0);
        last = now;
        if (window.loFrames === frames) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    writeAppRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    // Looked for in the status bar alone, so looking costs the page's frames little.
    const status = page.locator('footer');
    await expect(status.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(status.getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, { timeout: 20_000 });
    // src/format.ts, off screen, came in; src/parser.ts, on screen, keeps GitHub's lines.
    await expect(formatNote).toHaveCount(0);
    await expect(
      page.locator('.lo-diffview .lo-collapsed', { hasText: 'not loaded yet' }).first(),
    ).toBeAttached();
    await page.waitForTimeout(500);
    const { frames, tops } = await page.evaluate(() => {
      const timed = { frames: window.loFrames ?? [], tops: window.loTops ?? [] };
      window.loFrames = undefined;
      window.loTops = undefined;
      return timed;
    });

    // The same view, and the row that was at the top of the screen where it was on the page,
    // through the banners going and the files changing above it.
    expect(await page.evaluate(() => 'first' in (window.loDiff ?? {}))).toBe(true);
    const after = (await where()) ?? Number.NaN;
    expect(Math.abs(after - (before ?? Number.NaN))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.slice(1))).toBeLessThan(50);
    // One view from the tab's opening on: the panel's order came with the first, and the local
    // copy's files went into it. No frame went back to the top.
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    expect(tops.length).toBeGreaterThan(0);
    expect(Math.min(...tops)).toBeGreaterThan(0);
  });
});

test.describe('when the local copy comes after GitHub’s diff, on a file the reader is looking at', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  test('leaves the file as it was until it’s scrolled away', async ({ app, page }) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 440));
    const id = await drawn(page, 'github', { moves: false });
    // src/format.ts's note, on the side that follows the screen.
    const keptOut = page
      .locator('.lo-diffview .cm-editor:last-of-type')
      .getByText('20 changed lines: za loads them');
    await expect(keptOut).toHaveCount(1);
    // Wheeled down until src/format.ts, which GitHub's diff keeps out, is on screen.
    const box = await page.locator('.lo-diffview').boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + 100);
    const format = await page.evaluate(
      () => window.loDiff?.files.find((file) => file.path === 'src/format.ts')?.id,
    );
    const onScreen = () =>
      page.evaluate((file) => window.loDiff?.filesOnScreen().includes(file ?? '') ?? false, format);
    await expect
      .poll(
        async () => {
          if (await onScreen()) return true;
          await page.mouse.wheel(0, 60);
          return false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    writeAppRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(500);
    // Still kept out, under the reader.
    expect(await onScreen()).toBe(true);
    await expect(keptOut).toHaveCount(1);

    // Scrolled away, it comes in.
    await expect
      .poll(
        async () => {
          if (!(await onScreen())) return true;
          await page.mouse.wheel(0, -200);
          return false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(keptOut).toHaveCount(0);
  });
});

/**
 * Opens #78 in a short window, GitHub's diff with the banner over it, wheels down, and returns
 * where the first row below the box's top is on the page now, and how to read it again.
 */
async function scrolled(app: ElectronApplication, page: Page) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 440));
  await drawn(page, 'github', { moves: false });
  const view = page.locator('.lo-diffview');
  const box = await view.boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + 200);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => view.evaluate((each) => each.scrollTop)).toBeGreaterThan(100);
  await page.waitForTimeout(300);
  const row = await view.evaluate((each) => {
    const top = each.getBoundingClientRect().top;
    return [...each.querySelectorAll<HTMLElement>('.cm-editor:last-of-type [data-row]')].find(
      (one) => one.getBoundingClientRect().top >= top,
    )?.dataset.row;
  });
  const at = async () =>
    (await view.evaluate(
      (each, key) =>
        each.querySelector(`.cm-editor:last-of-type [data-row="${key}"]`)?.getBoundingClientRect()
          .top,
      row,
    )) ?? Number.NaN;
  return { at, before: await at() };
}

test.describe('when a banner over the diff goes', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  test('leaves the diff where it is on the page, even at its top', async ({ page }) => {
    const id = await drawn(page, 'github', { moves: false });
    const first = page.locator('.lo-diffview .cm-editor:last-of-type [data-row="h:0"]');
    const at = () => first.evaluate((header) => header.getBoundingClientRect().top);
    // The banner says the local copy's fetch failed, over the diff, which is at its top: there's
    // less to scroll up than the banner is tall.
    expect(await page.locator('.lo-diffview').evaluate((view) => view.scrollTop)).toBeLessThan(30);
    const before = await at();

    writeAppRemote(test.info().outputPath('remote'));
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect(page.locator('[data-lo-banners]')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(300);

    expect(Math.abs((await at()) - before)).toBeLessThanOrEqual(1);
  });

  test('leaves a line the view is holding where it is on the page', async ({ app, page }) => {
    const { at, before } = await scrolled(app, page);
    // The view holds what's at the top as it changes, and the banner goes meanwhile.
    await page.evaluate(() => {
      const top = window.loDiff?.viewport();
      if (top) window.loDiff?.scrollTo(top);
      document
        .querySelector<HTMLElement>('[data-lo-banners]')
        ?.style.setProperty('display', 'none');
    });
    await page.waitForTimeout(500);

    expect(Math.abs((await at()) - before)).toBeLessThanOrEqual(1);
  });

  test('takes a scroll in the frame the banner goes as the reader’s, and the move as the box’s', async ({
    app,
    page,
  }) => {
    const { at, before } = await scrolled(app, page);
    // The diff scrolls 2 px, and the banner goes before the scroll is heard of.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.lo-diffview');
      if (scroller) scroller.scrollTop += 2;
      document
        .querySelector<HTMLElement>('[data-lo-banners]')
        ?.style.setProperty('display', 'none');
    });
    await page.waitForTimeout(500);

    expect(Math.abs((await at()) - (before - 2))).toBeLessThanOrEqual(1);
  });
});

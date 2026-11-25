// A pull request's revisions in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80, whose second push rebased its first onto a newer base. The header's button and
// the revision picker (`gv`) compare any two revisions, across the rebase, and the diff and the tree
// follow; a tab the reader left at the first push opens on what changed since; and a revision
// GitHub no longer has, which Lo never fetched, shows as no longer available.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  dataFolder,
  DIFF_FIRST,
  drawnWindow,
  expect,
  KEYCHAIN,
  test as base,
} from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** Whether the remote has the first push, as GitHub does. */
  firstPush: boolean;
}>({
  firstPush: [true, { option: true }],
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    await use(server);
    await server.close();
  },
  remote: async ({ firstPush }, use) => {
    await use(writeAppRemote(test.info().outputPath('remote'), { firstPush }));
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

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

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

/** What main has of a tab's revisions. */
async function revisions(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('revisions.list', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

/** The diff's files, by path, in the order the view shows them, once it's drawn. */
async function diffFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => window.loDiff?.files.map((file) => file.path) ?? []);
}

const button = (page: Page) => page.locator('header').getByRole('button', { name: /→/ });
const picker = (page: Page) => page.getByRole('listbox', { name: 'Compare revisions' });
const option = (page: Page, head: string) => picker(page).locator(`[data-key="${head}"]`);
const note = (page: Page) => page.getByRole('note', { name: 'Comparison' });
const row = (page: Page, key: string) =>
  page.locator('[role="tree"][data-lo-scope="tree"]').locator(`[data-key="${key}"]`);

/** Opens #80, and waits for its revisions and for its diff from the local copy. */
async function shown(page: Page): Promise<string> {
  const id = await openE2e(page);
  await expect
    .poll(() => revisions(page, id), { timeout: 30_000 })
    .toMatchObject({
      status: 'ready',
      revisions: [{ head: APP_PULL.firstHead }, { head: APP_PULL.head }],
    });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  return id;
}

test('the picker lists the revisions and compares two, across the rebase', async ({ page }) => {
  const id = await shown(page);
  await expect(button(page)).toContainText('base → r2');
  await expect(note(page)).toContainText('base → r2 · whole pull request');
  await expect.poll(() => diffFiles(page)).toHaveLength(7);

  // `gv` from the diff opens the picker at the comparison on screen.
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  await expect(picker(page)).toBeFocused();
  await expect(option(page, APP_PULL.head)).toContainText('r2');
  await expect(option(page, APP_PULL.head)).toContainText('Force-pushed · rebased onto app/base');
  await expect(option(page, APP_PULL.head)).toContainText('Latest');
  await expect(option(page, APP_PULL.firstHead)).toContainText('r1');
  await expect(option(page, 'base')).toContainText('app/base');
  await expect(option(page, APP_PULL.head)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'base')).toHaveAttribute('aria-selected', 'true');

  // `j` to r1, `Space` makes it the older end, `⏎` compares.
  await page.keyboard.press('j');
  await page.keyboard.press(' ');
  await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'base')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('button', { name: /Compare r1 → r2/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);

  // Only what the author changed since r1 shows: the base's README and everything r1 had stay out.
  await expect(button(page)).toContainText('r1 → r2');
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  await expect(note(page)).toContainText('r1 → r2 · across a rebase · the author’s changes only');
  await expect
    .poll(() => revisions(page, id))
    .toMatchObject({
      comparison: { from: APP_PULL.firstHead, to: APP_PULL.head },
      replay: 'clean',
    });
  // The tree marks the file that changed between them, and steps the pull request's others back.
  await expect(row(page, 'src/parser.ts')).toHaveAttribute('data-hit', '');
  await expect(row(page, 'src/format.ts')).not.toHaveAttribute('data-hit');
  await expect(row(page, 'src/format.ts')).toHaveClass(/text-fg-dim/);

  // The picker's shortcut back to the whole pull request.
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  await expect(picker(page)).toBeFocused();
  await page.keyboard.press('w');
  await expect(button(page)).toContainText('base → r2');
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toHaveLength(7);
  await expect(row(page, 'src/format.ts')).not.toHaveClass(/text-fg-dim/);
});

/**
 * Watches every change to the page from now on: how many times the pull request was on it with no
 * diff drawn, and how many times the diff drawn was held, marked as at work. Returns a reading.
 */
async function watchDiff(page: Page): Promise<() => Promise<{ bare: number; held: number }>> {
  await page.evaluate(() => {
    const seen = { bare: 0, held: 0 };
    new MutationObserver(() => {
      const pull = document.querySelector('[data-lo-pull]');
      if (pull && !pull.querySelector('.lo-diffview')) seen.bare += 1;
      if (document.querySelector('[data-lo-diff][data-lo-held]')) seen.held += 1;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
    Object.assign(window, { seen });
  });
  return () =>
    page.evaluate(() => {
      const counts: unknown = Reflect.get(window, 'seen');
      return {
        bare: Number(Reflect.get(Object(counts), 'bare')),
        held: Number(Reflect.get(Object(counts), 'held')),
      };
    });
}

/** Shows Settings, then the pull request's tab again, by its tab in the strip. */
async function awayAndBack(page: Page): Promise<void> {
  const opened = await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  expect(opened.ok).toBe(true);
  await expect(page.locator('[data-lo-pull]')).toHaveCount(0);
  await page
    .getByRole('tablist', { name: 'Tabs' })
    .getByRole('tab', { name: new RegExp(`#${APP_PULL.number}`) })
    .click();
}

const held = (page: Page) => page.locator('[data-lo-diff][data-lo-held]');

test('keeps the diff drawn, held, while the next one is worked out, and draws it in the first frame its tab comes back in, meanwhile and once the next is there', async ({
  app,
  page,
}) => {
  const id = await shown(page);
  await expect.poll(() => diffFiles(page)).toHaveLength(7);
  const seen = await watchDiff(page);
  // The background process works out each file's diff: paused, the next view can't be ready.
  const background = await app.evaluate(
    ({ app: main }) => main.getAppMetrics().find((metric) => metric.name === 'Lo background')?.pid,
  );
  if (background === undefined) throw new Error('Lo has no background process.');
  process.kill(background, 'SIGSTOP');
  try {
    // r1 → r2: the whole pull request stays, held.
    expect(
      await page.evaluate(
        ([tab, from, to]) => window.lo.invoke('revisions.compare', { id: tab, from, to }),
        [id, APP_PULL.firstHead, APP_PULL.head],
      ),
    ).toMatchObject({ ok: true });
    await expect(button(page)).toContainText('r1 → r2');
    await expect(held(page).locator('.lo-diffview')).toBeVisible();
    await expect(held(page)).toHaveAttribute('aria-busy', 'true');

    // Away to Settings and back meanwhile: the view it had, drawn again, held, from the frame the
    // tab is in.
    await awayAndBack(page);
    await expect(held(page).locator('.lo-diffview')).toBeVisible();
    expect((await seen()).bare).toBe(0);
  } finally {
    process.kill(background, 'SIGCONT');
  }
  // The comparison takes its place.
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  await expect(held(page)).toHaveCount(0);
  expect((await seen()).bare).toBe(0);

  // Away to Settings and back once it has: the comparison is there in the frame the tab is.
  await awayAndBack(page);
  await expect(page.locator('[data-lo-pull] .lo-diffview')).toBeVisible();
  expect(await diffFiles(page)).toEqual(['src/parser.ts']);
  expect((await seen()).bare).toBe(0);
});

test('the comparison takes the held diff’s place in one Swap, with the bar’s line and the tree, and no frame drawn shows the diff empty', async ({
  app,
  page,
}) => {
  const id = await shown(page);
  await expect.poll(() => diffFiles(page)).toHaveLength(7);
  const tree = page.locator('[role="tree"][data-lo-scope="tree"]');
  await expect(row(page, 'src/text/wrap.ts')).toBeVisible();
  const rows = await tree.getByRole('treeitem').allTextContents();
  // Moves on, as a reader has them, so the Swap runs for as long as it does for them.
  await page.evaluate(() => document.documentElement.setAttribute('data-lo-motion', 'full'));
  const background = await app.evaluate(
    ({ app: main }) => main.getAppMetrics().find((metric) => metric.name === 'Lo background')?.pid,
  );
  if (background === undefined) throw new Error('Lo has no background process.');
  process.kill(background, 'SIGSTOP');
  let frames: Frames;
  try {
    expect(
      await page.evaluate(
        ([tab, from, to]) => window.lo.invoke('revisions.compare', { id: tab, from, to }),
        [id, APP_PULL.firstHead, APP_PULL.head],
      ),
    ).toMatchObject({ ok: true });
    await expect(held(page).locator('.lo-diffview')).toBeVisible();
    // The tree holds the rows it drew, taking no input, while the diff holds its view.
    await expect(tree).toHaveAttribute('aria-busy', 'true');
    await expect(tree).toHaveAttribute('inert', '');
    expect(await tree.getByRole('treeitem').allTextContents()).toEqual(rows);
    // Each frame drawn from here on, and what the page says of the bar's line, the tree and the
    // diff in each.
    frames = await recordFrames(page);
  } finally {
    process.kill(background, 'SIGCONT');
  }
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  await expect(held(page)).toHaveCount(0);
  await expect(tree).not.toHaveAttribute('aria-busy');
  // The Swap's end, and a few frames after it.
  await expect.poll(() => page.locator('[data-lo-diff] .lo-diffview').count()).toBe(1);
  await page.waitForTimeout(200);
  const { painted, states } = await frames.stop();

  // The bar's line, the tree and the diff change in the same frame: while the diff is held, so are
  // the line and the tree, and the first frame it isn't, they aren't.
  const swap = states.findIndex((state) => !state.held);
  expect(swap).toBeGreaterThan(0);
  const holding = states.slice(0, swap);
  expect(new Set(holding.map((state) => state.note)).size).toBe(1);
  expect(holding.every((state) => state.treeHeld)).toBe(true);
  expect(states[swap]).toMatchObject({ treeHeld: false, note: states.at(-1)?.note });
  expect(holding[0]?.note).not.toBe(states.at(-1)?.note);
  // Every frame drawn, through the Swap, shows code in the diff's box: never the box alone.
  const box = await page.locator('[data-lo-diff]').boundingBox();
  if (!box) throw new Error('The diff has no box.');
  const width = await page.evaluate(() => window.innerWidth);
  expect(painted.length).toBeGreaterThan(5);
  const ink = await inkIn(app, painted, box, width);
  expect(ink.filter((share) => share < 0.01)).toEqual([]);
});

/** The frames a page draws, as JPEG in Base64, and what it says of the diff in each frame. */
interface Frames {
  stop(): Promise<{ painted: string[]; states: FrameState[] }>;
}

/** What the page says of the diff in a frame, as the frame is drawn. */
interface FrameState {
  held: boolean;
  treeHeld: boolean;
  note: string;
}

/**
 * Records each frame the window draws, as Chromium paints it, and in each, as it's about to be
 * drawn, whether the diff and the tree are held and what the bar's line says.
 */
async function recordFrames(page: Page): Promise<Frames> {
  const painted: string[] = [];
  const devtools = await page.context().newCDPSession(page);
  devtools.on('Page.screencastFrame', ({ data, sessionId }) => {
    painted.push(data);
    void devtools.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await devtools.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });
  await page.evaluate(() => {
    const states: { held: boolean; treeHeld: boolean; note: string }[] = [];
    let going = true;
    const sample = () => {
      if (!going) return;
      states.push({
        held: document.querySelector('[data-lo-diff][data-lo-held]') !== null,
        treeHeld: document.querySelector('[data-lo-scope="tree"][data-lo-held]') !== null,
        note: document.querySelector('[data-lo-diffnote]')?.textContent ?? '',
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.assign(window, {
      stopSampling: () => {
        going = false;
        return states;
      },
    });
  });
  return {
    async stop() {
      await devtools.send('Page.stopScreencast');
      await devtools.detach();
      const states: unknown = await page.evaluate(() =>
        Reflect.apply(Reflect.get(window, 'stopSampling'), window, []),
      );
      if (!Array.isArray(states)) throw new Error('The page sampled no frames.');
      return {
        painted,
        states: states.map((state: unknown) => ({
          held: Reflect.get(Object(state), 'held') === true,
          treeHeld: Reflect.get(Object(state), 'treeHeld') === true,
          note: String(Reflect.get(Object(state), 'note')),
        })),
      };
    },
  };
}

/**
 * How much of `box`, in CSS pixels, each frame draws other than the box's ground: the share of its
 * pixels that aren't the color most of them are. A frame of `width` CSS pixels, decoded in main.
 */
async function inkIn(
  app: ElectronApplication,
  frames: readonly string[],
  box: { x: number; y: number; width: number; height: number },
  width: number,
): Promise<number[]> {
  return app.evaluate(
    ({ nativeImage }, given) =>
      given.frames.map((data) => {
        const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
        const size = image.getSize();
        const scale = size.width / given.width;
        const pixels = image.toBitmap();
        const left = Math.round(given.box.x * scale);
        const top = Math.round(given.box.y * scale);
        const right = Math.min(size.width, Math.round((given.box.x + given.box.width) * scale));
        const bottom = Math.min(size.height, Math.round((given.box.y + given.box.height) * scale));
        const at = (x: number, y: number) => (y * size.width + x) * 4;
        // The ground: the color most pixels are, near enough.
        const counts = new Map<number, number>();
        for (let y = top; y < bottom; y += 2) {
          for (let x = left; x < right; x += 2) {
            const i = at(x, y);
            const color =
              ((pixels[i]! >> 3) << 10) | ((pixels[i + 1]! >> 3) << 5) | (pixels[i + 2]! >> 3);
            counts.set(color, (counts.get(color) ?? 0) + 1);
          }
        }
        const [ground] = [...counts].reduce((most, each) => (each[1] > most[1] ? each : most));
        const channels = [(ground >> 10) << 3, ((ground >> 5) & 31) << 3, (ground & 31) << 3];
        let inked = 0;
        let all = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const i = at(x, y);
            const off = channels.reduce(
              (sum, channel, c) => sum + Math.abs(pixels[i + c]! - channel),
              0,
            );
            if (off > 60) inked += 1;
            all += 1;
          }
        }
        return all === 0 ? 0 : inked / all;
      }),
    { frames: [...frames], box, width },
  );
}

/**
 * Closes the first copy of Lo, which made the database, and notes that the reader left the pull
 * request at its first push; then starts Lo again on the same data, fetching from `remote`, and
 * waiting `wait` milliseconds for the comparison that asks for.
 */
async function leftAtFirstPush(
  app: ElectronApplication,
  options: { github: ReplayServer; tokenFile: string; remote: string; wait: number },
): Promise<ElectronApplication> {
  await app.close();
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'));
  try {
    database
      .prepare('INSERT INTO revisions_lastseen (login, pull, head, seen_at) VALUES (?, ?, ?, ?)')
      .run('rozed-bot', 'rozed-dev/e2e#80', APP_PULL.firstHead, Date.now() - 60_000);
  } finally {
    database.close();
  }
  return electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(options.github.urls.api).origin,
      LO_TEST_TOKEN_FILE: options.tokenFile,
      LO_GIT_REMOTE: options.remote,
      LO_COMPARE_WAIT_MS: String(options.wait),
    },
    chromiumSandbox: true,
  });
}

/** The file at the top of the diff, by its id in the view. */
async function fileAtTop(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const top = window.loDiff?.viewport().at;
    return top?.kind === 'line' ? top.at.file : top?.file;
  });
}

test('opens on what changed since the reader last looked, across the rebase, and `gv` comes back to it', async ({
  app,
  github,
  remote,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // Waiting long enough for the comparison, however slow the machine: it's drawn first.
  const again = await leftAtFirstPush(app, { github, tokenFile, remote, wait: 30_000 });
  try {
    const page = await drawnWindow(again);
    const id = await openE2e(page);
    // It opens on r1 → r2, and draws nothing of the whole pull request first.
    await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
    await expect(button(page)).toContainText('r1 → r2');
    await expect(button(page)).toContainText('since last opened');
    expect(await diffFiles(page)).toEqual(['src/parser.ts']);
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    await expect(note(page)).toContainText('r1 → r2 · since last opened');
    await expect
      .poll(() => revisions(page, id))
      .toMatchObject({ markers: { lastSeen: APP_PULL.firstHead } });

    // The whole pull request, then `gv` and the shortcut back to since last seen.
    await page.locator('.lo-diffview').click();
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(option(page, APP_PULL.firstHead)).toContainText('Last opened');
    await page.keyboard.press('w');
    await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toHaveLength(7);
    await page.locator('.lo-diffview').click();
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: /Since last opened · r1 → r2/ })).toBeVisible();
    await page.keyboard.press('s');
    await expect(button(page)).toContainText('r1 → r2');
    await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  } finally {
    await again.close();
  }
});

test('draws the whole pull request when the local copy comes late, and only offers what changed since the reader last looked', async ({
  app,
  github,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // No remote yet: the local copy can't be fetched, so the comparison can't be ready in time.
  const late = test.info().outputPath('late-remote');
  const again = await leftAtFirstPush(app, {
    github,
    tokenFile,
    remote: `file://${late}`,
    wait: 1_000,
  });
  try {
    const page = await drawnWindow(again);
    const id = await openE2e(page);
    // GitHub's diff of the whole pull request, once the wait is over.
    await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => diffFiles(page)).toHaveLength(7);
    await expect(button(page)).toContainText('base → r2');
    // The reader moves on, two files down.
    await page.locator('.lo-diffview').click();
    await page.keyboard.press(']');
    await page.keyboard.press('f');
    await page.keyboard.press(']');
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    const top = await fileAtTop(page);
    expect(top).toBeDefined();

    // The local copy comes: the comparison is ready, and offered.
    writeAppRemote(late);
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect
      .poll(() => revisions(page, id), { timeout: 30_000 })
      .toMatchObject({
        comparison: { from: null, to: APP_PULL.head },
        offered: { from: APP_PULL.firstHead, to: APP_PULL.head },
        waitingFor: null,
      });
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
      .toMatchObject({ from: 'local', comparison: null });
    await expect(note(page)).toContainText('r1 → r2 since last opened');
    await page.waitForTimeout(1500);
    // Nothing changed by itself: the same view, its files, and the reader's place in it.
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    expect(await diffFiles(page)).toHaveLength(7);
    expect(await fileAtTop(page)).toBe(top);
    await expect(button(page)).toContainText('base → r2');

    // Until the reader asks: `gv` opens at the comparison offered, and `⏎` takes it.
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(picker(page)).toBeFocused();
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, APP_PULL.head)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(button(page)).toContainText('r1 → r2');
    await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  } finally {
    await again.close();
  }
});

test.describe('without the first push', () => {
  test.use({ firstPush: false });

  test('shows a revision GitHub no longer has, which Lo never fetched, as no longer available', async ({
    page,
  }) => {
    const id = await shown(page);
    await expect
      .poll(() => revisions(page, id), { timeout: 20_000 })
      .toMatchObject({
        revisions: [
          { head: APP_PULL.firstHead, available: false },
          { head: APP_PULL.head, available: true },
        ],
      });
    await button(page).click();
    await expect(picker(page)).toBeFocused();
    await expect(option(page, APP_PULL.firstHead)).toContainText('No longer on GitHub');
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-disabled', 'true');
    // It can't be an end.
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        ([tab, from, to]) => window.lo.invoke('revisions.compare', { id: tab, from, to }),
        [id, APP_PULL.firstHead, APP_PULL.head],
      ),
    ).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});

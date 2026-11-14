// Review threads in the diff: Lo, started on the replay server as rozed-bot, reads the threads on
// the comments fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94, and draws them under
// their lines, or a file's under its header, unresolved ones open and resolved ones collapsed, with
// an outdated one left out, those on the first screen with it.
// Each file's header and its row in the tree count them, `]t` and `[t` walk them, and `za` opens
// or collapses the one the cursor is on. Comments are drawn as GitHub renders them, images and all.
// A renamed file's thread under one of its old lines shows there. A stack's layer shows its own
// threads, and its overview's code block the one on its lines. The threads panel, `⌘⇧\`, lists
// them, without moving the diff's lines, and shows one in the diff, an outdated one in the whole
// diff of the revision it was written on, which `⌃o` and `⌃i` compare again; the last thread asked
// for wins. The stack's rows count each layer's unresolved threads.

import { writeFileSync } from 'node:fs';

import { COMMENTS_PULL, COMMENTS_RENAME_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, onStacks, STACK, test as base } from './app.ts';
import { serveBodies } from './bodies.ts';

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

/** How far below the top of the diff's box src/backoff.ts's new line 10 is drawn, to the pixel. */
function lineTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const diff = window.loDiff;
    const file = diff?.files.find((each) => each.path === 'src/backoff.ts')?.id;
    const box = document.querySelector('.lo-diffview')?.getBoundingClientRect().top;
    if (!diff || file === undefined || box === undefined) return Number.NaN;
    const at = diff.probe.spotTop({ kind: 'line', at: { file, side: 'new', line: 10 } });
    return at === undefined ? Number.NaN : Math.round(at - box);
  });
}

/** How far src/backoff.ts's new line 10 has moved since it was `before` below the diff's top. */
async function moved(page: Page, before: number): Promise<number> {
  return Math.abs((await lineTop(page)) - before);
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

  // A file's header and its row in the tree count its threads, and how many are unresolved.
  const header = page.locator('[data-lo-diff] .lo-filehead', { hasText: 'backoff.ts' }).first();
  await expect(header.getByRole('img', { name: '4 unresolved of 5' })).toHaveClass(/is-open/);
  const tree = page.locator('[data-lo-scope="tree"]');
  await expect(tree.getByRole('img', { name: '4 unresolved of 5' })).toBeVisible();
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

test('a thread under a renamed file’s old line shows in its older column', async ({ page }) => {
  // GitHub names it by the file's new path, docs/guide.md, on the base's side.
  await open(page, COMMENTS_RENAME_PULL.number);
  await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['docs/guide.md old 5']);
  await expect(card(page, 'The old wording said a second apart.')).toBeVisible();
  const tree = page.locator('[data-lo-scope="tree"]');
  await expect(tree.getByRole('img', { name: '1 unresolved' })).toBeVisible();
});

onStacks(
  'a layer of a stack shows its own threads, in its diff and on its overview’s code block',
  async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, STACK.b);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
    await expect(card(page, 'GitHub rounds each 100 nodes up')).toBeVisible();

    await test.step('its overview’s code block on those lines shows the thread under its line', async () => {
      await settled(page);
      await page.keyboard.press('~');
      const block = page
        .locator('[data-lo-middle-view="overview.view"] .lo-codeblock')
        .filter({ has: page.locator('.lo-codeblock__path', { hasText: 'src/cost.ts' }) });
      await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
      const thread = block.locator('[role="group"][aria-label$="thread by rozed-bot"]');
      await expect(thread).toContainText('GitHub rounds each 100 nodes up');
      // Under line 5, the line it's on.
      const above = await thread.evaluate(
        (element) => element.closest('.cm-content > *')?.previousElementSibling?.textContent,
      );
      expect(above).toBe('  return Math.max(1, Math.ceil(nodes / 100));');
      await page.keyboard.press('`');
      await expect(page.locator('.lo-diffview')).toBeVisible();
    });

    await settled(page);
    await page.keyboard.press('[');
    await page.keyboard.press('s');
    await expect
      .poll(() => page.evaluate(() => window.loDiff?.files.map((file) => file.path)), {
        timeout: 20_000,
      })
      .toEqual(['src/plans.ts']);
    await expect.poll(() => placed(page)).toEqual([]);
    await expect(card(page, 'GitHub rounds each 100 nodes up')).toHaveCount(0);
  },
);

onStacks(
  'the threads panel shows the layer on screen’s threads, and the stack counts each layer’s',
  async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, STACK.b);
    await expect.poll(() => placed(page), { timeout: 20_000 }).toEqual(['src/cost.ts new 5']);
    await settled(page);
    await page.keyboard.press(PANEL);
    await expect.poll(() => rows(page)).toEqual(['src/cost.ts new 5']);
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
    // #A, the layer below, has none of its own, and #B's row, off screen now, still counts its one,
    // as read with the layers.
    await expect(panel(page)).toContainText('No unresolved threads.');
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
  await open(page, COMMENTS_PULL.number);
  await expect.poll(() => placed(page), { timeout: 20_000 }).toHaveLength(10);
  await settled(page);
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
  // Once it's scrolled there and still: at the top, below the file's header.
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
        'docs/usage.md On the file',
        'src/backoff.ts new 2',
        'src/backoff.ts new 8',
        'src/backoff.ts r1 · line 9',
        'src/backoff.ts new 15',
        'src/backoff.ts new 17',
        'src/queue.ts new 10',
        'src/queue.ts new 10–35',
        'src/retry.ts old 2',
        'src/retry.ts new 16',
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
    await expect(focusedRow(page)).toContainText('new 8');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 8');
    await expect(focusedRow(page)).toHaveAttribute('aria-current', 'true');
    expect(await inPanel(page)).toBe(true);
  });

  await test.step('shows an outdated thread in the whole diff of the revision it was written on', async () => {
    await page.keyboard.press('j');
    await expect(focusedRow(page)).toContainText('r1 · line 9');
    await page.keyboard.press('Enter');
    await expect.poll(() => cursor(page), { timeout: 20_000 }).toBe('src/backoff.ts new 9');
    expect(await placed(page)).toContain('src/backoff.ts new 9');
    await expect(card(page, 'This grows without bound')).toBeVisible();
    // It says what it compared, and how to go back.
    const note = page.getByRole('status').filter({ hasText: 'Comparing base → r1' });
    await expect(note).toContainText(/This thread is on r1\. \S+ goes back\./);
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
    await expect(focusedRow(page)).toContainText('r1 · line 9');
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
    await expect(focusedRow(page)).toContainText('r1 · line 9');
    await page.keyboard.press('Enter');
    await expect.poll(() => compared(page, id)).toBe('coming');
    const note = page.getByRole('status').filter({ hasText: 'Comparing base → r1' });
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

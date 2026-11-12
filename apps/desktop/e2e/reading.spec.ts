// Reading a pull request's overview in the app: Lo, started on the replay server as rozed-bot,
// opens rozed-dev/e2e#80 on its overview when it shows within the bound, and on the diff when it
// doesn't, there's none, or Settings says so, offering one that comes later; says why one can't be
// shown; offers a newer one pushed while it's read; and never moves what's on screen without the
// reader. A server in front of the replay server answers for the overview's ref as each test says:
// with the overview `testing/fixtures/app.sh` wrote, none, one made here, or a failure.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import { appFolder, browsed, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';

declare global {
  interface Window {
    /** What moved on the overview while a test watched it, on a frame the reader gave no input. */
    loOverviewMoved?: string[];
    /** Stops watching. */
    loOverviewStill?: boolean;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** Where #80's overview's ref is read, past GitHub's origin. */
const REFS = `/repos/rozed-dev/e2e/git/matching-refs/lo/pr/${APP_PULL.number}`;

/** A file of an overview made here: its text, or a size Lo never reads past. */
type Made = string | { size: number };

/** An overview's commit made here, as GitHub would list it. */
interface Overview {
  sha: string;
  tree: string;
  entries: { path: string; type: 'blob' | 'tree'; sha: string; size?: number }[];
  blobs: Map<string, Uint8Array>;
}

/**
 * What the ref holds as the test goes: the overview the cassette recorded, none, one made here, or
 * a failure GitHub answers; and how long it takes to answer.
 */
interface Ref {
  holds:
    | { kind: 'cassette' }
    | { kind: 'none' }
    | { kind: 'failing' }
    | { kind: 'made'; overview: Overview };
  delay: number;
}

/** A blob's ID: what git names its bytes by. */
function blobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

let made = 0;

/** An overview's commit, made of `files`, by their paths. */
function overviewOf(files: Readonly<Record<string, Made>>): Overview {
  made += 1;
  const blobs = new Map<string, Uint8Array>();
  const entries: Overview['entries'] = [];
  const folders = new Set<string>();
  for (const [path, file] of Object.entries(files)) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      if (folders.has(folder)) continue;
      folders.add(folder);
      const sha = createHash('sha1').update(`tree ${made} ${folder}`).digest('hex');
      entries.push({ path: folder, type: 'tree', sha });
    }
    if (typeof file === 'string') {
      const bytes = new TextEncoder().encode(file);
      const sha = blobId(bytes);
      blobs.set(sha, bytes);
      entries.push({ path, type: 'blob', sha, size: bytes.length });
    } else {
      const sha = createHash('sha1').update(`never read ${made} ${path}`).digest('hex');
      entries.push({ path, type: 'blob', sha, size: file.size });
    }
  }
  const sha = createHash('sha1').update(`commit ${made}`).digest('hex');
  const tree = createHash('sha1').update(`tree ${made}`).digest('hex');
  return { sha, tree, entries, blobs };
}

/** An overview of #80 for its head, in format `format`, its body `body`. */
function textOf(body: string, format = 1): string {
  return `---\nformat: ${format}\npr: ${APP_PULL.number}\ncommit: ${APP_PULL.head}\n---\n\n${body}`;
}

/** An overview long enough to scroll, which says `lead` first. */
function longText(lead: string): string {
  const paragraphs = Array.from(
    { length: 30 },
    (_, index) => `Paragraph ${index + 1} says what one part of the change does, at some length.`,
  );
  return textOf(
    [
      `## tl;dr\n\n${lead}\n`,
      `## How it works\n\n${paragraphs.join('\n\n')}\n`,
      ':::fold Why it moves\nNothing imports it.\n:::\n',
      `## After\n\n${paragraphs.join('\n\n')}\n`,
    ].join('\n'),
  );
}

/** Answers `outgoing` with `body`, as JSON. */
function json(outgoing: ServerResponse, status: number, body: unknown): void {
  outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  outgoing.end(JSON.stringify(body));
}

/** Answers what GitHub would for `overview`'s commit, tree or blob at `path`; false for the rest. */
function answerFor(overview: Overview, path: string, outgoing: ServerResponse): boolean {
  const repo = '/repos/rozed-dev/e2e';
  const who = {
    name: 'rozed-bot',
    email: 'rozed-bot@users.noreply.github.com',
    date: '2026-11-11T09:30:00Z',
  };
  if (path === `${repo}/commits/${overview.sha}`) {
    json(outgoing, 200, {
      sha: overview.sha,
      commit: { author: who, committer: who, message: 'Overview', tree: { sha: overview.tree } },
      author: { login: 'rozed-bot', type: 'User' },
    });
    return true;
  }
  if (path === `${repo}/git/trees/${overview.tree}`) {
    json(outgoing, 200, {
      sha: overview.tree,
      tree: overview.entries.map((entry) => ({
        ...entry,
        mode: entry.type === 'tree' ? '040000' : '100644',
      })),
      truncated: false,
    });
    return true;
  }
  const blob = overview.blobs.get(path.slice(`${repo}/git/blobs/`.length));
  if (path.startsWith(`${repo}/git/blobs/`) && blob) {
    outgoing.writeHead(200, { 'content-type': 'application/octet-stream' });
    outgoing.end(Buffer.from(blob));
    return true;
  }
  return false;
}

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** The cassette GitHub answers from. */
  cassette: string;
  /** Whether the remote is written only once the test says, so the local copy comes late. */
  lateRemote: boolean;
  /** What the overview's ref holds, which the test changes as it goes. */
  ref: Ref;
  /** Where Lo finds GitHub: a server in front of the replay server. */
  githubOrigin: string;
}>({
  cassette: ['app_e2e', { option: true }],
  lateRemote: [false, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  ref: async ({}, use) => {
    await use({ holds: { kind: 'cassette' }, delay: 0 });
  },
  githubOrigin: async ({ github, ref }, use) => {
    const origin = new URL(github.urls.api).origin;
    // Every overview made here this test, so a commit once named is still read after the ref moves.
    const overviews: Overview[] = [];
    const front = createServer((incoming, outgoing) => {
      void (async () => {
        const body = await buffer(incoming);
        // The replay server serves GitHub's REST API under /api.
        const path = new URL(incoming.url ?? '/', origin).pathname.replace(/^\/api\//, '/');
        const { holds } = ref;
        if (holds.kind === 'made' && !overviews.includes(holds.overview)) {
          overviews.push(holds.overview);
        }
        if (path === REFS) {
          if (ref.delay > 0) await new Promise((resolve) => setTimeout(resolve, ref.delay));
          if (holds.kind === 'none') return json(outgoing, 200, []);
          if (holds.kind === 'failing') return json(outgoing, 502, { message: 'Server Error' });
          if (holds.kind === 'made') {
            return json(outgoing, 200, [
              {
                ref: `refs/lo/pr/${APP_PULL.number}`,
                object: { sha: holds.overview.sha, type: 'commit' },
              },
            ]);
          }
        }
        if (overviews.some((overview) => answerFor(overview, path, outgoing))) return;
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
      })().catch(() => {
        // The test has ended, and the replay server with it: the request goes unanswered.
        outgoing.destroy();
      });
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
  launch: async ({ githubOrigin, remote, tokenFile }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: githubOrigin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/** Waits for the account from the token file, then opens #80's tab, and returns its id. */
async function open(page: Page): Promise<string> {
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

/** What main has of a tab's overview, as the window asks it. */
async function current(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('overview.current', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

/** Has main read the ref again now, as `Retry now` does. */
async function readAgain(page: Page, id: string): Promise<void> {
  await page.evaluate((tab) => window.lo.invoke('overview.retry', { id: tab }), id);
}

/** A middle view of the tab on screen, by its id: drawn, whether or not it's the one shown. */
const middleView = (page: Page, id: 'overview.view' | 'diff.view') =>
  page.locator(`[data-lo-middle-view="${id}"]`);

/** The header's view switch. */
const views = (page: Page) => page.getByRole('tablist', { name: 'View' });

/** The view switch's tab for the overview, with its mark. */
const overviewTab = (page: Page) => views(page).getByRole('tab').filter({ hasText: 'Overview' });

/** The overview's view, in what it shows. */
const overview = (page: Page, kind: string) =>
  middleView(page, 'overview.view').locator(`[data-lo-overview="${kind}"]`);

/** What the clipboard holds. */
const clipboard = (app: ElectronApplication) =>
  app.evaluate(({ clipboard: board }) => board.readText());

test.describe('as a pull request opens', () => {
  test('opens on its overview when it shows within the bound, with who wrote it and its mark', async ({
    page,
  }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
    });
    await open(page);
    await expect(overview(page, 'shown')).toBeVisible({ timeout: 10_000 });
    // It opened on the overview: the diff was never drawn.
    await expect(middleView(page, 'diff.view')).toHaveCount(0);
    await expect(overviewTab(page)).toHaveAttribute('aria-selected', 'true');
    // Written for the first push, which the second force-pushed over.
    await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('Overview, out of date');
    const byline = page.locator('[data-lo-byline]');
    await expect(byline).toContainText('rozed-bot wrote this overview');
    await expect(byline).toContainText(`describes r1 ${APP_PULL.firstHead.slice(0, 7)}`);
    await expect(
      middleView(page, 'overview.view').locator('figure.lo-figure:not(.lo-figure--broken)'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    expect(refused).toEqual([]);
  });

  test.describe('with Settings saying the diff', () => {
    test.use({ settings: DIFF_FIRST });

    test('opens on the diff, and the overview is one switch away', async ({ page }) => {
      const id = await open(page);
      await expect(middleView(page, 'diff.view')).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(() => current(page, id), { timeout: 20_000 })
        .toMatchObject({ found: 'commit' });
      await expect(overviewTab(page).getByRole('img')).toBeVisible();
      await expect(middleView(page, 'overview.view')).toBeHidden();
      await expect(page.locator('footer')).not.toContainText('Overview ready');
      await overviewTab(page).click();
      await expect(overview(page, 'shown')).toBeVisible();
      await expect(middleView(page, 'diff.view')).toBeHidden();
    });
  });

  test('opens on the diff when there’s no overview, which offers the prompt to write one', async ({
    app,
    page,
    ref,
  }) => {
    ref.holds = { kind: 'none' };
    const id = await open(page);
    await expect(middleView(page, 'diff.view')).toBeVisible({ timeout: 10_000 });
    await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('No overview yet');
    await overviewTab(page).click();
    await expect(overview(page, 'none')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No overview yet' })).toBeVisible();
    await expect(page.locator('footer')).toContainText(`Watching refs/lo/pr/${APP_PULL.number}`);

    const prompt = [
      'Write a Lo overview for this pull request:',
      `https://github.com/rozed-dev/e2e/pull/${APP_PULL.number}`,
      '',
      'Use the lo-overview skill. Read the diff, the description',
      'and the commits; write artifact.md and its figures; run the',
      `checker; then push to refs/lo/pr/${APP_PULL.number}.`,
    ].join('\n');
    await expect(overview(page, 'none').locator('pre')).toHaveText(prompt);
    await overview(page, 'none').getByRole('button', { name: /^Copy/ }).click();
    await expect(overview(page, 'none').getByRole('button', { name: /^Copied/ })).toBeVisible();
    expect(await clipboard(app)).toBe(prompt);
    // `ya` copies it too.
    await app.evaluate(({ clipboard: board }) => board.writeText(''));
    await page.keyboard.press('y');
    await page.keyboard.press('a');
    await expect.poll(() => clipboard(app)).toBe(prompt);
    expect(await current(page, id)).toMatchObject({ found: 'none', watching: true });
  });

  test('opens on the diff when the overview comes after the bound, and offers it', async ({
    page,
    ref,
  }) => {
    ref.delay = 2500;
    const id = await open(page);
    await expect(middleView(page, 'diff.view')).toBeVisible({ timeout: 10_000 });
    await expect(middleView(page, 'overview.view')).toBeHidden();
    await expect
      .poll(() => current(page, id), { timeout: 20_000 })
      .toMatchObject({ found: 'commit' });
    const ready = page.locator('footer').getByText('Overview ready');
    await expect(ready).toBeVisible({ timeout: 10_000 });
    // Offered, and the diff stays.
    await expect(middleView(page, 'diff.view')).toBeVisible();
    await expect(middleView(page, 'overview.view')).toBeHidden();
    await ready.click();
    await expect(overview(page, 'shown')).toBeVisible();
    // Seen, it's no longer offered.
    await views(page).getByRole('tab', { name: 'Diff' }).click();
    await expect(middleView(page, 'diff.view')).toBeVisible();
    await expect(ready).toHaveCount(0);
  });
});

test('offers a newer overview pushed while one is read, and loads it only when asked', async ({
  page,
  ref,
}) => {
  ref.holds = { kind: 'made', overview: overviewOf({ 'artifact.md': longText('The first one.') }) };
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('Overview', {
    timeout: 20_000,
  });
  await overviewTab(page).click();
  const shown = overview(page, 'shown');
  await expect(shown).toContainText('The first one.');

  // The reader scrolls down and opens the fold.
  const scroller = shown.locator('.lo-ov');
  const fold = shown.locator('details');
  await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open', '');
  await scroller.evaluate((element) => {
    element.scrollTop = 600;
  });
  await shown.locator('.lo-ov__article').evaluate((article) => {
    article.dataset.seen = 'yes';
  });
  // A paragraph in the middle of the screen, where the reader is.
  const reading = shown.getByText('Paragraph 20 says', { exact: false }).first();
  const before = (await reading.boundingBox())?.y;

  ref.holds = {
    kind: 'made',
    overview: overviewOf({ 'artifact.md': longText('The second one.') }),
  };
  await readAgain(page, id);
  const byline = page.locator('[data-lo-byline]');
  await expect(byline).toContainText('A newer overview was pushed', { timeout: 20_000 });
  // The one on screen stays as the reader left it.
  await expect(shown.locator('.lo-ov__article[data-seen="yes"]')).toContainText('The first one.');
  await expect(fold).toHaveAttribute('open', '');
  expect((await reading.boundingBox())?.y).toBe(before);

  await byline.getByRole('button', { name: 'Load it' }).click();
  await expect(shown).toContainText('The second one.');
  await expect(byline).not.toContainText('A newer overview was pushed');
});

test('says why an overview can’t be shown, offering each newer one', async ({ app, page, ref }) => {
  ref.holds = {
    kind: 'made',
    overview: overviewOf({
      'artifact.md': textOf('## tl;dr\n\nIt reads.\n\n:::chart Lines\n:::\n'),
    }),
  };
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName(
    "Overview, can't be shown",
    { timeout: 20_000 },
  );
  // It opened on the diff.
  await expect(middleView(page, 'diff.view')).toBeVisible();
  await overviewTab(page).click();
  const invalid = overview(page, 'invalid');
  await expect(invalid.getByRole('heading', { name: 'This overview can’t be read' })).toBeVisible();
  const problem = invalid
    .getByRole('list', { name: 'Problems' })
    .getByRole('listitem')
    .filter({ hasText: 'chart' });
  await expect(problem).toContainText('line 11');
  await invalid.getByRole('button', { name: /^Copy a prompt to fix it/ }).click();
  await expect.poll(() => clipboard(app)).toMatch(/^Fix the Lo overview for this pull request:/);
  expect(await clipboard(app)).not.toContain('chart');

  // Too large: its figures are past what Lo shows.
  ref.holds = {
    kind: 'made',
    overview: overviewOf({
      'artifact.md': textOf('## tl;dr\n\nIt reads.\n'),
      'figures/shot.png': { size: 60 * 1024 * 1024 },
    }),
  };
  await readAgain(page, id);
  await invalid.getByRole('button', { name: 'Load it' }).click({ timeout: 20_000 });
  const large = overview(page, 'tooLarge');
  await expect(
    large.getByRole('heading', { name: 'This overview is too large to show' }),
  ).toBeVisible();
  await expect(large.getByRole('list', { name: 'Sizes' })).toContainText('PNG figures');

  // In a format this Lo doesn't read.
  ref.holds = {
    kind: 'made',
    overview: overviewOf({ 'artifact.md': textOf('## tl;dr\n\nIt reads.\n', 2) }),
  };
  await readAgain(page, id);
  await large.getByRole('button', { name: 'Load it' }).click({ timeout: 20_000 });
  const newer = overview(page, 'newer');
  await expect(
    newer.getByRole('heading', { name: 'This overview needs a newer Lo' }),
  ).toBeVisible();
  await expect(newer).toContainText('format 2');
  await newer.getByRole('button', { name: 'Get a newer Lo' }).click();
  await expect.poll(browsed).toEqual(['https://github.com/withlo/lo/releases']);
});

test('says when the overview couldn’t be fetched, and reads it again on Retry now', async ({
  page,
  ref,
}) => {
  ref.holds = { kind: 'failing' };
  const id = await open(page);
  await expect
    .poll(() => current(page, id), { timeout: 20_000 })
    .toMatchObject({ problem: { kind: 'failed' } });
  await expect(middleView(page, 'diff.view')).toBeVisible();
  await overviewTab(page).click();
  const failed = overview(page, 'failed');
  await expect(failed.getByRole('heading', { name: 'Couldn’t fetch the overview' })).toBeVisible();
  await expect(failed).toContainText(`Lo couldn't read refs/lo/pr/${APP_PULL.number}`);
  await expect(failed).toContainText(/Trying again in \d+ s\./);

  ref.holds = { kind: 'cassette' };
  await failed.getByRole('button', { name: 'Retry now' }).click();
  await expect(overview(page, 'shown')).toBeVisible({ timeout: 20_000 });
});

/**
 * Watches, every frame until the test stops it, where the overview's block at the top of the
 * screen and the one in its middle are on the page, and says each time either has moved, or was
 * drawn again, on a frame without the reader's input. Each counts as moved once it's been away
 * from its place for two frames running, so a change made up for before it's painted doesn't.
 */
async function watchStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-lo-overview="shown"] .lo-ov');
    const article = scroller?.querySelector<HTMLElement>('.lo-ov__article');
    if (!scroller || !article) throw new Error('no overview to watch');
    const box = scroller.getBoundingClientRect();
    const x = article.getBoundingClientRect().left + article.clientWidth / 2;
    /** The article's block at height `y` on the page, or the nearest under it. */
    const blockAt = (y: number) => {
      for (let dy = 0; dy < box.height / 2; dy += 4) {
        let element = document.elementFromPoint(x, y + dy);
        while (element && element.parentElement !== article) element = element.parentElement;
        if (element) return element;
      }
      return undefined;
    };
    const watched = [
      { name: 'top', block: blockAt(box.top + 8) },
      { name: 'middle', block: blockAt(box.top + box.height / 2) },
    ].flatMap(({ name, block }) =>
      block ? [{ name, block, y: block.getBoundingClientRect().top, away: 0 }] : [],
    );
    if (watched.length < 2) throw new Error('no block to watch in the middle of the screen');
    const moved: string[] = [];
    window.loOverviewMoved = moved;
    window.loOverviewStill = false;
    let input = false;
    for (const type of ['wheel', 'keydown', 'pointerdown']) {
      window.addEventListener(type, () => (input = true), { capture: true });
    }
    const tick = () => {
      for (const each of watched) {
        const y = each.block.isConnected ? each.block.getBoundingClientRect().top : undefined;
        if (input) {
          if (y !== undefined) each.y = y;
          each.away = 0;
          continue;
        }
        const off = y === undefined || Math.abs(y - each.y) > 0.5;
        each.away = off ? each.away + 1 : 0;
        if (each.away === 2) {
          moved.push(`${each.name} ${each.block.textContent?.slice(0, 40)} from ${each.y} to ${y}`);
        }
      }
      input = false;
      if (!window.loOverviewStill) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test.describe('while the local copy comes late', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  for (const depth of [0, 0.5]) {
    test(`nothing on screen moves as the banner goes and the overview is checked again, ${depth * 100}% of the way down`, async ({
      app,
      page,
    }) => {
      test.setTimeout(90_000);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setSize(1100, 440),
      );
      const id = await open(page);
      await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
      await overviewTab(page).click();
      const shown = overview(page, 'shown');
      await expect(shown).toBeVisible();
      // The banner says the local copy couldn't be fetched, over the overview.
      await expect(page.locator('[data-lo-banners]')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(() => current(page, id), { timeout: 20_000 })
        .toMatchObject({ code: 'failed' });

      // The reader opens the fold, which keeps focus, and wheels down to where they read.
      const scroller = shown.locator('.lo-ov');
      const fold = shown.locator('details').first();
      await fold.locator('summary').click();
      await expect(fold).toHaveAttribute('open', '');
      const box = await scroller.boundingBox();
      await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.6, (box?.y ?? 0) + 100);
      const goal = await scroller.evaluate(
        (element, part) => Math.round((element.scrollHeight - element.clientHeight) * part),
        depth,
      );
      await expect
        .poll(
          async () => {
            const at = await scroller.evaluate((element) => element.scrollTop);
            if (at > goal) await page.mouse.wheel(0, Math.max(-400, goal - at));
            else if (at < goal) await page.mouse.wheel(0, Math.min(400, goal - at));
            return Math.abs(at - goal) <= 1;
          },
          { timeout: 10_000, intervals: [100] },
        )
        .toBe(true);
      await page.evaluate(() => {
        const summary = document.querySelector<HTMLElement>('[data-lo-overview="shown"] summary');
        summary?.setAttribute('data-focused', String(document.activeElement === summary));
      });
      await expect(fold.locator('summary')).toHaveAttribute('data-focused', 'true');
      await page.waitForTimeout(500);
      await watchStill(page);

      // The banner goes, the local copy comes, and the overview is checked again with its code.
      writeAppRemote(test.info().outputPath('remote'));
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
      await expect(page.locator('[data-lo-banners]')).toHaveCount(0, { timeout: 30_000 });
      await expect
        .poll(() => current(page, id), { timeout: 30_000 })
        .toMatchObject({ code: 'ready' });
      await page.waitForTimeout(2500);
      const moved = await page.evaluate(() => {
        window.loOverviewStill = true;
        return window.loOverviewMoved ?? [];
      });

      expect(moved).toEqual([]);
      await expect(fold).toHaveAttribute('open', '');
      expect(
        await page.evaluate(
          () =>
            document.activeElement === document.querySelector('[data-lo-overview="shown"] summary'),
        ),
      ).toBe(true);
    });
  }
});

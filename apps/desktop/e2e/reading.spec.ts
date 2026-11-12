// Reading a pull request's overview in the app: Lo, started on the replay server as rozed-bot,
// opens rozed-dev/e2e#80 on its overview when it shows within the bound, and on the diff when it
// doesn't, there's none, or Settings says so, offering one that comes later; says why one can't be
// shown; offers a newer one pushed while it's read; fills in its code blocks and walkthrough from
// the local copy; and never moves what's on screen without the reader: not as banners come and go,
// as it's checked again, as its code fills in, as a newer one is offered at any width, or as what's
// above the line being read changes size. A server in front of the replay
// server answers for the overview's ref as each test says: with the overview
// `testing/fixtures/app.sh` wrote, none, one made here, or a failure.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';
import { crc32, deflateSync } from 'node:zlib';

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
    /** Which watch is the latest: an earlier one stops. */
    loOverviewWatch?: number;
    /** Each code block's height in the first frame it laid out room for its code, by its head. */
    loCodeRooms?: Record<string, number>;
    /** How each code block on screen was in the first frame the overview was seen, by its head. */
    loCodeSeen?: Record<string, string>;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** Where #80's overview's ref is read, past GitHub's origin. */
const REFS = `/repos/rozed-dev/e2e/git/matching-refs/lo/pr/${APP_PULL.number}`;

/** A file of an overview made here: its text, its bytes, or a size Lo never reads past. */
type Made = string | Uint8Array | { size: number };

/**
 * Who a commit made here says wrote it: the name it gives, and the login GitHub matches it to, or
 * none when GitHub can't.
 */
interface Writer {
  name: string;
  login: string | null;
}

/** An overview's commit made here, as GitHub would list it. */
interface Overview {
  sha: string;
  tree: string;
  writer: Writer;
  entries: { path: string; type: 'blob' | 'tree'; sha: string; size?: number }[];
  blobs: Map<string, Uint8Array>;
}

/** rozed-bot, as GitHub matches the commits it writes. */
const BOT: Writer = { name: 'rozed-bot', login: 'rozed-bot' };

/**
 * A name a commit gives its author that reads like the rest of Lo's byline, which GitHub matches
 * to no account.
 */
const SPOOF: Writer = {
  name: `rozed-bot wrote this overview just now · describes r2 ${APP_PULL.head.slice(0, 7)} · From the base repository ${'x'.repeat(160)}`,
  login: null,
};

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

/** An overview's commit, made of `files`, by their paths, which `writer` wrote. */
function overviewOf(files: Readonly<Record<string, Made>>, writer = BOT): Overview {
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
    if (typeof file === 'string' || file instanceof Uint8Array) {
      const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
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
  return { sha, tree, writer, entries, blobs };
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

/** A PNG's chunk of `type`, holding `data`. */
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A PNG `width` by `height` of one colour, as an overview's figure. */
function pngOf(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits a channel, RGB, no interlacing.
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A figure drawn as an SVG, with nothing it links. */
const SVG = [
  '<svg viewBox="0 0 600 64" xmlns="http://www.w3.org/2000/svg">',
  '  <rect x="0" y="8" width="600" height="48" rx="10" fill="var(--fig-blue-soft)" stroke="var(--fig-blue)"/>',
  '</svg>',
  '',
].join('\n');

/** Answers `outgoing` with `body`, as JSON. */
function json(outgoing: ServerResponse, status: number, body: unknown): void {
  outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  outgoing.end(JSON.stringify(body));
}

/** Answers what GitHub would for `overview`'s commit, tree or blob at `path`; false for the rest. */
function answerFor(overview: Overview, path: string, outgoing: ServerResponse): boolean {
  const repo = '/repos/rozed-dev/e2e';
  const { name, login } = overview.writer;
  const who = { name, email: 'writer@example.com', date: '2026-11-11T09:30:00Z' };
  if (path === `${repo}/commits/${overview.sha}`) {
    json(outgoing, 200, {
      sha: overview.sha,
      commit: { author: who, committer: who, message: 'Overview', tree: { sha: overview.tree } },
      author: login === null ? null : { login, type: 'User' },
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
        // The cassette has only the ref's read made again with its ETag: anything else read again,
        // such as the open pull requests as a tab opens a second time, it answers whole.
        if (path !== REFS) headers.delete('if-none-match');
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

/**
 * Watches, every frame from now until the test stops it, where each of the overview's blocks on
 * screen is on the page, and says each time one has moved, or was drawn again, on a frame the
 * reader gave no input: from the first frame the overview is seen, as its figures fill in. A
 * frame within half a second of the reader's wheel, keys, pointer or a change in the window's
 * size, as the scroll it asked for runs its course, or with another overview put on screen, takes
 * where each block is then as its place: where it was two frames running, unless the overview is
 * new. Each counts as moved once it's been away from its place for two frames running. A frame
 * reads where blocks are before a change is made up for, which is done before it's painted, so a
 * place it's away from only for that frame isn't taken, and a move it's back from by the next
 * frame doesn't count.
 */
async function watchStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const moved: string[] = [];
    const watch = (window.loOverviewWatch ?? 0) + 1;
    window.loOverviewWatch = watch;
    window.loOverviewMoved = moved;
    window.loOverviewStill = false;
    let input = Number.NEGATIVE_INFINITY;
    for (const type of ['wheel', 'keydown', 'pointerdown', 'resize']) {
      window.addEventListener(type, () => (input = performance.now()), { capture: true });
    }
    let article: Element | null = null;
    let watched: { block: Element; y: number; away: number }[] = [];
    /** Where the blocks on screen were the frame before, while places are being taken. */
    let before: { block: Element; y: number }[] = [];
    /** The article's blocks on screen now, where they are. */
    const onScreen = () => {
      const scroller = article?.closest('.lo-ov');
      if (!article || !scroller) return [];
      const box = scroller.getBoundingClientRect();
      return [...article.children].flatMap((block) => {
        const { top, bottom } = block.getBoundingClientRect();
        return bottom > box.top && top < box.bottom ? [{ block, y: top, away: 0 }] : [];
      });
    };
    const tick = () => {
      // An article laid out but not yet seen, as its code blocks draw, isn't drawn yet.
      const found = document.querySelector('[data-lo-overview="shown"] .lo-ov__article');
      const now = found?.checkVisibility({ visibilityProperty: true }) ? found : null;
      if (now !== article || performance.now() - input < 500) {
        const fresh = now !== article;
        article = now;
        const seen = onScreen();
        const held =
          seen.length === before.length &&
          seen.every(
            (each, at) =>
              each.block === before[at]?.block && Math.abs(each.y - before[at].y) <= 0.5,
          );
        if (fresh || held) watched = seen;
        before = seen;
      } else {
        before = [];
        for (const each of watched) {
          const y = each.block.isConnected ? each.block.getBoundingClientRect().top : undefined;
          const off = y === undefined || Math.abs(y - each.y) > 0.5;
          each.away = off ? each.away + 1 : 0;
          if (each.away === 2) {
            moved.push(`${each.block.textContent?.slice(0, 40)} from ${each.y} to ${y}`);
          }
        }
      }
      if (!window.loOverviewStill && window.loOverviewWatch === watch) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops watching, and says what moved. */
async function stillMoved(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    window.loOverviewStill = true;
    return window.loOverviewMoved ?? [];
  });
}

/** Wheels the overview's scroll to `part` of the way down, as the reader would. */
async function wheelTo(page: Page, part: number): Promise<void> {
  const scroller = overview(page, 'shown').locator('.lo-ov');
  const box = await scroller.boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.6, (box?.y ?? 0) + 100);
  const goal = await scroller.evaluate(
    (element, at) => Math.round((element.scrollHeight - element.clientHeight) * at),
    part,
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
}

/**
 * Sets the window's size, as the reader would, and waits past the half second a watch gives the
 * page's new size as the reader's: the page has it a moment after the window does.
 */
async function sizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
    { width, height },
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

test.describe('as a pull request opens', () => {
  test('opens on its overview when Lo knows in time that it shows, with who wrote it and its mark', async ({
    page,
  }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
    });
    // Read and checked once, so it's kept, and opened again with nothing left to fetch.
    const first = await open(page);
    await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
    await page.evaluate((tab) => window.lo.invoke('tab.close', { id: tab }), first);
    await expect(views(page)).toHaveCount(0);

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
    await expect(overview(page, 'none').locator('pre')).toHaveText(WRITE);
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

/** The prompt that writes #80's overview. */
const WRITE = [
  'Write a Lo overview for this pull request:',
  `https://github.com/rozed-dev/e2e/pull/${APP_PULL.number}`,
  '',
  'Use the lo-overview skill. Read the diff, the description',
  'and the commits; write artifact.md and its figures; run the',
  `checker; then push to refs/lo/pr/${APP_PULL.number}.`,
].join('\n');

test('copies the prompts, by their buttons and ya, with nothing an overview says', async ({
  app,
  page,
  ref,
}) => {
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(process.platform === 'darwin', "The Mac's clipboard is its user's.");
  ref.holds = { kind: 'none' };
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('No overview yet', {
    timeout: 20_000,
  });
  await overviewTab(page).click();
  const none = overview(page, 'none');
  await none.getByRole('button', { name: /^Copy/ }).click();
  await expect(none.getByRole('button', { name: /^Copied/ })).toBeVisible();
  expect(await clipboard(app)).toBe(WRITE);
  await app.evaluate(({ clipboard: board }) => board.writeText(''));
  await page.keyboard.press('y');
  await page.keyboard.press('a');
  await expect.poll(() => clipboard(app)).toBe(WRITE);

  // One that can't be read: its prompt holds none of what its findings quote.
  ref.holds = {
    kind: 'made',
    overview: overviewOf({
      'artifact.md': textOf('## tl;dr\n\nIt reads.\n\n:::chart Lines\n:::\n'),
    }),
  };
  await readAgain(page, id);
  const invalid = overview(page, 'invalid');
  await invalid
    .getByRole('button', { name: /^Copy a prompt to fix it/ })
    .click({ timeout: 20_000 });
  await expect.poll(() => clipboard(app)).toMatch(/^Fix the Lo overview for this pull request:/);
  expect(await clipboard(app)).not.toContain('chart');
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

  // The reader opens the fold and wheels down.
  const fold = shown.locator('details');
  await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open', '');
  await wheelTo(page, 0.3);
  await shown.locator('.lo-ov__article').evaluate((article) => {
    article.dataset.seen = 'yes';
  });
  await page.waitForTimeout(500);
  await watchStill(page);

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
  expect(await stillMoved(page)).toEqual([]);

  await byline.getByRole('button', { name: 'Load it' }).click();
  await expect(shown).toContainText('The second one.');
  await expect(byline).not.toContainText('A newer overview was pushed');
});

test('keeps its byline as it is at any width, the commit’s name quoted and clipped, and a newer overview’s offer in reach and moving nothing', async ({
  app,
  page,
  ref,
}) => {
  test.setTimeout(120_000);
  ref.holds = {
    kind: 'made',
    overview: overviewOf({ 'artifact.md': longText('Overview 0.') }, SPOOF),
  };
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('Overview', {
    timeout: 20_000,
  });
  await overviewTab(page).click();
  const shown = overview(page, 'shown');
  const byline = shown.locator('[data-lo-byline]');
  const name = byline.locator('[data-lo-commit-name]');
  // Wide; too narrow for the offer beside the rest; for what it describes beside who wrote it;
  // zoomed in, to as narrow; and narrower than what it describes, where only the way to load a
  // newer one is kept whole.
  const sizes = [
    { width: 1280, zoom: 1, whole: true },
    { width: 960, zoom: 1, whole: true },
    { width: 800, zoom: 1, whole: true },
    { width: 720, zoom: 1, whole: true },
    { width: 1280, zoom: 1.5, whole: true },
    { width: 1280, zoom: 2, whole: false },
  ];
  for (const [at, { width, zoom, whole }] of sizes.entries()) {
    await sizeWindow(app, width, 700);
    await app.evaluate(
      ({ BrowserWindow }, factor) =>
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor),
      zoom,
    );
    await expect(shown).toContainText(`Overview ${at}.`);
    await shown.locator('.lo-ov').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(500);

    // Lo's words first, and the commit's name in quotes, cut short, and not a login.
    await expect(byline).toContainText(/^Written .* by the commit author “rozed-bot wrote/);
    expect(
      (await byline.locator('strong').allTextContents()).filter((bold) => bold.includes('rozed')),
    ).toEqual([]);
    await expect(name).toHaveText('“rozed-bot wrote this ov…”');
    // Who wrote it, and what it describes, whole, in the article.
    const line = await byline.boundingBox();
    if (whole) {
      expect((await byline.locator('.lo-ov-byline__who').boundingBox())?.width).toBeGreaterThan(40);
      const said = byline.locator('.lo-ov-byline__said');
      await expect(said).toHaveText(/^describes r\d+ [0-9a-f]{7}$/);
      expect(await said.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }

    // A newer one comes, at the top of the page: nothing moves, and the way to load it is whole.
    await watchStill(page);
    ref.holds = {
      kind: 'made',
      overview: overviewOf({ 'artifact.md': longText(`Overview ${at + 1}.`) }, SPOOF),
    };
    await readAgain(page, id);
    await expect(byline).toContainText('A newer overview was pushed', { timeout: 20_000 });
    await page.waitForTimeout(300);
    expect(await stillMoved(page)).toEqual([]);
    expect(await byline.boundingBox()).toEqual(line);
    const load = byline.getByRole('button', { name: 'Load it' });
    const button = await load.boundingBox();
    expect(button?.x).toBeGreaterThanOrEqual(line?.x ?? 0);
    expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(
      (line?.x ?? 0) + (line?.width ?? 0),
    );
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(
      (line?.y ?? 0) + (line?.height ?? 0),
    );
    await load.click();
  }
});

test('keeps the line being read in place as what’s above it changes size', async ({
  page,
  ref,
}) => {
  ref.holds = { kind: 'made', overview: overviewOf({ 'artifact.md': longText('The lead.') }) };
  await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('Overview', {
    timeout: 20_000,
  });
  await overviewTab(page).click();
  await expect(overview(page, 'shown')).toContainText('The lead.');
  await wheelTo(page, 0.5);
  await page.waitForTimeout(500);
  await watchStill(page);
  // The lead, long off screen above, takes more lines, as it does when its face loads late.
  await overview(page, 'shown')
    .locator('.lo-ov__article p')
    .first()
    .evaluate((lead) => {
      lead.append(' And more.'.repeat(80));
    });
  await page.waitForTimeout(500);
  expect(await stillMoved(page)).toEqual([]);
});

test('says why an overview can’t be shown, offering each newer one', async ({ page, ref }) => {
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

test('nothing on the first screen moves from the first frame, as its figures fill in', async ({
  app,
  page,
  ref,
}) => {
  const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.`);
  ref.holds = {
    kind: 'made',
    overview: overviewOf({
      'artifact.md': textOf(
        [
          '## tl;dr\n\nThe figures come first.\n',
          ':::figure figures/bar.svg\nA bar, drawn.\n:::\n',
          'Under the drawing.\n',
          ':::figure figures/bar.png\nA bar, as a picture.\n:::\n',
          'Under the picture.\n',
          `## After\n\n${paragraphs.join('\n\n')}\n`,
        ].join('\n'),
      ),
      'figures/bar.svg': SVG,
      'figures/bar.png': pngOf(480, 64),
    }),
  };
  await sizeWindow(app, 1100, 800);
  await watchStill(page);
  await open(page);
  // It opens on the overview, with no input from the reader to take as theirs.
  const shown = overview(page, 'shown');
  await expect(shown).toBeVisible({ timeout: 20_000 });
  const figures = shown.locator('figure.lo-figure:not(.lo-figure--broken)');
  await expect(figures).toHaveCount(2);
  // Both figures, and a block under each, are on the first screen.
  const screen = await shown.locator('.lo-ov').boundingBox();
  const under = await shown.getByText('Under the picture.').boundingBox();
  expect((under?.y ?? 0) + (under?.height ?? 0)).toBeLessThan(
    (screen?.y ?? 0) + (screen?.height ?? 0),
  );
  // The picture is drawn: its canvas holds its pixels.
  await expect
    .poll(() => figures.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  await expect(figures.locator('svg')).toHaveCount(1);
  await page.waitForTimeout(1000);
  expect(await stillMoved(page)).toEqual([]);
});

/** The overview's code block on `path`'s `lines`, as its head writes them. */
const codeBlock = (page: Page, path: string, lines: string) =>
  overview(page, 'shown')
    .locator('.lo-codeblock')
    .filter({ has: page.locator('.lo-codeblock__path', { hasText: path }) })
    .filter({ has: page.locator('.lo-codeblock__lines', { hasText: lines }) });

/** The text of each of `block`'s lines of code that `kind` picks out, as drawn. */
const linesOf = (block: ReturnType<typeof codeBlock>, kind: string) =>
  block.locator(`[data-lo-code] .cm-line${kind}`).allTextContents();

/**
 * Watches, every frame from now, the overview's code blocks: how tall each is in the first frame it
 * lays out room for its code, before it's drawn; and how each on screen is in the first frame the
 * overview is seen. Each is named by its head: its path, then its lines.
 */
async function watchCode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rooms: Record<string, number> = {};
    window.loCodeRooms = rooms;
    window.loCodeSeen = undefined;
    const tick = () => {
      const article = document.querySelector('[data-lo-overview="shown"] .lo-ov__article');
      const scroller = article?.closest('.lo-ov');
      const screen = scroller?.getBoundingClientRect();
      const seen: Record<string, string> = {};
      for (const block of article?.querySelectorAll('.lo-codeblock') ?? []) {
        const head = block.querySelector('.lo-codeblock__head');
        const name = [
          head?.querySelector('.lo-codeblock__path')?.textContent,
          head?.querySelector('.lo-codeblock__lines')?.textContent,
        ].join(' ');
        const code = block.querySelector<HTMLElement>('[data-lo-code]')?.dataset.loCode;
        const { top, bottom, height } = block.getBoundingClientRect();
        if (code === 'waiting' && !(name in rooms)) rooms[name] = height;
        if (screen && bottom > screen.top && top < screen.bottom) seen[name] = code ?? 'none';
      }
      if (!window.loCodeSeen && article?.checkVisibility({ visibilityProperty: true })) {
        window.loCodeSeen = seen;
      }
      if (window.loCodeRooms === rooms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** What {@link watchCode} saw. */
const codeSeen = (page: Page) =>
  page.evaluate(() => ({ rooms: window.loCodeRooms ?? {}, seen: window.loCodeSeen }));

/** How tall each of the overview's code blocks is now, by its head. */
const codeHeights = (page: Page) =>
  overview(page, 'shown')
    .locator('.lo-codeblock')
    .evaluateAll((blocks) =>
      Object.fromEntries(
        blocks.map((block) => {
          const head = block.querySelector('.lo-codeblock__head');
          const name = [
            head?.querySelector('.lo-codeblock__path')?.textContent,
            head?.querySelector('.lo-codeblock__lines')?.textContent,
          ].join(' ');
          return [name, block.getBoundingClientRect().height];
        }),
      ),
    );

/** What each block cut short now starts with: none. */
const cutBlocks = (page: Page) =>
  overview(page, 'shown')
    .locator('.lo-held.is-cut')
    .evaluateAll((held) => held.map((each) => each.textContent?.slice(0, 60) ?? ''));

/**
 * The code blocks cut short that aren't wholly on screen with something on screen under them, the
 * one place a block is cut: none.
 */
const cutElsewhere = (page: Page) =>
  overview(page, 'shown')
    .locator('.lo-ov')
    .evaluate((scroller) => {
      const top = scroller.getBoundingClientRect().top;
      const bottom = top + scroller.clientHeight;
      return [...scroller.querySelectorAll('.lo-held.is-cut')].flatMap((block) => {
        const box = block.getBoundingClientRect();
        const there = box.top >= top - 0.5 && box.bottom < bottom - 0.5;
        return there ? [] : [`${block.textContent?.slice(0, 40)} at ${box.top} to ${box.bottom}`];
      });
    });

/** Closes tab `id`, and opens #80's again, with its local copy there; returns the new tab's id. */
async function openAgain(page: Page, id: string): Promise<string> {
  await page.evaluate((tab) => window.lo.invoke('tab.close', { id: tab }), id);
  await expect(views(page)).toHaveCount(0);
  return open(page);
}

for (const [width, height] of [
  [1440, 900],
  [1100, 800],
] as const) {
  test(`draws the code on its first screen before it's seen, with the local copy there, cutting none and moving nothing, at ${width}×${height}`, async ({
    app,
    page,
  }) => {
    test.setTimeout(90_000);
    await sizeWindow(app, width, height);
    // Opened once for its local copy.
    const first = await open(page);
    await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => current(page, first), { timeout: 30_000 })
      .toMatchObject({ code: 'ready' });

    await watchStill(page);
    await watchCode(page);
    await openAgain(page, first);
    const shown = overview(page, 'shown');
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(overviewTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await codeSeen(page)).seen).toBeDefined();
    // Every code block on the first screen was drawn before the overview was seen.
    const { seen } = await codeSeen(page);
    expect(Object.keys(seen ?? {})).toContain('src/parser.ts L7–10');
    for (const [name, code] of Object.entries(seen ?? {})) {
      expect(`${name}: ${code}`).toBe(`${name}: ${code === 'none' ? 'none' : 'drawn'}`);
    }
    await page.waitForTimeout(1500);
    expect(await stillMoved(page)).toEqual([]);
    expect(await cutBlocks(page)).toEqual([]);
  });
}

test('lays out each code block as tall as it draws before a jump reaches it, so the jump moves nothing', async ({
  app,
  page,
  ref,
}) => {
  test.setTimeout(90_000);
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) => `Paragraph ${index + 1} says what one part of the change does, at some length.`,
  );
  ref.holds = {
    kind: 'made',
    overview: overviewOf({
      'artifact.md': textOf(
        [
          '## tl;dr\n\nThe code is in [the details](#details).\n',
          `## How it works\n\n${paragraphs.join('\n\n')}\n`,
          '## Details\n',
          'The README, which the pull request doesn’t touch, starts:\n',
          ':::code README.md#L1-L2\n:::\n',
          'The module `wrap` has to itself:\n',
          ':::code src/text/wrap.ts#L3-L5\n:::\n',
          'How a line is written out, which it doesn’t change:\n',
          ':::code src/format.ts#L5-L8\n:::\n',
          `## After\n\n${paragraphs.join('\n\n')}\n`,
        ].join('\n'),
      ),
    }),
  };
  await sizeWindow(app, 1100, 800);
  // Opened once for its local copy.
  const first = await open(page);
  await expect(overviewTab(page).getByRole('img')).toHaveAccessibleName('Overview', {
    timeout: 20_000,
  });
  await expect
    .poll(() => current(page, first), { timeout: 30_000 })
    .toMatchObject({ code: 'ready' });

  await watchCode(page);
  await openAgain(page, first);
  const shown = overview(page, 'shown');
  await expect(shown).toBeVisible({ timeout: 20_000 });
  // Far from the screen, each block draws once for its height, and lets its code go.
  await expect(shown.locator('[data-lo-code="measured"]')).toHaveCount(3, { timeout: 20_000 });
  const { rooms } = await codeSeen(page);
  expect(Object.keys(rooms).toSorted()).toEqual([
    'README.md L1–2',
    'src/format.ts L5–8',
    'src/text/wrap.ts L3–5',
  ]);
  // Plain lines, and added ones, that fit their width are as tall as the room laid out for them in
  // the first frame; the lines that wrap took their height as they drew, off screen.
  const measured = await codeHeights(page);
  expect(measured['README.md L1–2']).toBe(rooms['README.md L1–2']);
  expect(measured['src/text/wrap.ts L3–5']).toBe(rooms['src/text/wrap.ts L3–5']);
  expect(measured['src/format.ts L5–8']).toBeGreaterThan(rooms['src/format.ts L5–8'] ?? 0);

  // The reader follows the link to the blocks: they draw where they are, as tall as they were.
  await watchStill(page);
  await shown.getByRole('link', { name: 'the details' }).click();
  await expect(shown.locator('[data-lo-code="drawn"]')).toHaveCount(3, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  expect(await stillMoved(page)).toEqual([]);
  expect(await cutBlocks(page)).toEqual([]);
  const screen = await shown.locator('.lo-ov').boundingBox();
  const heading = await shown.getByRole('heading', { name: 'Details' }).boundingBox();
  expect(Math.abs((heading?.y ?? 0) - (screen?.y ?? 0))).toBeLessThan(80);
  expect(await codeHeights(page)).toEqual(measured);
  // Plain lines of a file the pull request doesn't touch, a diff of one it adds, and lines of one
  // it changes that it left alone.
  const readme = codeBlock(page, 'README.md', 'L1–2');
  expect(await linesOf(readme, '')).toEqual(['# App fixture', '']);
  expect(await linesOf(readme, '.lo-line-add')).toEqual([]);
  const wrap = codeBlock(page, 'src/text/wrap.ts', 'L3–5');
  expect(await linesOf(wrap, '.lo-line-add')).toEqual([
    '  const lines: string[] = [];',
    "  let line = '';",
    "  for (const word of text.split(' ')) {",
  ]);
  expect(await linesOf(wrap, '.lo-line-del')).toEqual([]);
  const format = codeBlock(page, 'src/format.ts', 'L5–8');
  expect(await linesOf(format, '')).toHaveLength(4);
  expect(await linesOf(format, '.lo-line-add')).toEqual([]);
});

test('fills in its code from the local copy, at the commit it describes, as the pull request changed it', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  await sizeWindow(app, 1100, 800);
  await watchStill(page);
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
  await overviewTab(page).click();
  const shown = overview(page, 'shown');
  await expect(shown).toBeVisible();
  await expect.poll(() => current(page, id), { timeout: 30_000 }).toMatchObject({ code: 'ready' });

  // Lines the pull request changed, in the file it renamed: a diff from its old name, at the first
  // push, which the second changed again.
  const parser = codeBlock(page, 'src/parser.ts', 'L7–10');
  await expect(parser.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  expect(await linesOf(parser, '.lo-line-del')).toEqual([
    '/** Splits `input` into lines, on `\\n`. */',
    "  return input.split('\\n').map((text, index) => ({ number: index + 1, text }));",
  ]);
  expect(await linesOf(parser, '.lo-line-add')).toEqual([
    '/** Splits `input` into lines, on `\\n` or `\\r\\n`. */',
    '  return input.split(/\\r?\\n/).map((text, index) => ({ number: index + 1, text }));',
  ]);
  // Drawn as the local copy came, it moved nothing, and is cut short only where it's wholly on
  // screen with something under it.
  await page.waitForTimeout(1000);
  expect(await stillMoved(page)).toEqual([]);
  expect(await cutElsewhere(page)).toEqual([]);

  // Lines it changed, and lines it didn't, in a file it changed.
  const changed = codeBlock(page, 'src/format.ts', 'L1–3');
  await changed.scrollIntoViewIfNeeded();
  await expect(changed.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  expect(await linesOf(changed, '.lo-line-add')).toContain(
    "export { wrap } from './text/wrap.ts';",
  );
  const same = codeBlock(page, 'src/format.ts', 'L5–8');
  await expect(same.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  expect(await linesOf(same, '')).toEqual([
    '/** `lines` as text, each after its number. */',
    'export function format(lines: readonly Line[]): string {',
    "  return lines.map((line) => `${line.number}: ${line.text}`).join('\\n');",
    '}',
  ]);
  expect(await linesOf(same, '.lo-line-add')).toEqual([]);

  // A file it doesn't touch is plain lines, as the first push had it: the base branch changed it
  // after, which isn't the pull request's.
  const readme = codeBlock(page, 'README.md', 'L1–4');
  await readme.scrollIntoViewIfNeeded();
  await expect(readme.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  expect(await linesOf(readme, '')).toEqual([
    '# App fixture',
    '',
    "What Lo's end-to-end tests open: a pull request with a rename, a move, a lockfile, a large file, a",
    'binary and a deletion, pushed twice across a rebase.',
  ]);
  expect(await linesOf(readme, '.lo-line-del')).toEqual([]);

  // A file that isn't there offers to find one of its name.
  const cache = codeBlock(page, 'src/cache.ts', 'L1–4');
  await cache.scrollIntoViewIfNeeded();
  await expect(cache).toHaveClass(/lo-codeblock--unresolved/);
  await expect(cache).toContainText('This reference doesn’t resolve.');
  await cache.getByRole('button', { name: /Find a file named cache\.ts/ }).click();
  const finder = page.getByRole('dialog', { name: 'Go to a file' });
  await expect(finder).toBeVisible();
  await expect(finder.getByRole('combobox', { name: 'Go to a file' })).toHaveValue('cache.ts');
  await page.keyboard.press('Escape');
  await expect(finder).toHaveCount(0);

  // A plain fence is an illustration, never code from the pull request.
  const illustration = shown.locator('.lo-codeblock--illustration');
  await illustration.scrollIntoViewIfNeeded();
  await expect(illustration).toContainText('Illustration · not code from this PR');
  await expect(illustration.locator('pre')).toContainText("format(parse('first\\r\\nsecond'));");
  await expect(illustration.locator('.cm-gutters')).toHaveCount(0);

  // The walkthrough shows each step's file whole, its lines marked near the top of its box, which
  // scrolls alone.
  const walk = shown.locator('.lo-walk');
  await walk.scrollIntoViewIfNeeded();
  const view = walk.locator('.lo-walk__view');
  await expect(view.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  const marked = view.locator('.cm-line.lo-line-marked');
  const scroller = shown.locator('.lo-ov');
  const scrolled = () => scroller.evaluate((element) => element.scrollTop);
  /** Whether every marked line is inside the box, and how far the box has scrolled itself. */
  const showing = () =>
    view.evaluate((box) => {
      const { top, bottom } = box.getBoundingClientRect();
      const lines = [...box.querySelectorAll('.cm-line.lo-line-marked')].map((line) =>
        line.getBoundingClientRect(),
      );
      const inside =
        lines.length > 0 && lines.every((line) => line.top >= top && line.bottom <= bottom);
      return { inside, scrolled: box.querySelector('.lo-fileview')?.scrollTop ?? 0 };
    });
  await expect(marked).toHaveText([
    'export function parse(input: string): Line[] {',
    '  return input.split(/\\r?\\n/).map((text, index) => ({ number: index + 1, text }));',
    '}',
  ]);
  const at = await scrolled();
  await walk.getByRole('button', { name: 'Next' }).click();
  await expect(walk.locator('.lo-walk__codehead')).toContainText('L13–15');
  await expect(marked).toHaveText([
    'export function filled(input: string): Line[] {',
    "  return parse(input).filter((line) => line.text.trim() !== '');",
    '}',
  ]);
  await expect.poll(showing).toEqual({ inside: true, scrolled: expect.any(Number) });
  expect((await showing()).scrolled).toBeGreaterThan(0);
  await walk.getByRole('button', { name: 'Next' }).click();
  await expect(walk.locator('.lo-walk__codehead')).toContainText('src/format.ts');
  await expect(marked).toHaveText([
    'export function format(lines: readonly Line[]): string {',
    "  return lines.map((line) => `${line.number}: ${line.text}`).join('\\n');",
    '}',
  ]);
  expect(await scrolled()).toBe(at);
  expect(refused).toEqual([]);
});

test.describe('while the local copy comes late', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  /**
   * Where the reader reads: a part of the way down, or just under the first code block, so it fills
   * in above them.
   */
  const places: { name: string; at: (page: Page) => Promise<number> }[] = [
    { name: 'at the top', at: () => Promise.resolve(0) },
    { name: 'halfway down', at: () => Promise.resolve(0.5) },
    {
      name: 'just under a code block',
      at: (page) =>
        overview(page, 'shown')
          .locator('.lo-ov')
          .evaluate((scroller) => {
            const block = scroller.querySelector('.lo-codeblock');
            const bottom = block?.getBoundingClientRect().bottom ?? 0;
            const under = bottom - scroller.getBoundingClientRect().top + scroller.scrollTop + 80;
            return under / (scroller.scrollHeight - scroller.clientHeight);
          }),
    },
    {
      name: 'at the block that offers to find a file',
      at: (page) =>
        overview(page, 'shown')
          .locator('.lo-ov')
          .evaluate((scroller) => {
            const block = [...scroller.querySelectorAll('.lo-codeblock')].find((each) =>
              each.textContent?.includes('src/cache.ts'),
            );
            const top = block?.getBoundingClientRect().top ?? 0;
            const above = top - scroller.getBoundingClientRect().top + scroller.scrollTop - 40;
            return above / (scroller.scrollHeight - scroller.clientHeight);
          }),
    },
  ];

  for (const place of places) {
    test(`nothing on screen moves from the first frame, as figures and code fill in, the banner goes and the overview is checked again, ${place.name}`, async ({
      app,
      page,
    }) => {
      test.setTimeout(90_000);
      await sizeWindow(app, 1100, 440);
      await watchStill(page);
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

      // The reader opens the fold, which keeps focus, and wheels to where they read.
      const fold = shown.locator('details').first();
      await fold.locator('summary').click();
      await expect(fold).toHaveAttribute('open', '');
      await wheelTo(page, await place.at(page));
      await page.evaluate(() => {
        const summary = document.querySelector<HTMLElement>('[data-lo-overview="shown"] summary');
        summary?.setAttribute('data-focused', String(document.activeElement === summary));
      });
      await expect(fold.locator('summary')).toHaveAttribute('data-focused', 'true');

      // The banner goes, the local copy comes, and the overview is checked again with its code.
      writeAppRemote(test.info().outputPath('remote'));
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
      await expect(page.locator('[data-lo-banners]')).toHaveCount(0, { timeout: 30_000 });
      await expect
        .poll(() => current(page, id), { timeout: 30_000 })
        .toMatchObject({ code: 'ready' });
      // The code blocks near the screen fill in: the first, on the first screen, or above it.
      const drawn = shown.locator('[data-lo-code="drawn"]');
      await expect(drawn.first()).toBeAttached({ timeout: 20_000 });
      const first = codeBlock(page, 'src/parser.ts', 'L7–10');
      if (place.name === 'at the top' || place.name === 'just under a code block') {
        await expect(first.locator('[data-lo-code="drawn"]')).toBeAttached();
      }
      if (place.name === 'just under a code block') {
        const [block, screen] = await Promise.all([
          first.boundingBox(),
          shown.locator('.lo-ov').boundingBox(),
        ]);
        expect((block?.y ?? 0) + (block?.height ?? 0)).toBeLessThan(screen?.y ?? 0);
      }
      await page.waitForTimeout(2500);

      expect(await stillMoved(page)).toEqual([]);
      await expect(fold).toHaveAttribute('open', '');
      expect(
        await page.evaluate(
          () =>
            document.activeElement === document.querySelector('[data-lo-overview="shown"] summary'),
        ),
      ).toBe(true);
      // A block is cut short only wholly on screen with something under it, its code above a row
      // of its own: what the reader can do about a block is in its head, never under that row.
      expect(await cutElsewhere(page)).toEqual([]);
      await codeBlock(page, 'src/cache.ts', 'L1–4')
        .getByRole('button', { name: /Find a file named cache\.ts/ })
        .click();
      const finder = page.getByRole('dialog', { name: 'Go to a file' });
      await expect(finder.getByRole('combobox', { name: 'Go to a file' })).toHaveValue('cache.ts');
    });
  }
});

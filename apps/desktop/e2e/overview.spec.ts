// A pull request's overview in the app: Lo, started on the replay server as rozed-bot, reads
// rozed-dev/e2e#80's from GitHub's REST API as its tab opens, as `testing/fixtures/app.sh` wrote
// it, with who wrote it and when; gives the window its files and the code it names, from the local
// copy, for the background process to check it; and shows it at once from what it kept the next
// time, with GitHub out of reach.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CheckedArtifact } from '@lo/artifact';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type Page } from '@playwright/test';

import type { CodeReply, OverviewFile, OverviewState } from '../src/features/overview/contract.ts';
import type { CheckInput, Parsed } from '../src/features/overview/jobs.ts';
import { appEnvironment, appFolder, dataFolder, expect, KEYCHAIN, test as base } from './app.ts';
import { catchPorts } from './ports.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{ github: ReplayServer; remote: string; tokenFile: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    // Closed once, by the test that takes GitHub away or after it.
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= server.close());
    await use({ ...server, close });
    await close();
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
async function open(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(() =>
    window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 }),
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** What main has of a tab's overview, as the window asks it. */
async function current(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('overview.current', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

/**
 * Files of the overview on screen, as the window gets them, each as its text, or what main said
 * of it.
 */
async function files(page: Page, id: string, paths: string[]): Promise<unknown[]> {
  return page.evaluate(
    async ({ tab, commit, asked }) => {
      const reply = await window.lo.invoke('overview.files', { id: tab, commit, paths: asked });
      if (!reply.ok || !Array.isArray(reply.value)) return [reply];
      return reply.value.map((file: { kind: string; bytes?: unknown }) =>
        file.kind === 'file' && file.bytes instanceof Uint8Array
          ? new TextDecoder().decode(file.bytes)
          : file,
      );
    },
    { tab: id, commit: APP_PULL.overview, asked: paths },
  );
}

/** The overview's files as `testing/fixtures/app.sh` wrote them, beside the remote it made. */
function written(remote: string, path: string): string {
  return readFileSync(join(fileURLToPath(remote), 'overview', path), 'utf8');
}

/** What the tab says of #80's overview once it's read. */
const READ = {
  ref: 'refs/lo/pr/80',
  watching: true,
  found: 'commit',
  overview: {
    id: APP_PULL.overview,
    source: 'base',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    byline: { login: 'rozed-bot', name: 'rozed-bot', at: Date.parse('2026-11-11T09:30:00Z') },
    truncated: false,
    read: true,
  },
  newer: null,
};

test("reads a pull request's overview as its tab opens, and gives the window its files", async ({
  page,
  github,
  remote,
}) => {
  const id = await open(page);
  await expect
    .poll(() => current(page, id), { timeout: 20_000 })
    .toMatchObject({ ...READ, saved: false, problem: null });
  expect(await current(page, id)).toMatchObject({
    overview: {
      entries: [
        { path: 'artifact.md', kind: 'file' },
        { path: 'figures', kind: 'folder' },
        { path: 'figures/flow.svg', kind: 'file' },
      ],
    },
  });

  expect(await files(page, id, ['artifact.md', 'figures/flow.svg', 'README.md'])).toEqual([
    written(remote, 'artifact.md'),
    written(remote, 'figures/flow.svg'),
    // Nothing but artifact.md and figures is ever read.
    { kind: 'refused' },
  ]);
  // Another commit's files aren't given.
  const other = await page.evaluate(
    (tab) =>
      window.lo.invoke('overview.files', {
        id: tab,
        commit: '0'.repeat(40),
        paths: ['artifact.md'],
      }),
    id,
  );
  expect(other).toMatchObject({ ok: false, error: { code: 'moved' } });

  // What Lo asked GitHub for the overview: the ref, its commit, the commit's tree, and each file
  // once, raw, the figure only once asked for.
  const asked = github.replay.seen
    .map(({ url, headers }) => [new URL(url).pathname, headers.get('accept')])
    .filter(([path]) =>
      ['/git/matching-refs/', '/commits/', '/git/trees/3691c0b1', '/git/blobs/'].some((part) =>
        path?.includes(part),
      ),
    );
  expect(asked.filter(([path]) => !path?.includes('matching-refs'))).toEqual([
    [`/repos/rozed-dev/e2e/commits/${APP_PULL.overview}`, 'application/vnd.github+json'],
    [
      '/repos/rozed-dev/e2e/git/trees/3691c0b1986fa31d3bca412d2f4d6c1d3379edde',
      'application/vnd.github+json',
    ],
    [
      '/repos/rozed-dev/e2e/git/blobs/a481067b4846c72fa4b637d20e40108b20985b66',
      'application/vnd.github.raw+json',
    ],
    [
      '/repos/rozed-dev/e2e/git/blobs/9e34eac2018965ce2375440252619e90d6b45b33',
      'application/vnd.github.raw+json',
    ],
  ]);
  expect(asked[0]).toEqual(['/repos/rozed-dev/e2e/git/matching-refs/lo/pr/80', expect.anything()]);
});

/** What main replies on the channels the overview's check asks it on. */
interface Replies {
  'overview.files': OverviewFile[];
  'overview.code': CodeReply;
  'overview.current': OverviewState;
}

/** What the overview's jobs reply. */
interface Jobs {
  'overview.parse': Parsed;
  'overview.check': CheckedArtifact;
}

/**
 * The overview on screen, checked as the window checks it, in the background process: its text
 * and figures from main, read by `overview.parse`, the code it names from the local copy, at the
 * commit its header names, and all of it checked by `overview.check`.
 */
async function checkShown(page: Page, id: string) {
  return page.evaluate(
    async ({ tab, commit, pr }) => {
      const ports = window.backgroundPorts;
      if (!ports) throw new Error('No port to the background process');
      let jobs = 0;
      // Main, about the tab.
      const ask = async <C extends keyof Replies>(channel: C, input: object = {}) => {
        const reply = await window.lo.invoke(channel, { id: tab, ...input });
        if (!reply.ok) throw new Error(`${channel}: ${JSON.stringify(reply)}`);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
        return reply.value as Replies[C];
      };
      const run = async <J extends keyof Jobs>(job: J, input: unknown) => {
        jobs += 1;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
        const reply = (await ports.run(0, { id: jobs, job, input }, 30_000)) as {
          ok: boolean;
          value: Jobs[J];
        };
        if (!reply.ok) throw new Error(`${job}: ${JSON.stringify(reply)}`);
        return reply.value;
      };

      const [text] = await ask('overview.files', { commit, paths: ['artifact.md'] });
      if (text?.kind !== 'file' || !text.bytes) throw new Error('artifact.md went unread');
      const parsed = await run('overview.parse', { artifact: text.bytes });
      const at = parsed.parsed.header?.commit;
      if (at === undefined) throw new Error('The overview has no header');
      const figures = await ask('overview.files', { commit, paths: parsed.figures });
      const code = await ask('overview.code', { commit: at, files: parsed.code });
      if (code.kind !== 'read') return { code };
      const state = await ask('overview.current');
      const input: CheckInput = {
        artifact: text.bytes,
        entries: state.overview?.entries ?? [],
        pr,
        figures: parsed.figures.map((path, index) => ({
          path,
          file: figures[index] ?? { kind: 'missing' },
        })),
        code: {
          commit: at,
          files: parsed.code.map(({ path }, index) => ({
            path,
            answer: code.files[index] ?? { kind: 'missing' },
          })),
        },
      };
      const checked = await run('overview.check', input);
      return {
        code: { kind: code.kind, files: code.files.map(({ kind }) => kind) },
        checked: {
          outcome: checked.outcome.kind,
          findings: checked.findings.map(({ code: finding }) => finding),
          code:
            checked.outcome.kind === 'shown'
              ? checked.outcome.code.map(({ code: shown }) => shown)
              : [],
          figures:
            checked.outcome.kind === 'shown'
              ? checked.outcome.figures.map(({ figure }) => figure.state)
              : [],
        },
      };
    },
    { tab: id, commit: APP_PULL.overview, pr: APP_PULL.number },
  );
}

test('checks the overview in the background process, against the code the local copy fetches', async ({
  app,
  page,
}) => {
  test.setTimeout(60_000);
  await catchPorts(app, page);
  const id = await open(page);
  // Main reads the code once the pull request's local copy is there.
  await expect
    .poll(() => current(page, id), { timeout: 30_000 })
    .toMatchObject({ ...READ, code: 'ready' });

  // The overview names the code of the first push, which the second force-pushed over, so the
  // local copy, fetched at the head, fetches that commit by its ID. Each file is read once, and
  // the cache that never landed isn't there.
  const resolved = { state: 'resolved' };
  expect(await checkShown(page, id)).toEqual({
    code: { kind: 'read', files: ['file', 'file', 'file', 'file', 'missing'] },
    checked: {
      outcome: 'shown',
      findings: ['code-missing'],
      code: [...Array.from({ length: 11 }, () => resolved), { state: 'broken', why: 'missing' }],
      figures: ['kept'],
    },
  });
});

test('shows the overview it kept at once the next time, with GitHub out of reach', async ({
  app,
  page,
  github,
  remote,
}) => {
  test.setTimeout(90_000);
  const id = await open(page);
  await expect.poll(() => current(page, id), { timeout: 20_000 }).toMatchObject(READ);
  await app.close();
  // GitHub goes away, at the same address.
  await github.close();

  const again = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_GIT_REMOTE: remote,
    },
    chromiumSandbox: true,
  });
  try {
    const shown = await again.firstWindow();
    await shown.waitForLoadState('load');
    await expect
      .poll(() => current(shown, id), { timeout: 20_000 })
      .toMatchObject({ ...READ, found: 'unknown', saved: true });
    await expect
      .poll(() => current(shown, id), { timeout: 20_000 })
      .toMatchObject({ problem: { kind: 'offline' } });
    // Its text comes from what Lo kept.
    expect(await files(shown, id, ['artifact.md'])).toEqual([written(remote, 'artifact.md')]);
  } finally {
    await again.close();
  }
});

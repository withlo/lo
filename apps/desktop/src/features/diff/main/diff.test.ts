import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseOid, type Repo } from '@lo/git';
import { GithubClient, Token } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { APP_PULL, gitProgram, RepoServer, writeAppRemote } from '@lo/testing/git';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createGit } from '../../../main/git.ts';
import type { Comparing, Side, Since } from '../../revisions/service.ts';
import type { LocalState } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { DiffState, FileVersions } from '../contract.ts';
import { DiffTab, type DiffReads } from './diff.ts';

function folder(prefix = 'lo-diff-'): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

let remote: string | undefined;

/** rozed-dev/e2e's clone in a new cache, with #80 fetched into it. */
async function e2eClone(): Promise<Repo> {
  remote ??= writeAppRemote(realpathSync(mkdtempSync(join(tmpdir(), 'lo-diff-remote-'))));
  return cloneOf(remote, {
    number: APP_PULL.number,
    head: APP_PULL.head,
    baseBranch: 'app/base',
    base: APP_PULL.base,
  });
}

/** A clone of rozed-dev/e2e from `from`, in a new cache, with pull request `pull` fetched into it. */
async function cloneOf(
  from: string,
  pull: { number: number; head: string; baseBranch: string; base: string },
): Promise<Repo> {
  const git = createGit({
    settings: { program: gitProgram(), test: { remote: from } },
    root: join(folder(), 'cache'),
    env: process.env,
    platform: process.platform,
    log: () => undefined,
    cleanUp: () => Promise.resolve(),
  });
  onTestFinished(() => git.stop());
  await git.check();
  const cache = git.cache;
  if (!cache) throw new Error('the cache is closed');
  const repo = await cache.open('rozed-dev', 'e2e', {});
  onTestFinished(() => repo.close());
  await repo.fetchPull({
    number: pull.number,
    head: parseOid(pull.head),
    baseBranch: pull.baseBranch,
    base: parseOid(pull.base),
  });
  return repo;
}

/** A client answered from the app's cassette. */
function replayClient(): GithubClient {
  return new GithubClient({
    fetch: replayFetch('app_e2e'),
    urls: {
      api: 'https://api.github.com',
      web: 'https://github.com',
      uploads: 'https://uploads.github.com',
    },
    token: new Token('gho_FAKE'),
  });
}

const READY: LocalState = {
  kind: 'ready',
  head: APP_PULL.head,
  base: APP_PULL.base,
  mergeBase: APP_PULL.base,
  offline: false,
};

/** rozed-dev/e2e#80's tab, shown at its head. */
function e2eInfo(
  local: LocalState = { kind: 'fetching', progress: null, attempt: 1 },
): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: APP_PULL.number,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: APP_PULL.head,
    latest: APP_PULL.head,
    provisional: false,
    local,
    compareFrom: undefined,
    drawn: false,
  };
}

/** A tab's diff reading with `reads`, with what it sends collected. */
function diffTab(reads: Partial<DiffReads>) {
  const sent: DiffState[] = [];
  const drawn: string[] = [];
  const diff = new DiffTab({
    id: 't1',
    reads: {
      clone: reads.clone ?? (() => undefined),
      github:
        reads.github ?? (() => Promise.reject(new Error('this test reads nothing from GitHub'))),
    },
    publish: (state) => sent.push(state),
    drawn: (head) => drawn.push(head),
    log: () => undefined,
  });
  onTestFinished(() => diff.close());
  const settled = async (ready: (state: DiffState) => boolean): Promise<DiffState> => {
    await expect
      .poll(() => sent.at(-1) !== undefined && ready(sent.at(-1)!), { timeout: 20_000 })
      .toBe(true);
    return sent.at(-1)!;
  };
  return { diff, sent, drawn, settled };
}

/** A file of the list by its path, with its place. */
function find(state: DiffState, path: string): { place: number; file: FileVersions } {
  const place = state.files?.findIndex((file) => file.path.text === path) ?? -1;
  const file = state.files?.[place];
  if (!file) throw new Error(`${path} isn't in the diff`);
  return { place, file };
}

describe('a pull request’s diff', { timeout: 60_000 }, () => {
  it('reads each file’s versions from the local copy, and how each starts out', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    const state = await settled((each) => each.from === 'local');

    expect(state).toMatchObject({ at: APP_PULL.head, partial: false, problem: null });
    const starts = Object.fromEntries(
      (state.files ?? []).map((file) => [file.path.text, file.start]),
    );
    expect(starts).toEqual({
      'assets/mark.png': 'binary',
      'data/numbers.txt': 'large',
      'pnpm-lock.yaml': 'collapsed',
      'src/format.ts': 'shown',
      'src/legacy.ts': 'shown',
      'src/parser.ts': 'shown',
      'src/text/wrap.ts': 'shown',
    });
    const parser = find(state, 'src/parser.ts').file;
    expect(parser).toMatchObject({ change: 'renamed', previous: { text: 'src/parse.ts' } });
    expect(parser.old?.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(find(state, 'pnpm-lock.yaml').file.generated).toBe('lockfile');
    expect(find(state, 'data/numbers.txt').file.large).toContain('5001 lines added');
    // A binary file's two sizes, for its header.
    const mark = find(state, 'assets/mark.png').file;
    expect(mark.old?.size).toBeGreaterThan(0);
    expect(mark.new?.size).toBeGreaterThan(0);
    expect(find(state, 'src/legacy.ts').file.new).toBe(null);
  });

  it('gives files’ texts by their places, the head and the source they’re of', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    const state = await settled((each) => each.from === 'local');
    const parser = find(state, 'src/parser.ts');
    const legacy = find(state, 'src/legacy.ts');

    const [renamed, deleted] = await diff.texts(APP_PULL.head, null, null, null, 'local', [
      parser.place,
      legacy.place,
    ]);
    expect(renamed).toMatchObject({ kind: 'texts' });
    if (renamed?.kind !== 'texts') throw new Error('no texts');
    expect(renamed.old).toContain("input.split('\\n')");
    expect(renamed.new).toContain('Empty input has no lines.');
    expect(deleted).toMatchObject({ kind: 'texts', new: null });

    await expect(
      diff.texts(APP_PULL.firstHead, null, null, null, 'local', [parser.place]),
    ).rejects.toMatchObject({
      code: 'moved',
    });
    await expect(
      diff.texts(APP_PULL.head, null, null, null, 'github', [parser.place]),
    ).rejects.toMatchObject({
      code: 'moved',
    });
    await expect(diff.texts(APP_PULL.head, null, null, null, 'local', [999])).rejects.toMatchObject(
      {
        code: 'invalid',
      },
    );
  });

  it('refuses a file with a line over a mebibyte, which is as slow to lay out as it is large', async () => {
    const repo = await e2eClone();
    const minified = Buffer.alloc(1024 * 1024 + 1, 'x');
    const reading = new Proxy(repo, {
      get(target, property) {
        if (property === 'readBlob') return () => Promise.resolve(minified);
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(reading) });
    diff.update(e2eInfo(READY));
    const state = await settled((each) => each.from === 'local');

    const [text] = await diff.texts(APP_PULL.head, null, null, null, 'local', [
      find(state, 'src/parser.ts').place,
    ]);
    expect(text).toEqual({ kind: 'missing', why: expect.stringContaining('a line over 1 MiB') });
  });

  it('reads GitHub’s files and patches until the local copy is ready, which then replaces them', async () => {
    const client = replayClient();
    const repo = await e2eClone();
    const { diff, settled } = diffTab({
      github: (_acting, request) => request(client),
      clone: () => Promise.resolve(repo),
    });
    diff.update(e2eInfo());
    const github = await settled((each) => each.from === 'github');

    const starts = Object.fromEntries(
      (github.files ?? []).map((file) => [file.path.text, file.start]),
    );
    expect(starts).toMatchObject({
      'assets/mark.png': 'binary',
      // GitHub gives no patch of it: it waits for the local copy.
      'data/numbers.txt': 'large',
      'pnpm-lock.yaml': 'collapsed',
      'src/parser.ts': 'shown',
    });
    const parser = find(github, 'src/parser.ts');
    expect(parser.file.old).toBe(null);
    const [patch] = await diff.texts(APP_PULL.head, null, null, null, 'github', [parser.place]);
    expect(patch).toMatchObject({
      kind: 'patch',
      patch: expect.stringContaining('@@ -4,9 +4,10 @@'),
    });
    const numbers = find(github, 'data/numbers.txt');
    expect(await diff.texts(APP_PULL.head, null, null, null, 'github', [numbers.place])).toEqual([
      { kind: 'missing', why: expect.any(String) },
    ]);

    diff.update(e2eInfo(READY));
    const local = await settled((each) => each.from === 'local');
    expect(local.files).toHaveLength(github.files?.length ?? 0);
    await expect(
      diff.texts(APP_PULL.head, null, null, null, 'github', [parser.place]),
    ).rejects.toMatchObject({
      code: 'moved',
    });
  });

  it('never takes GitHub’s list of another head’s files', async () => {
    const client = replayClient();
    const { diff, sent } = diffTab({ github: (_acting, request) => request(client) });
    diff.update({ ...e2eInfo(), shown: APP_PULL.firstHead });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(sent.every((state) => state.files === null)).toBe(true);
  });

  it('waits for GitHub to say the head on screen is its own before asking it', async () => {
    let asked = 0;
    const { diff, sent } = diffTab({
      github: () => {
        asked += 1;
        return Promise.reject(new Error('not asked'));
      },
    });
    diff.update({ ...e2eInfo(), provisional: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(asked).toBe(0);
    expect(sent.at(-1)).toMatchObject({ at: APP_PULL.head, files: null });
  });

  it('passes on that the window drew the diff at the head on screen, and only then', () => {
    const { diff, drawn } = diffTab({});
    diff.update(e2eInfo());
    diff.drawn(APP_PULL.firstHead, null);
    diff.drawn(APP_PULL.head, null);

    expect(drawn).toEqual([APP_PULL.head]);
  });
});

/** A comparison of `old` with `now` in `repo`, as the revisions feature makes one. */
function comparing(repo: Repo, old: Side, now: Side): Comparing {
  let made: ReturnType<Comparing['compared']> | undefined;
  return {
    key: `${old.base}:${old.head}..${now.base}:${now.head}`,
    old,
    new: now,
    compared: () => (made ??= repo.compareRevisions(old, now)),
  };
}

const side = (head: string, base: string): Side => ({ head: parseOid(head), base: parseOid(base) });

describe('a comparison of revisions', { timeout: 60_000 }, () => {
  it('between revisions across a rebase shows only the author’s change', async () => {
    const repo = await e2eClone();
    await repo.fetchCommits(APP_PULL.number, [parseOid(APP_PULL.firstHead)]);
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    const between = comparing(
      repo,
      side(APP_PULL.firstHead, APP_PULL.firstBase),
      side(APP_PULL.head, APP_PULL.base),
    );
    diff.update(e2eInfo(READY), { kind: 'revisions', comparing: between });
    const state = await settled((each) => each.files !== null);
    expect(state).toMatchObject({ at: APP_PULL.head, comparison: between.key, from: 'local' });
    // The README the base changed, and all the first push had, stay out.
    expect(state.files?.map((file) => [file.path.text, file.change, file.conflicted])).toEqual([
      ['src/parser.ts', 'modified', false],
    ]);
    // Its texts are the comparison's, asked for by its key.
    const [text] = await diff.texts(APP_PULL.head, between.key, null, null, 'local', [0]);
    expect(text).toMatchObject({
      kind: 'texts',
      new: expect.stringContaining("if (input === '')"),
    });
    await expect(diff.texts(APP_PULL.head, null, null, null, 'local', [0])).rejects.toMatchObject({
      code: 'moved',
    });
  });

  it('revisions on one base compare their heads', async () => {
    const repo = await e2eClone();
    await repo.fetchCommits(APP_PULL.number, [parseOid(APP_PULL.firstHead)]);
    const [renamed] = await repo.parents(parseOid(APP_PULL.firstHead));
    if (!renamed) throw new Error('the first push has no parent');
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    // The first push's first commit, then its second, both on the base's first commit.
    diff.update(e2eInfo(READY), {
      kind: 'revisions',
      comparing: comparing(
        repo,
        side(renamed, APP_PULL.firstBase),
        side(APP_PULL.firstHead, APP_PULL.firstBase),
      ),
    });
    const state = await settled((each) => each.files !== null);
    expect(state.files?.map((file) => file.path.text).toSorted()).toEqual([
      'assets/mark.png',
      'data/numbers.txt',
      'pnpm-lock.yaml',
    ]);
  });

  it('a conflicted rebase lists every file it conflicted on', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    const changed = await repo.compareRevisions(
      side(APP_PULL.base, APP_PULL.base),
      side(APP_PULL.head, APP_PULL.base),
    );
    if ('refused' in changed) throw new Error('refused');
    const parser = changed.files.find((file) => file.path.toString() === 'src/parser.ts');
    if (!parser?.change) throw new Error('src/parser.ts is in the pull request');
    // As a replay that conflicted on two files would say: one the author changed, and one they
    // left as it was on their side.
    const conflicted: Comparing = {
      key: 'conflicted',
      old: side(APP_PULL.firstHead, APP_PULL.firstBase),
      new: side(APP_PULL.head, APP_PULL.base),
      compared: () =>
        Promise.resolve({
          ...changed,
          files: [
            { ...parser, resolution: [] },
            { path: Buffer.from('README.md'), resolution: [] },
          ],
          replay: { kind: 'conflicted', tree: parseOid(APP_PULL.base), retargeted: false },
        }),
    };
    diff.update(e2eInfo(READY), { kind: 'revisions', comparing: conflicted });
    const state = await settled((each) => each.files !== null);
    expect(state.files?.map((file) => [file.path.text, file.start, file.conflicted])).toEqual([
      ['src/parser.ts', 'shown', true],
      ['README.md', 'unchanged', true],
    ]);
  });

  it('showing other revisions leaves the load alone', async () => {
    const repo = await e2eClone();
    const { diff, sent, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    await settled((each) => each.from === 'local');
    // While the revisions feature makes another comparison ready, it keeps saying the one on
    // screen, and the diff stays as it is.
    const before = sent.length;
    diff.update(e2eInfo(READY), { kind: 'head' });
    expect(sent).toHaveLength(before);
    // Waiting, nothing is drawn.
    diff.update(e2eInfo(READY), { kind: 'waiting', why: 'Comparing r1 with r2…' });
    expect(sent.at(-1)).toMatchObject({ at: null, files: null, waiting: 'Comparing r1 with r2…' });
  });

  it('a comparison is made in the background', async () => {
    const repo = await e2eClone();
    await repo.fetchCommits(APP_PULL.number, [parseOid(APP_PULL.firstHead)]);
    const between = comparing(
      repo,
      side(APP_PULL.firstHead, APP_PULL.firstBase),
      side(APP_PULL.head, APP_PULL.base),
    );
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    // Updating returns at once: nothing waits on git.
    const started = performance.now();
    diff.update(e2eInfo(READY), { kind: 'revisions', comparing: between });
    expect(performance.now() - started).toBeLessThan(50);
    await settled((each) => each.files !== null);
    // Made once, whoever else shows it.
    expect(between.compared()).toBe(between.compared());
  });
});

/** A path as the window names it. */
const at = (text: string) => ({ text });

/**
 * `repo`, with its file at any path `size` bytes long, and its blobs `contents`: for files too
 * large to put in the fixture.
 */
function sized(repo: Repo, size: number, contents: Buffer): Repo {
  return new Proxy(repo, {
    get(target, property) {
      if (property === 'readBlob') return () => Promise.resolve(contents);
      if (property === 'fileVersion') {
        return async (rev: Parameters<Repo['fileVersion']>[0], path: Uint8Array) => {
          const found = await target.fileVersion(rev, path);
          return found && { ...found, size };
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('a whole file', { timeout: 60_000 }, () => {
  it('is any file of the head on screen, or the base’s version of a file the pull request changes', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    await settled((each) => each.from === 'local');

    // A file the pull request leaves alone, and one it renames, as they are in the head.
    expect(await diff.whole(APP_PULL.head, 'new', at('README.md'), false)).toEqual({
      kind: 'text',
      text: expect.stringContaining('# App fixture'),
    });
    expect(await diff.whole(APP_PULL.head, 'new', at('src/parser.ts'), false)).toEqual({
      kind: 'text',
      text: expect.stringContaining('Empty input has no lines.'),
    });
    // The renamed file as it was in the base, by its old path, and a deleted one.
    expect(await diff.whole(APP_PULL.head, 'old', at('src/parse.ts'), false)).toEqual({
      kind: 'text',
      text: expect.stringContaining("input.split('\\n')"),
    });
    expect(await diff.whole(APP_PULL.head, 'old', at('src/legacy.ts'), false)).toEqual({
      kind: 'text',
      text: expect.stringContaining('export { format as render }'),
    });
  });

  it('is read only at the head on screen, and in the base only where the pull request changes a file', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    await settled((each) => each.from === 'local');

    await expect(
      diff.whole(APP_PULL.firstHead, 'new', at('README.md'), false),
    ).rejects.toMatchObject({ code: 'moved' });
    // The base's README.md is no file the comparison changes, nor is the renamed file's new path.
    for (const path of ['README.md', 'src/parser.ts']) {
      await expect(diff.whole(APP_PULL.head, 'old', at(path), false)).rejects.toMatchObject({
        code: 'invalid',
      });
    }
    // Nothing at a path, or a folder there.
    for (const path of ['src/nothing.ts', 'src', '../README.md']) {
      await expect(diff.whole(APP_PULL.head, 'new', at(path), false)).rejects.toMatchObject({
        code: 'invalid',
      });
    }
  });

  it('waits for the local copy to have the head on screen', async () => {
    const repo = await e2eClone();
    const { diff } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo());
    expect(await diff.whole(APP_PULL.head, 'new', at('README.md'), false)).toEqual({
      kind: 'waiting',
    });
    diff.update(e2eInfo({ ...READY, head: APP_PULL.firstHead }));
    expect(await diff.whole(APP_PULL.head, 'new', at('README.md'), false)).toEqual({
      kind: 'waiting',
    });
  });

  it('reads a file the pull request leaves alone by its bytes, however long its path', async () => {
    const server = new RepoServer();
    onTestFinished(() => server.remove());
    const origin = server.repo('rozed-dev', 'e2e');
    // Paths a disk can't hold, which go straight into the index: over a kilobyte, and 20 KB, in
    // folders of 100 bytes, so they're no deeper than git allows.
    const paths = [1_229, 20_480].map((bytes) => {
      const folders = Math.floor((bytes - 24) / 100);
      const name = 'a'.repeat(bytes - 4 - folders * 100 - 3);
      return Buffer.from(`src/${`${'d'.repeat(99)}/`.repeat(folders)}${name}.ts`);
    });
    const files = paths.map((path, index): [Buffer, string] => [path, `alone ${index}\n`]);
    origin.write('README.md', 'base\n');
    const base = origin.commitWithNames(files, 'base');
    origin.publish('refs/heads/trunk');
    origin.write('short.txt', 'short\n');
    const head = origin.commitWithNames(files, 'short');
    origin.publish(`refs/pull/${APP_PULL.number}/head`);
    const repo = await cloneOf(server.baseUrl, {
      number: APP_PULL.number,
      head,
      baseBranch: 'trunk',
      base,
    });
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update({
      ...e2eInfo({ kind: 'ready', head, base, mergeBase: base, offline: false }),
      shown: head,
    });
    await settled((each) => each.from === 'local');

    for (const [index, path] of paths.entries()) {
      expect(path.length).toBe([1_229, 20_480][index]);
      // Its key is its digest, which says nothing of where it is: its bytes do.
      const named = { text: path.toString('utf8'), digest: 'f'.repeat(64) };
      expect(await diff.whole(head, 'new', named, false)).toEqual({
        kind: 'text',
        text: `alone ${index}\n`,
      });
    }
  });

  it('says a binary file isn’t text', async () => {
    const repo = await e2eClone();
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    await settled((each) => each.from === 'local');

    expect(await diff.whole(APP_PULL.head, 'new', at('assets/mark.png'), false)).toEqual({
      kind: 'binary',
      size: expect.any(Number),
    });
  });

  it('leaves a file over a mebibyte until it’s asked for anyway, and refuses what Lo never shows', async () => {
    const repo = await e2eClone();
    const lines = Buffer.from('x'.repeat(99).concat('\n').repeat(20_000));
    const large = sized(repo, lines.length, lines);
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(large) });
    diff.update(e2eInfo(READY));
    await settled((each) => each.from === 'local');

    expect(await diff.whole(APP_PULL.head, 'new', at('README.md'), false)).toEqual({
      kind: 'large',
      size: 2_000_000,
    });
    const loaded = await diff.whole(APP_PULL.head, 'new', at('README.md'), true);
    expect(loaded.kind === 'text' && loaded.text.length).toBe(2_000_000);

    // A line over a mebibyte is as slow to lay out as a file that large.
    const minified = Buffer.alloc(1024 * 1024 + 1, 'x');
    const long = diffTab({ clone: () => Promise.resolve(sized(repo, minified.length, minified)) });
    long.diff.update(e2eInfo(READY));
    await long.settled((each) => each.from === 'local');
    expect(await long.diff.whole(APP_PULL.head, 'new', at('README.md'), true)).toEqual({
      kind: 'refused',
      why: 'it has a line over 1 MiB long',
    });

    // Past 50 MiB, it isn't read at all.
    const huge = diffTab({
      clone: () => Promise.resolve(sized(repo, 60 * 1024 * 1024, Buffer.alloc(0))),
    });
    huge.diff.update(e2eInfo(READY));
    await huge.settled((each) => each.from === 'local');
    expect(await huge.diff.whole(APP_PULL.head, 'new', at('README.md'), true)).toEqual({
      kind: 'refused',
      why: expect.stringContaining('more than the 50 MiB Lo shows'),
    });
  });
});

/** The files the revisions feature would show since r1, the first push: `paths`. */
async function sinceFirstPush(paths: string[]): Promise<{ repo: Repo; since: Since }> {
  const repo = await e2eClone();
  await repo.fetchCommits(APP_PULL.number, [parseOid(APP_PULL.firstHead)]);
  const sinceR1 = comparing(
    repo,
    side(APP_PULL.firstHead, APP_PULL.firstBase),
    side(APP_PULL.head, APP_PULL.base),
  );
  return {
    repo,
    since: {
      key: 'since:1',
      groups: [{ comparing: sinceR1, label: 'r1', why: 'viewed', paths }],
    },
  };
}

describe('files a push changed since they were viewed', { timeout: 60_000 }, () => {
  it('a viewed file a later push changed shows only what changed since, across the rebase', async () => {
    const { repo, since } = await sinceFirstPush(['src/parser.ts', 'src/format.ts']);
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY), { kind: 'head', since });
    const state = await settled((each) => each.from === 'local');
    expect(state).toMatchObject({ at: APP_PULL.head, comparison: null, since: 'since:1' });

    // The second push's change alone, which r1 → r2 has, not the rename the first push made.
    const parser = find(state, 'src/parser.ts');
    expect(parser.file).toMatchObject({
      change: 'modified',
      previous: null,
      additions: 2,
      deletions: 1,
      start: 'shown',
      since: { label: 'r1', why: 'viewed' },
    });
    const [text] = await diff.texts(APP_PULL.head, null, null, 'since:1', 'local', [parser.place]);
    if (text?.kind !== 'texts') throw new Error('no texts');
    expect(text.old).toContain('Splits `input` into lines');
    expect(text.old).not.toContain('Empty input has no lines');
    expect(text.old).not.toContain("if (input === '')");
    expect(text.new).toContain("if (input === '')");
    // Asked for without the files since, the texts have moved on.
    await expect(
      diff.texts(APP_PULL.head, null, null, null, 'local', [parser.place]),
    ).rejects.toMatchObject({ code: 'moved' });

    // Nothing changed in src/format.ts since r1 once the rebase is set aside: it says so.
    expect(find(state, 'src/format.ts').file).toMatchObject({
      start: 'unchanged',
      additions: 0,
      deletions: 0,
      since: { label: 'r1', why: 'viewed' },
    });
    // The other files show the whole pull request's change, in the same list.
    expect(find(state, 'src/legacy.ts').file).toMatchObject({ change: 'deleted', since: null });
    expect(state.files).toHaveLength(7);
  });

  it('files that come to show since later change in place, the list and its order kept', async () => {
    const { repo, since } = await sinceFirstPush(['src/parser.ts']);
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY));
    const whole = await settled((each) => each.from === 'local');
    expect(whole.since).toBeNull();

    diff.update(e2eInfo(READY), { kind: 'head', since });
    const narrowed = await settled((each) => each.since === 'since:1');
    expect(narrowed.files?.map((file) => file.path.text)).toEqual(
      whole.files?.map((file) => file.path.text),
    );
    expect(find(narrowed, 'src/parser.ts').file.since).toEqual({ label: 'r1', why: 'viewed' });
  });

  it('after a replay that conflicted, a file shows its whole change', async () => {
    const { repo, since } = await sinceFirstPush(['src/parser.ts']);
    const [group] = since.groups;
    if (!group) throw new Error('no group');
    const made = await group.comparing.compared();
    if ('refused' in made) throw new Error('refused');
    const conflicted: Since = {
      key: 'since:2',
      groups: [
        {
          ...group,
          comparing: {
            ...group.comparing,
            compared: () =>
              Promise.resolve({
                ...made,
                replay: { kind: 'conflicted', tree: parseOid(APP_PULL.base), retargeted: false },
              }),
          },
        },
      ],
    };
    const { diff, settled } = diffTab({ clone: () => Promise.resolve(repo) });
    diff.update(e2eInfo(READY), { kind: 'head', since: conflicted });
    const state = await settled((each) => each.from === 'local');
    expect(find(state, 'src/parser.ts').file).toMatchObject({ change: 'renamed', since: null });
  });
});

describe('a stack’s layer’s diff', { timeout: 60_000 }, () => {
  /** rozed-dev/e2e's e2/b and e2/c heads: #4, e2/c, holds e2/b's head. */
  const B = 'fd3d9a4102c1371a42100297822828c8cd12255c';
  const C = '4b18a1a61f29869e0665318e518ed79a9957fcc8';
  /** A commit the repository doesn't have. */
  const GONE = '0000000000000000000000000000000000000001';

  /** #4's tab, shown at e2/c's head, compared with `compareFrom`. */
  function layerInfo(
    compareFrom: string | undefined = B,
    local: LocalState = { kind: 'fetching', progress: null, attempt: 1 },
  ): PullTabInfo {
    return { ...e2eInfo(local), number: 4, shown: C, latest: C, compareFrom };
  }

  /**
   * A client answered from the comparisons' cassette, which lists #4's own files when asked for
   * them, and notes each address it's asked for.
   */
  function layerClient(asked: string[], compareStatus?: number): GithubClient {
    const replay = replayFetch('rest_comparison_e2e');
    return new GithubClient({
      fetch: (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        asked.push(new URL(url).pathname);
        if (url.includes('/compare/') && compareStatus !== undefined) {
          return Promise.resolve(
            new Response('{"message":"Server Error"}', { status: compareStatus }),
          );
        }
        if (url.includes('/compare/')) return replay(input, init);
        const file = {
          filename: 'e2/b.txt',
          status: 'added',
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: '@@ -0,0 +1 @@\n+b',
          contents_url: `https://api.github.com/repos/rozed-dev/e2e/contents/e2%2Fb.txt?ref=${C}`,
        };
        return Promise.resolve(
          new Response(JSON.stringify([file]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
      urls: {
        api: 'https://api.github.com',
        web: 'https://github.com',
        uploads: 'https://uploads.github.com',
      },
      token: new Token('gho_FAKE'),
    });
  }

  it('reads GitHub’s comparison with the layer below until the local copy is ready', async () => {
    const asked: string[] = [];
    const client = layerClient(asked);
    const { diff, settled } = diffTab({ github: (_acting, request) => request(client) });
    diff.update(layerInfo());
    const state = await settled((each) => each.from === 'github');

    expect(state).toMatchObject({ at: C, compareFrom: B, partial: false, uncompared: false });
    expect(state.files?.map((file) => file.path.text)).toEqual(['e2/c.txt']);
    expect(asked).toEqual([`/repos/rozed-dev/e2e/compare/${B}...${C}`]);
    const [patch] = await diff.texts(C, null, B, null, 'github', [0]);
    expect(patch).toMatchObject({ kind: 'patch' });
    // Asked for with another start, it's moved on.
    await expect(diff.texts(C, null, null, null, 'github', [0])).rejects.toMatchObject({
      code: 'moved',
    });
  });

  it('reads the pull request’s own files when GitHub no longer has the commit', async () => {
    const asked: string[] = [];
    const client = layerClient(asked);
    const { diff, settled } = diffTab({ github: (_acting, request) => request(client) });
    diff.update(layerInfo(GONE));
    const state = await settled((each) => each.from === 'github');

    expect(state).toMatchObject({ compareFrom: GONE, uncompared: true });
    expect(state.files?.map((file) => file.path.text)).toEqual(['e2/b.txt']);
    expect(asked).toEqual([
      `/repos/rozed-dev/e2e/compare/${GONE}...${C}`,
      '/repos/rozed-dev/e2e/pulls/4/files',
    ]);
  });

  it('reads the pull request’s own files, and says so, whatever stopped GitHub comparing', async () => {
    const asked: string[] = [];
    const client = layerClient(asked, 500);
    const { diff, settled } = diffTab({ github: (_acting, request) => request(client) });
    diff.update(layerInfo());
    const state = await settled((each) => each.from === 'github');
    expect(state).toMatchObject({ compareFrom: B, uncompared: true, problem: null });
    expect(state.files?.map((file) => file.path.text)).toEqual(['e2/b.txt']);
  });

  it('starts again for another start, and waits for the local copy compared with it', async () => {
    let asked = 0;
    const { diff, sent } = diffTab({
      github: () => {
        asked += 1;
        return new Promise(() => undefined);
      },
    });
    diff.update({ ...layerInfo(), compareFrom: undefined });
    expect(sent.at(-1)).toMatchObject({ at: C, compareFrom: null });
    expect(asked).toBe(1);
    // The local copy is ready at the head, but still works out where it meets the new start: GitHub
    // isn't asked, and nothing is read until it has.
    const ready: LocalState = { kind: 'ready', head: C, base: C, mergeBase: C, offline: false };
    diff.update(layerInfo(B, ready));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent.at(-1)).toMatchObject({ at: C, compareFrom: B, files: null });
    expect(asked).toBe(1);
    expect(await diff.whole(C, 'old', { text: 'e2/c.txt' }, false)).toEqual({ kind: 'waiting' });
  });

  it('passes on that the window drew the diff only from where it starts now', () => {
    const { diff, drawn } = diffTab({});
    diff.update(layerInfo());
    diff.drawn(C, null);
    expect(drawn).toEqual([]);
    diff.drawn(C, B);
    expect(drawn).toEqual([C]);
  });
});

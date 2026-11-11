import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseOid, type Repo } from '@lo/git';
import { GithubClient, Token } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { APP_PULL, gitProgram, writeAppRemote } from '@lo/testing/git';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createGit } from '../../../main/git.ts';
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

/** rozed-dev/e2e's clone in a new cache, with #78 fetched into it. */
async function e2eClone(): Promise<Repo> {
  remote ??= writeAppRemote(realpathSync(mkdtempSync(join(tmpdir(), 'lo-diff-remote-'))));
  const git = createGit({
    settings: { program: gitProgram(), test: { remote } },
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
    number: APP_PULL.number,
    head: parseOid(APP_PULL.head),
    baseBranch: 'app/base',
    base: parseOid(APP_PULL.base),
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

/** rozed-dev/e2e#78's tab, shown at its head. */
function e2eInfo(
  local: LocalState = { kind: 'fetching', progress: null, attempt: 1 },
): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: APP_PULL.number,
    acting: { kind: 'account', login: 'rozed-bot' },
    shown: APP_PULL.head,
    provisional: false,
    local,
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

    const [renamed, deleted] = await diff.texts(APP_PULL.head, 'local', [
      parser.place,
      legacy.place,
    ]);
    expect(renamed).toMatchObject({ kind: 'texts' });
    if (renamed?.kind !== 'texts') throw new Error('no texts');
    expect(renamed.old).toContain("input.split('\\n')");
    expect(renamed.new).toContain('Empty input has no lines.');
    expect(deleted).toMatchObject({ kind: 'texts', new: null });

    await expect(diff.texts(APP_PULL.firstHead, 'local', [parser.place])).rejects.toMatchObject({
      code: 'moved',
    });
    await expect(diff.texts(APP_PULL.head, 'github', [parser.place])).rejects.toMatchObject({
      code: 'moved',
    });
    await expect(diff.texts(APP_PULL.head, 'local', [999])).rejects.toMatchObject({
      code: 'invalid',
    });
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

    const [text] = await diff.texts(APP_PULL.head, 'local', [find(state, 'src/parser.ts').place]);
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
    const [patch] = await diff.texts(APP_PULL.head, 'github', [parser.place]);
    expect(patch).toMatchObject({
      kind: 'patch',
      patch: expect.stringContaining('@@ -4,9 +4,10 @@'),
    });
    const numbers = find(github, 'data/numbers.txt');
    expect(await diff.texts(APP_PULL.head, 'github', [numbers.place])).toEqual([
      { kind: 'missing', why: expect.any(String) },
    ]);

    diff.update(e2eInfo(READY));
    const local = await settled((each) => each.from === 'local');
    expect(local.files).toHaveLength(github.files?.length ?? 0);
    await expect(diff.texts(APP_PULL.head, 'github', [parser.place])).rejects.toMatchObject({
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
    diff.drawn(APP_PULL.firstHead);
    diff.drawn(APP_PULL.head);

    expect(drawn).toEqual([APP_PULL.head]);
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

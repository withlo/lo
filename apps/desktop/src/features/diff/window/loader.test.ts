import { diffText, type FileDiff } from '@lo/diff';
import { describe, expect, it } from 'vitest';

import type { DiffState, FileText, FileVersions, Source, Start } from '../contract.ts';
import type { FileJob, FileResult } from '../jobs.ts';
import { Loader, type LoaderWork, type Shown, type Sink } from './loader.ts';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

function versions(path: string, start: Start = 'shown', size = 10): FileVersions {
  return {
    path: { text: path },
    previous: null,
    change: 'modified',
    additions: 1,
    deletions: 1,
    old: { blob: 'c'.repeat(40), size },
    new: { blob: 'd'.repeat(40), size },
    start,
    generated: null,
    large: start === 'large' ? 'large' : null,
    submodule: null,
  };
}

function state(files: FileVersions[] | null, from: Source | null = 'local', at = HEAD): DiffState {
  return { id: 't1', at, from, files, partial: false, problem: null };
}

/** Work answered at once: each file's texts are its path's, before and after. */
function work(order: readonly string[] = []) {
  const asked: {
    texts: number[][];
    jobs: { files: FileJob[]; whitespace: boolean; highlight: boolean }[];
  } = {
    texts: [],
    jobs: [],
  };
  let listed: readonly FileVersions[] = [];
  const failing = new Set<string>();
  const done: LoaderWork = {
    texts({ files }) {
      asked.texts.push(files);
      return Promise.resolve(
        files.map((place): FileText => {
          const path = listed[place]?.path.text ?? '?';
          if (failing.has(path)) return { kind: 'missing', why: 'gone' };
          return { kind: 'texts', old: `${path}\nold\n`, new: `${path}\nnew\n` };
        }),
      );
    },
    files(input) {
      asked.jobs.push(input);
      return Promise.resolve(
        input.files.map((file): FileResult => {
          if (file.kind === 'patch') throw new Error('no patches here');
          const old = file.old ?? '';
          const added = file.new ?? '';
          const base = input.whitespace ? old : added;
          return {
            ok: true,
            diff: diffText(base, added),
            tokens: {},
            changes: { deleted: [{ start: 2, text: 'old' }], added: [{ start: 2, text: 'new' }] },
          };
        }),
      );
    },
    moves: ({ files }) =>
      Promise.resolve(
        files.length < 2
          ? []
          : [
              {
                from: { file: 0, path: '', first: 2, last: 2 },
                to: { file: 1, path: '', first: 2, last: 2 },
                edits: [],
                words: { old: [], new: [] },
              },
            ],
      ),
    highlight: ({ files }) =>
      Promise.resolve(files.map(() => ({ new: Uint32Array.from([0, 1, 1]) }))),
    order: () => order,
    log: () => undefined,
  };
  return {
    done,
    asked,
    list: (files: readonly FileVersions[]) => {
      listed = files;
    },
    failing,
  };
}

/** What the view hears, in order. */
function sink() {
  const heard: string[] = [];
  const made: Sink = {
    lines: (id: string, shown: Shown) => heard.push(`lines ${id} ${shown.from}`),
    diff: (id: string, _diff: FileDiff) => heard.push(`diff ${id}`),
    failed: (id: string) => heard.push(`failed ${id}`),
    moves: (moves) => heard.push(`moves ${moves.length}`),
    // Highlighting comes as it does: the tests here don't count it.
    tokens: () => undefined,
  };
  return { made, heard };
}

async function settle(loader: Loader): Promise<void> {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
  void loader;
}

describe('a tab’s diff in the window', () => {
  it('loads the files that show their lines in the left panel’s order, and is ready once they’re in', async () => {
    const files = [
      versions('a.ts'),
      versions('b.ts'),
      versions('big.txt', 'large'),
      versions('c.png', 'binary'),
    ];
    const { done, asked, list } = work(['b.ts', 'big.txt', 'a.ts', 'c.png']);
    list(files);
    const loader = new Loader(done);
    loader.take(state(files));
    // Nothing loads until the view says whether whitespace shows.
    await settle(loader);
    expect(asked.texts).toEqual([]);

    loader.setWhitespace(true);
    await settle(loader);

    expect(asked.texts).toEqual([[1, 0]]);
    const { ready, progress } = loader.snapshot();
    expect(progress).toEqual({ done: 2, of: 2 });
    expect(ready?.entries.map((entry) => entry.id)).toEqual(['d0', 'd1', 'd2', 'd3']);
    expect(loader.shown('d0')?.lines.new).toEqual(['a.ts', 'new']);
    expect(loader.shown('d2')).toBe(undefined);
    expect(loader.moves()).toEqual([
      expect.objectContaining({ from: expect.objectContaining({ file: 'd0' }) }),
    ]);
  });

  it('tries each file of a batch that failed whole on its own, so one can’t sink the rest', async () => {
    const files = [versions('a.ts'), versions('huge.ts'), versions('c.ts')];
    const { done, list } = work();
    list(files);
    const sizes: number[] = [];
    const loader = new Loader({
      ...done,
      files: (input) => {
        sizes.push(input.files.length);
        // A batch with the huge file runs out of memory, as the job would.
        return input.files.some((file) => file.path === 'huge.ts')
          ? Promise.reject(new Error('huge.ts ran out of memory'))
          : done.files(input, new AbortController().signal);
      },
    });
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);

    expect(sizes).toEqual([3, 1, 1, 1]);
    expect(loader.shown('d0')).toBeDefined();
    expect(loader.shown('d2')).toBeDefined();
    expect(loader.failed('d1')).toBe(true);
    expect(loader.snapshot().ready).toBeDefined();
  });

  it('finds no moves in generated files', async () => {
    const lock = { ...versions('pnpm-lock.yaml'), generated: 'lockfile' as const };
    const files = [versions('a.ts'), lock];
    const { done, list } = work();
    list(files);
    let asked: unknown;
    const loader = new Loader({
      ...done,
      moves: (input) => {
        asked = input;
        return done.moves(input, new AbortController().signal);
      },
    });
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);

    expect(asked).toEqual({
      files: [
        expect.objectContaining({ added: [{ start: 2, text: 'new' }] }),
        { deleted: [], added: [] },
      ],
    });
  });

  it('cancels the jobs under way when the tab closes, and when a new head starts again', async () => {
    const files = [versions('a.ts')];
    const { done, list } = work();
    list(files);
    const signals: AbortSignal[] = [];
    const loader = new Loader({
      ...done,
      files: (_input, signal) => {
        signals.push(signal);
        // Never answers: it's still running.
        return new Promise(() => undefined);
      },
    });
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);
    loader.take(state(files, 'local', NEXT));
    await settle(loader);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);

    loader.stop();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it('is ready to draw once the diffs are in, and highlights after, in bigger batches', async () => {
    const files = Array.from({ length: 60 }, (_, index) => versions(`f${index}.ts`));
    const { done, asked, list } = work();
    list(files);
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const highlighted: number[] = [];
    const loader = new Loader({
      ...done,
      highlight: async (input, signal) => {
        highlighted.push(input.files.length);
        await held;
        return done.highlight(input, signal);
      },
    });
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);

    // Ready while the highlighting is still under way, and no diff job highlighted.
    expect(loader.snapshot().ready).toBeDefined();
    expect(asked.jobs.every((job) => !job.highlight)).toBe(true);
    expect(asked.jobs.length).toBe(2);
    expect(highlighted).toEqual([60]);
    expect(loader.shown('d0')?.tokens.new).toBe(undefined);
    release?.();
    await settle(loader);
    expect(loader.shown('d59')?.tokens.new).toEqual(Uint32Array.from([0, 1, 1]));
  });

  it('gives the same id to a path in every list of the tab, and none to one it hasn’t seen', () => {
    const { done } = work();
    const loader = new Loader(done);
    expect(loader.ids.of('x.ts')).toBe('d0');
    expect(loader.ids.of('y.ts')).toBe('d1');
    expect(loader.ids.of('x.ts')).toBe('d0');
    expect(loader.ids.keyOf('d1')).toBe('y.ts');
    expect(loader.ids.find('z.ts')).toBe(undefined);
  });

  it('takes the local copy’s files in place of GitHub’s when they’re the same, a file at a time', async () => {
    const files = [versions('a.ts'), versions('b.ts')];
    const { done, list } = work();
    list(files);
    const loader = new Loader({
      ...done,
      texts: ({ from, files: places }) =>
        from === 'github'
          ? Promise.resolve(places.map(() => ({ kind: 'texts' as const, old: 'x\n', new: 'y\n' })))
          : done.texts({ at: HEAD, from, files: places }),
    });
    loader.setWhitespace(true);
    loader.take(state(files, 'github'));
    await settle(loader);
    const github = loader.snapshot().ready;
    expect(github?.from).toBe('github');
    const { made, heard } = sink();
    loader.attach(made);

    loader.take(state(files, 'local'));
    await settle(loader);

    expect(loader.snapshot().ready?.from).toBe('local');
    expect(loader.snapshot().ready?.entries.map((entry) => entry.id)).toEqual(
      github?.entries.map((entry) => entry.id),
    );
    expect(heard).toEqual(['lines d0 local', 'lines d1 local', 'moves 1']);
  });

  it('takes the local copy’s files in place even where they start out otherwise, loading the lines the view shows', async () => {
    const github = [versions('a.ts'), versions('gen.ts'), versions('big.txt', 'large')];
    const local = [
      versions('a.ts'),
      { ...versions('gen.ts', 'collapsed'), generated: 'attribute' as const },
      // Large by its size, which GitHub's list doesn't say.
      versions('big.txt', 'large'),
    ];
    const { done, list } = work();
    const loader = new Loader(done);
    loader.setWhitespace(true);
    list(github);
    loader.take(state(github, 'github'));
    await settle(loader);
    const drawn = loader.snapshot().ready;
    const { made, heard } = sink();
    loader.attach(made);

    list(local);
    loader.take(state(local, 'local'));
    await settle(loader);

    // The same view, which hears of each file it shows the lines of.
    expect(loader.snapshot().ready?.from).toBe('local');
    expect(loader.snapshot().ready?.entries.map((entry) => entry.id)).toEqual(
      drawn?.entries.map((entry) => entry.id),
    );
    expect(heard.filter((line) => line.startsWith('lines'))).toEqual([
      'lines d0 local',
      'lines d1 local',
    ]);
  });

  it('keeps GitHub’s files drawn until the local copy’s other files are all in', async () => {
    const githubFiles = [versions('a.ts'), versions('b.ts')];
    const localFiles = [versions('a.ts'), versions('b.ts'), versions('c.ts')];
    const { done, list } = work();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = new Loader({
      ...done,
      async texts(input) {
        if (input.from === 'local') await held;
        return done.texts(input);
      },
    });
    loader.setWhitespace(true);
    list(githubFiles);
    loader.take(state(githubFiles, 'github'));
    await settle(loader);
    const { made, heard } = sink();
    loader.attach(made);

    list(localFiles);
    loader.take(state(localFiles, 'local'));
    await settle(loader);
    expect(loader.snapshot().ready?.from).toBe('github');

    release?.();
    await settle(loader);
    expect(loader.snapshot().ready?.from).toBe('local');
    expect(loader.snapshot().ready?.entries).toHaveLength(3);
    // The view drawn from GitHub's files hears none of it: a new one is drawn.
    expect(heard.filter((line) => line.startsWith('lines'))).toEqual([]);
  });

  it('starts again at a new head', async () => {
    const files = [versions('a.ts')];
    const { done, list } = work();
    list(files);
    const loader = new Loader(done);
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);
    loader.take(state(null, null, NEXT));

    expect(loader.snapshot().ready).toBe(undefined);
    expect(loader.shown('d0')).toBe(undefined);
  });

  it('loads a large file when it’s asked for, and says when it can’t', async () => {
    const files = [versions('big.txt', 'large'), versions('gone.txt', 'large')];
    const { done, list, failing } = work();
    list(files);
    failing.add('gone.txt');
    const loader = new Loader(done);
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);
    const { made, heard } = sink();
    loader.attach(made);

    loader.load('d0');
    loader.load('d1');
    await settle(loader);

    expect(heard).toContain('lines d0 local');
    expect(heard).toContain('failed d1');
    expect(loader.failed('d1')).toBe(true);
  });

  it('diffs the local copy’s files again when whitespace is hidden, keeping their lines', async () => {
    const files = [versions('a.ts')];
    const { done, asked, list } = work();
    list(files);
    const loader = new Loader(done);
    loader.setWhitespace(true);
    loader.take(state(files));
    await settle(loader);
    const { made, heard } = sink();
    loader.attach(made);
    const before = loader.shown('d0');

    loader.setWhitespace(false);
    await settle(loader);

    expect(asked.jobs.at(-1)).toMatchObject({ whitespace: false, highlight: false });
    expect(heard).toEqual(['diff d0', 'moves 0']);
    expect(loader.shown('d0')?.lines).toBe(before?.lines);
    expect(loader.snapshot().whitespace).toBe(false);
  });
});

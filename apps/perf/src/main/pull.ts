// Reading a recorded pull request from the cache, as the window shows it and the background
// process diffs it. Nothing here calls GitHub.

import { splitLines } from '@lo/diff';

import { fetchPullRequest, readBlobs } from '../data/cache.ts';
import { readManifest } from '../data/manifest.ts';
import {
  largeFile,
  type Job,
  type Pull,
  type PullFile,
  type PullThread,
} from '../shared/protocol.ts';

/**
 * Reads pull request `name`, by its manifest's name, with its files' text from the cache: the
 * pull request as the window shows it, the files to diff, and the large files kept out until
 * they're loaded, by their index.
 */
export async function loadPull(
  name: string,
): Promise<{ pull: Pull; jobs: Job[]; large: Map<number, Job> }> {
  const manifest = readManifest(name);
  // Everything is in the cache already, so this only checks it.
  const { files: blobs } = await fetchPullRequest(manifest);
  const ids = [...new Set(blobs.flatMap(({ base, head }) => [base, head]))].filter(
    (id) => id !== undefined,
  );
  const contents = await readBlobs(manifest.repo, ids);
  const decoder = new TextDecoder();
  const read = (id: string | undefined): Uint8Array | undefined =>
    id === undefined ? undefined : contents.get(id);

  const files: PullFile[] = [];
  const jobs: Job[] = [];
  const large = new Map<number, Job>();
  manifest.files.forEach((file, index) => {
    const meta = {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    };
    const old = read(blobs[index]?.base);
    const added = read(blobs[index]?.head);
    if (isBinary(old) || isBinary(added)) {
      files.push({ ...meta, skipped: 'binary' });
    } else if (file.additions + file.deletions > largeFile) {
      files.push({ ...meta, skipped: 'too-large' });
      const text = { old: old && decoder.decode(old), new: added && decoder.decode(added) };
      large.set(index, { index, path: file.path, previousPath: file.previousPath, ...text });
    } else {
      const text = { old: old && decoder.decode(old), new: added && decoder.decode(added) };
      files.push({ ...meta, ...text });
      jobs.push({ index, path: file.path, previousPath: file.previousPath, ...text });
    }
  });

  const pull: Pull = {
    name,
    repo: manifest.repo,
    number: manifest.number,
    files,
    threads: threadsOf(manifest.threads, files),
  };
  return { pull, jobs, large };
}

/** Whether a blob looks binary to git: a NUL in its first 8,000 bytes. */
function isBinary(blob: Uint8Array | undefined): boolean {
  return blob !== undefined && blob.subarray(0, 8000).includes(0);
}

/**
 * The recorded threads on lines of files the documents show, then left-side threads made up from
 * a fixed seed, so every run has the same ones: recorded pull requests have few on the left.
 */
function threadsOf(
  recorded: readonly {
    path: string;
    side: 'left' | 'right';
    line?: number | undefined;
    comments: number[];
  }[],
  files: readonly PullFile[],
): PullThread[] {
  const byPath = new Map(files.map((file, index) => [file.path, index]));
  const counts = files.map((file) => ({
    old: file.old === undefined ? 0 : splitLines(file.old).length,
    new: file.new === undefined ? 0 : splitLines(file.new).length,
  }));
  const threads: PullThread[] = [];
  for (const thread of recorded) {
    const file = byPath.get(thread.path);
    const side = thread.side === 'left' ? 'old' : 'new';
    if (file === undefined || thread.line === undefined) continue;
    if (thread.line > counts[file]![side]) continue;
    threads.push({ file, side, line: thread.line, comments: thread.comments });
  }
  const next = random(125_488);
  let shown = 0;
  counts.forEach(({ old }, file) => {
    if (old === 0 || shown++ % 20 !== 0) return;
    const comments = Array.from({ length: 1 + next(3) }, () => 40 + next(800));
    threads.push({ file, side: 'old', line: 1 + next(old), comments });
  });
  return threads.toSorted((a, b) => a.file - b.file || a.line - b.line);
}

/** A small deterministic random number generator. */
function random(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * bound);
  };
}

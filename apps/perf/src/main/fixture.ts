// A small pull request written out as one JSON file, with each file's text: what the key spec opens,
// with nothing to fetch. `LO_PERF_PULL` names the file.

import { readFileSync } from 'node:fs';

import { diffText } from '@lo/diff';
import { z } from 'zod';

import { FileStatus } from '../data/manifest.ts';
import type { Job, Pull, PullFile, PullThread } from '../shared/protocol.ts';

const count = z.int().nonnegative();

export const Fixture = z.strictObject({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  number: z.int().positive(),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      previousPath: z.string().min(1).optional(),
      status: FileStatus,
      /** Each version's text, none for a side the file isn't on. */
      old: z.string().optional(),
      new: z.string().optional(),
    }),
  ),
  threads: z.array(
    z.strictObject({
      path: z.string().min(1),
      side: z.enum(['old', 'new']),
      line: z.int().positive(),
      /** Each comment's length. */
      comments: z.array(count).min(1),
    }),
  ),
});
export type Fixture = z.infer<typeof Fixture>;

/** The pull request in the JSON file at `path`, as the window shows it, and its files to diff. */
export function readFixture(path: string): { pull: Pull; jobs: Job[]; large: Map<number, Job> } {
  const fixture = Fixture.parse(JSON.parse(readFileSync(path, 'utf8')));
  const files: PullFile[] = fixture.files.map((file) => {
    const { changes } = diffText(file.old, file.new);
    const additions = changes.reduce((sum, change) => sum + change.new.end - change.new.start, 0);
    const deletions = changes.reduce((sum, change) => sum + change.old.end - change.old.start, 0);
    return { ...file, additions, deletions };
  });
  const byPath = new Map(files.map((file, index) => [file.path, index]));
  const threads: PullThread[] = fixture.threads.map((thread) => {
    const file = byPath.get(thread.path);
    if (file === undefined) throw new Error(`A thread is on ${thread.path}, which isn't changed.`);
    return { file, side: thread.side, line: thread.line, comments: thread.comments };
  });
  const jobs = files.map((file, index) => ({
    index,
    path: file.path,
    previousPath: file.previousPath,
    old: file.old,
    new: file.new,
  }));
  return {
    pull: { name: 'fixture', repo: fixture.repo, number: fixture.number, files, threads },
    jobs,
    large: new Map(),
  };
}

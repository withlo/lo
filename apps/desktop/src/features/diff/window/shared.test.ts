// Diffing texts another feature has: in the diff's background jobs, as many files to a job as one
// takes, whitespace shown, both sides highlighted, the answers in the order the files were given.

import { describe, expect, it, vi } from 'vitest';

import { FILES_PER_JOB } from '../jobs.ts';
import { diffTexts } from './shared.ts';

type Files = (
  input: { files: { path: string }[] },
  options: { signal?: AbortSignal | undefined },
) => Promise<{ ok: false; why: string }[]>;

const jobs = vi.hoisted(() => ({
  files: vi.fn<Files>((input) =>
    Promise.resolve(input.files.map((file) => ({ ok: false as const, why: file.path }))),
  ),
}));

vi.mock('./main.ts', () => ({ diffJobs: () => jobs }));

describe('diffTexts', () => {
  it('diffs the texts in jobs of as many files as one takes, answering in order', async () => {
    const files = Array.from({ length: FILES_PER_JOB + 2 }, (_, n) => ({
      path: `f${n}.ts`,
      old: n === 0 ? null : 'a\n',
      new: 'b\n',
    }));
    const stop = new AbortController();
    const diffed = await diffTexts(files, stop.signal);
    expect(diffed.map((file) => (file.ok ? '' : file.why))).toEqual(files.map((file) => file.path));
    expect(jobs.files).toHaveBeenCalledTimes(2);
    const [input, options] = jobs.files.mock.calls[0]!;
    expect(input).toMatchObject({ whitespace: true, highlight: true });
    expect(input.files[0]).toEqual({ kind: 'texts', path: 'f0.ts', old: null, new: 'b\n' });
    expect(input.files).toHaveLength(FILES_PER_JOB);
    expect(jobs.files.mock.calls[1]![0].files).toHaveLength(2);
    expect(options.signal).toBe(stop.signal);
  });

  it('leaves highlighting out when asked', async () => {
    jobs.files.mockClear();
    await diffTexts([{ path: 'a.ts', old: 'a\n', new: 'b\n' }], undefined, { highlight: false });
    expect(jobs.files.mock.calls[0]![0]).toMatchObject({ whitespace: true, highlight: false });
  });
});

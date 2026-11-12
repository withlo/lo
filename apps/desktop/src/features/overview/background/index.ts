// The overview's jobs: reading `artifact.md`, and checking the overview against what main read of
// its commit and code. Pure work on what the window sends: nothing here reads the repository, the
// disk or the network. The readers the check runs with answer only from what main read, and fail
// what it didn't, which leaves that figure or code unread.

import {
  checkArtifact,
  LIMITS,
  parseArtifact,
  SIZE_ONLY,
  type CheckedArtifact,
  type CodeReader,
  type FileAnswer,
  type OverviewFiles,
} from '@lo/artifact';

import { defineRunner } from '../../../background/runners.ts';
import { codeFiles, contract, treeEntries, type CheckInput, type Parsed } from '../jobs.ts';

export default defineRunner(contract, {
  parse: {
    run: ({ artifact }) => parseOverview(artifact),
    // The parse is bounded on any input, within seconds.
    limits: { deadline: 30_000 },
  },
  check: {
    run: (input) => checkOverview(input),
    // The parse again, and every figure through `sanitizeSvg`.
    limits: { deadline: 60_000 },
  },
});

/**
 * `artifact.md` read, with the files main reads for its checks: past the limit on figures, which
 * makes the overview invalid, the checks read none of the rest.
 */
export function parseOverview(artifact: Uint8Array): Parsed {
  const parsed = parseArtifact(artifact);
  const shown = parsed.figures.slice(0, LIMITS.figures);
  const figures = [...new Set(shown.map(({ path }) => path))];
  return { parsed, code: codeFiles(parsed.references), figures };
}

/** Checks an overview against what main read, as `overview.check` does. */
export function checkOverview(input: CheckInput): Promise<CheckedArtifact> {
  const parsed = input.artifact === null ? undefined : parseArtifact(input.artifact);
  const files: OverviewFiles = {
    entries: treeEntries(input.entries),
    read: figureReader(input.figures),
  };
  return checkArtifact(parsed, files, codeReader(input.code), { pr: input.pr });
}

/** A file of `size` bytes, of which `bytes` are its start, as a reader answers a read of `cap`. */
function answer(size: number, bytes: Uint8Array, cap: number): FileAnswer {
  const wanted = Math.min(size, cap);
  if (bytes.length >= wanted) return { kind: 'file', size, bytes: bytes.subarray(0, wanted) };
  // A file too large for any check to read comes with its size alone.
  if (size > SIZE_ONLY) return { kind: 'file', size, bytes: new Uint8Array() };
  throw new Error('Main read less of the file than the check reads.');
}

/** Reads the figures main read, as `files` answered each; any other is unread. */
function figureReader(figures: CheckInput['figures']): OverviewFiles['read'] {
  // Paths no longer than any figure's, so each can be a key. The first answer for a path counts.
  const byPath = new Map<string, CheckInput['figures'][number]['file']>();
  for (const { path, file } of figures) if (!byPath.has(path)) byPath.set(path, file);
  return async (path, cap) => {
    const file = byPath.get(path);
    switch (file?.kind) {
      case 'file':
        return answer(file.size, file.bytes ?? new Uint8Array(), cap);
      case 'missing':
        return { kind: 'missing' };
      case 'notFile':
        return { kind: 'notFile', is: file.is };
      case 'refused':
      case 'unread':
      case undefined:
        throw new Error('Main has no answer for the figure.');
      default:
        file satisfies never;
        throw new Error('Main has no answer for the figure.');
    }
  };
}

/** Reads the code main read, at the commit it read it at; with none, all of it is unread. */
function codeReader(code: CheckInput['code']): CodeReader {
  const byPath = new Map<string, NonNullable<CheckInput['code']>['files'][number]['answer']>();
  for (const { path, answer: each } of code?.files ?? []) {
    if (!byPath.has(path)) byPath.set(path, each);
  }
  return async (commit, path, cap) => {
    const file = commit === code?.commit ? byPath.get(path) : undefined;
    switch (file?.kind) {
      case 'file':
        // A file named whole is only looked for: its size isn't asked for.
        if (file.size === null) {
          if (cap === 0) return { kind: 'file', size: 0, bytes: new Uint8Array() };
          throw new Error('Main read none of the file.');
        }
        return answer(file.size, file.bytes, cap);
      case 'missing':
      case 'noCommit':
        return { kind: file.kind };
      case 'notFile':
        return { kind: 'notFile', is: file.is };
      case 'unread':
      case undefined:
        throw new Error('Main has no answer for the code.');
      default:
        file satisfies never;
        throw new Error('Main has no answer for the code.');
    }
  };
}

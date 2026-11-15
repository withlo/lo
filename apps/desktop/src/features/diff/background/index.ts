// The diff's jobs: each file's line and word diff, both sides highlighted, from its texts or from
// GitHub's patch; and the code the pull request moves. Pure work on what the window sends: nothing
// here reads a file of the repository or the network.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { changedLines, diffText, findMoves, splitLines, type FileDiff } from '@lo/diff';
import { withoutWhitespaceChanges } from '@lo/review';
import { diskLoader, Highlighter, languageOfPath, type Loader } from '@lo/syntax';

import { defineRunner } from '../../../background/runners.ts';
import {
  contract,
  type ChangedRuns,
  type FileJob,
  type FileResult,
  type LineRun,
} from '../jobs.ts';
import { patchShown } from './patch.ts';

/**
 * Where the grammars and queries are: beside the built process, which carries them, or in the
 * syntax package itself when the code runs from source, as in tests.
 */
function syntaxLoader(): Loader {
  const bundled = join(import.meta.dirname, 'syntax');
  return existsSync(join(bundled, 'queries')) ? diskLoader(bundled) : diskLoader();
}

export default defineRunner(contract, {
  files: {
    async run({ files, whitespace, highlight, budget }) {
      // Each grammar loads the first time a file needs it.
      const highlighter = highlight ? await Highlighter.create(syntaxLoader()) : undefined;
      const results: FileResult[] = [];
      for (const file of files) {
        try {
          results.push(await diffFile(file, { whitespace, budget, highlighter }));
        } catch (error) {
          results.push({ ok: false, why: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    },
    // A batch of files, each diffed within its budget and highlighted within the syntax package's
    // two seconds a side.
    limits: { deadline: 60_000 },
  },
  highlight: {
    async run({ files }) {
      const highlighter = await Highlighter.create(syntaxLoader());
      const results: { old?: Uint32Array; new?: Uint32Array }[] = [];
      for (const file of files) {
        const lines = { old: linesOf(file.old), new: linesOf(file.new) };
        results.push(await tokensOf(file.path, lines, highlighter));
      }
      return results;
    },
    limits: { deadline: 60_000 },
  },
  moves: {
    run({ files }) {
      return findMoves(
        files.map((file) => ({
          path: '',
          deleted: numbered(file.deleted),
          added: numbered(file.added),
        })),
      );
    },
    limits: { deadline: 30_000 },
  },
});

/** Diffs and highlights one file. */
export async function diffFile(
  file: FileJob,
  options: { whitespace: boolean; budget: number; highlighter?: Highlighter | undefined },
): Promise<FileResult> {
  if (file.kind === 'patch') {
    const shown = patchShown(file.patch, { budget: options.budget });
    return {
      ok: true,
      diff: shown.diff,
      lines: shown.lines,
      gaps: shown.gaps,
      tokens: await tokensOf(file.path, shown.lines, options.highlighter),
      changes: changedRunsOf(shown.diff, shown.lines.old, shown.lines.new),
    };
  }
  const old = file.old ?? undefined;
  const added = file.new ?? undefined;
  // With whitespace hidden, lines whose only change is to whitespace are compared as the head's,
  // and keep their line numbers: only the diff changes, never the lines shown.
  const base =
    !options.whitespace && old !== undefined && added !== undefined
      ? withoutWhitespaceChanges(old, added)
      : old;
  const diff = diffText(base, added, { budget: options.budget });
  const sides = { old: splitLines(base ?? ''), new: splitLines(added ?? '') };
  const shownSides = { old: old === base ? sides.old : splitLines(old ?? ''), new: sides.new };
  return {
    ok: true,
    diff,
    tokens: await tokensOf(file.path, shownSides, options.highlighter),
    changes: changedRunsOf(diff, sides.old, sides.new),
  };
}

/** Lines joined with `\n`, back as lines; none for `null`. */
function linesOf(text: string | null): string[] {
  return text === null ? [] : text.split('\n');
}

/** Each side highlighted, as its lines are shown: joined with `\n`, as the documents hold them. */
async function tokensOf(
  path: string,
  lines: { old: readonly string[]; new: readonly string[] },
  highlighter: Highlighter | undefined,
): Promise<{ old?: Uint32Array; new?: Uint32Array }> {
  const language = languageOfPath(path);
  const tokens: { old?: Uint32Array; new?: Uint32Array } = {};
  if (!highlighter || !language) return tokens;
  for (const side of ['old', 'new'] as const) {
    // A highlighter that failed can't be trusted with another file.
    if (lines[side].length === 0 || !highlighter.usable) continue;
    const highlighted = await highlighter.highlight(language, lines[side].join('\n'));
    if ('tokens' in highlighted) tokens[side] = highlighted.tokens;
  }
  return tokens;
}

/** A file's changed lines, in runs, as `diff.moves` takes them. */
function changedRunsOf(
  diff: FileDiff,
  old: readonly string[],
  added: readonly string[],
): ChangedRuns {
  const changes = changedLines({ path: '', old, new: added }, diff);
  return { deleted: runsOf(changes.deleted), added: runsOf(changes.added) };
}

function runsOf(lines: readonly { number: number; text: string }[]): LineRun[] {
  const runs: { start: number; texts: string[] }[] = [];
  for (const line of lines) {
    const last = runs.at(-1);
    if (last && last.start + last.texts.length === line.number) last.texts.push(line.text);
    else runs.push({ start: line.number, texts: [line.text] });
  }
  return runs.map(({ start, texts }) => ({ start, text: texts.join('\n') }));
}

/** Runs' lines, one by one, with their numbers. */
function numbered(runs: readonly LineRun[]): { number: number; text: string }[] {
  return runs.flatMap(({ start, text }) =>
    text.split('\n').map((line, index) => ({ number: start + index, text: line })),
  );
}

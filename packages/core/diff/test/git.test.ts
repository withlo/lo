// The file diff against git itself: on small files where either side may lack a final line break,
// be empty or not exist, it removes and adds as many lines as `git diff` does, and marks a last
// line without a line break where git does. A fuzz checks that the diff's unchanged lines and
// changes rebuild the new file byte for byte, line endings and final line break included.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';

import { diffText, type FileDiff, linesOf, rowCount } from '../src/file.ts';

/** A small deterministic random number generator, so every run tests the same files. */
function random(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * bound);
  };
}

/** A file of up to four lines from `alphabet`, which may end without a line break. */
function file(next: (bound: number) => number, alphabet: readonly string[], crlf = false): string {
  const count = next(5);
  let text = '';
  for (let line = 0; line < count; line++) {
    text += alphabet[next(alphabet.length)];
    const last = line === count - 1;
    if (!last || next(2) === 0) text += crlf && next(2) === 0 ? '\r\n' : '\n';
  }
  return text;
}

/** Each line of `text` with its line break, as it is in the file. */
function rawLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function counts(diff: FileDiff): { deleted: number; added: number } {
  let deleted = 0;
  let added = 0;
  for (const change of diff.changes) {
    deleted += change.old.end - change.old.start;
    added += change.new.end - change.new.start;
  }
  return { deleted, added };
}

/** Whether `side`'s last line, which has no line break, is in a change. */
function marksNoNewline(diff: FileDiff, side: 'old' | 'new'): boolean {
  const count = side === 'old' ? diff.oldLineCount : diff.newLineCount;
  return (
    diff.noNewlineAtEnd[side] &&
    diff.changes.some((change) => change[side].start <= count && count < change[side].end)
  );
}

/** Every character of the private use area: a file holding them all is diffed as git diffs it. */
let everyMarker = '';
for (let code = 0xe000; code <= 0xf8ff; code++) everyMarker += String.fromCharCode(code);

describe('against git diff', () => {
  test.each([
    ['on small files', (text: string) => text],
    ['after a line of every private-use character', (text: string) => `${everyMarker}\n${text}`],
  ])(
    'removes and adds the lines git does, and marks a missing line break as it does, %s',
    (_, shape) => {
      const next = random(7);
      // Letters only, so every line is as long as every other, and every shortest diff is as good.
      const cases = Array.from({ length: 400 }, () => [
        shape(file(next, ['a', 'b', 'c'])),
        shape(file(next, ['a', 'b', 'c'])),
      ]);
      const folder = mkdtempSync(join(tmpdir(), 'lo-diff-'));
      onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
      mkdirSync(join(folder, 'old'));
      mkdirSync(join(folder, 'new'));
      cases.forEach(([old, added], index) => {
        writeFileSync(join(folder, 'old', `${index}`), old!);
        writeFileSync(join(folder, 'new', `${index}`), added!);
      });

      let output = '';
      try {
        output = execFileSync('git', ['diff', '--no-index', '--no-renames', '-U0', 'old', 'new'], {
          cwd: folder,
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' },
        });
      } catch (error) {
        // `git diff` exits 1 when the files differ.
        if (!(error instanceof Error && 'stdout' in error && typeof error.stdout === 'string')) {
          throw error;
        }
        output = error.stdout;
      }
      const git = new Map<number, { deleted: number; added: number; old: boolean; new: boolean }>();
      for (const section of output.split(/^diff --git /m).slice(1)) {
        const index = Number(/^a\/old\/(\d+)/.exec(section)?.[1]);
        const found = { deleted: 0, added: 0, old: false, new: false };
        let side: 'old' | 'new' | undefined;
        for (const line of section.split('\n')) {
          if (line.startsWith('---') || line.startsWith('+++')) continue;
          if (line.startsWith('-')) [found.deleted, side] = [found.deleted + 1, 'old'];
          else if (line.startsWith('+')) [found.added, side] = [found.added + 1, 'new'];
          else if (line.startsWith('\\ No newline') && side) found[side] = true;
        }
        git.set(index, found);
      }

      const differences = cases.flatMap(([old, added], index) => {
        const diff = diffText(old, added);
        const ours = {
          ...counts(diff),
          old: marksNoNewline(diff, 'old'),
          new: marksNoNewline(diff, 'new'),
        };
        const theirs = git.get(index) ?? { deleted: 0, added: 0, old: false, new: false };
        return JSON.stringify(ours) === JSON.stringify(theirs)
          ? []
          : [{ old, new: added, ours, git: theirs }];
      });
      expect(differences).toEqual([]);
    },
  );
});

describe('a fuzz', () => {
  test('rebuilds the new file from the old one and the diff, byte for byte', () => {
    const next = random(11);
    const failures: unknown[] = [];
    for (let run = 0; run < 2000; run++) {
      const alphabet = ['a', 'b', '', 'c d', ' a'];
      const old = next(10) === 0 ? undefined : file(next, alphabet, true);
      const added = next(10) === 0 ? undefined : file(next, alphabet, true);
      const diff = diffText(old, added);
      const oldLines = rawLines(old ?? '');
      const newLines = rawLines(added ?? '');
      let rebuilt = '';
      let unchangedDiffer = false;
      for (let row = 0; row < rowCount(diff); row++) {
        const lines = linesOf(diff, row);
        const block = diff.rows.find(
          ({ row: first, oldCount, newCount }) =>
            first <= row && row < first + Math.max(oldCount, newCount),
        );
        if (block?.changed) {
          if (lines.new !== undefined) rebuilt += newLines[lines.new - 1];
        } else {
          // An unchanged line is the same in both files, line break and all.
          const line = oldLines[lines.old! - 1];
          if (line !== newLines[lines.new! - 1]) unchangedDiffer = true;
          rebuilt += line;
        }
      }
      if (unchangedDiffer || rebuilt !== (added ?? '')) failures.push({ old, added, rebuilt });
    }
    expect(failures).toEqual([]);
  });
});

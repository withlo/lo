// VS Code's own diff fixtures, from `src/vs/editor/test/node/diffing/fixtures` at the commit in
// `src/vscode/README.md` (MIT, Copyright (c) Microsoft Corporation): the copied diff must give the
// changes VS Code expects. Fixtures over 10 KB are left out, and moves aren't compared, since Lo
// finds moves its own way.

import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { Range } from '../../src/vscode/editor/common/core/range.ts';
import { DefaultLinesDiffComputer } from '../../src/vscode/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts';

interface Fixture {
  name: string;
  ignoreTrimWhitespace: boolean;
  original: string;
  modified: string;
  diffs: unknown[];
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(new URL('fixtures.json', import.meta.url), 'utf8'),
);

/** A range in the format VS Code's fixtures record changes in. */
function format(range: Range, lines: readonly string[]): string {
  const toLastChar = range.endColumn === lines[range.endLineNumber - 1]!.length + 1;
  const end = `${range.endLineNumber},${range.endColumn}${toLastChar ? ' EOL' : ''}`;
  return `[${range.startLineNumber},${range.startColumn} -> ${end}]`;
}

describe("VS Code's diff fixtures", () => {
  test.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('%s', (_, fixture) => {
    const original = fixture.original.split('\n');
    const modified = fixture.modified.split('\n');
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
      ignoreTrimWhitespace: fixture.ignoreTrimWhitespace,
      maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
      computeMoves: false,
    });

    const diffs = diff.changes.map((change) => ({
      originalRange: change.original.toString(),
      modifiedRange: change.modified.toString(),
      innerChanges:
        change.innerChanges?.map((inner) => ({
          originalRange: format(inner.originalRange, original),
          modifiedRange: format(inner.modifiedRange, modified),
        })) ?? null,
    }));
    expect(diffs).toEqual(fixture.diffs);
  });
});

# VS Code's line diff

The line diff behind VS Code's diff editor, `DefaultLinesDiffComputer`, with the range classes it
needs. It's copied from [microsoft/vscode](https://github.com/microsoft/vscode) at
[`dcd3ad6e368fbe19d03f37054a40dbaf40d676f4`](https://github.com/microsoft/vscode/tree/dcd3ad6e368fbe19d03f37054a40dbaf40d676f4/src/vs),
the 1.145.3 release, and keeps the layout of its `src/vs` folder. It's under the MIT license, in
[`LICENSE.txt`](LICENSE.txt), Copyright (c) Microsoft Corporation.

The code is VS Code's, apart from these changes. Lines that differ in behavior are marked `Lo:`.

- Prettier formats it, and imports name their `.ts` files.
- Constructor parameter properties are written out as fields, and `const enum`s as objects, so a
  runtime can strip the types without compiling.
- Only what the line diff uses is here. `arrays.ts`, `assert.ts`, `errors.ts`, `charCode.ts`,
  `abstractText.ts` and `rangeMapping.ts` keep only those parts, and `computeMovedLines.ts` is left
  out: VS Code's moves are never computed, since Lo finds moves across the whole pull request.
- A failed check throws at once, where VS Code reports it later, so a caller can fall back for that
  one file.
- `extendToWords` extends every partly changed word to the whole word, as `extendToSubwords` does
  for subwords.
- The dynamic-programming diff reads the clock once a row instead of once a cell, which took about
  half the time of a large pull request's diffs.

`test/vscode/fixtures.json` holds VS Code's own fixtures for this diff, and the tests check the copy
against them. To update the copy, take the same files from a newer release, make the same changes,
and run the tests.

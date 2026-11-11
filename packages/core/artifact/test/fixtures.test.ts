/**
 * Every overview in `testing/fixtures/artifacts/`, read and checked as Lo and the checker read
 * them, gives what its `expected.json` says. Overviews in `valid/` pass the checker and show with
 * nothing broken; those in `invalid/` and `hostile/` fail it; and whatever Lo refuses whole fails
 * it too. Between them they make every finding there is.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  checkArtifact,
  FINDING_CODES,
  LIMITS,
  parseArtifact,
  type CodeReader,
} from '../src/index.ts';
import {
  CODE_COMMIT,
  commitCode,
  expectedOf,
  FIXTURES,
  folderFiles,
  gitReader,
  PR,
  type Expected,
  type FixtureInput,
} from './fixtures.ts';
import { problems } from './walker.ts';

const GROUPS = ['valid', 'invalid', 'hostile'] as const;

/** Each fixture, by its group and name. */
const fixtures = GROUPS.flatMap((group) =>
  readdirSync(join(FIXTURES, group))
    .toSorted()
    .map((name) => ({ group, name, dir: join(FIXTURES, group, name) })),
);

let code: ReturnType<typeof commitCode>;
let readCode: CodeReader;
/** The codes each fixture found. */
const seen = new Set<string>();

beforeAll(() => {
  code = commitCode();
  readCode = gitReader(code.gitDir);
});

afterAll(() => code.remove());

test('the fixtures’ code is committed with the same id every time', () => {
  expect(code.commit).toBe(CODE_COMMIT);
});

describe.each(fixtures)('$group/$name', ({ group, dir }) => {
  test('gives what expected.json says', async () => {
    const input: FixtureInput = existsSync(join(dir, 'fixture.json'))
      ? JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'))
      : {};
    const expected: Expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const files = folderFiles(dir, input);
    const stop = new AbortController();
    const artifact = await files.read('artifact.md', LIMITS.commit, stop.signal);
    const parsed = artifact.kind === 'bytes' ? parseArtifact(artifact.bytes) : undefined;
    const started = performance.now();
    const checked = await checkArtifact(parsed, files, readCode, { pr: input.ref ?? PR });
    expect(performance.now() - started).toBeLessThan(5_000);

    expect(expectedOf(checked)).toEqual(expected);
    for (const { code: found } of checked.findings) seen.add(found);

    // What any overview's check holds to.
    for (const { file, message } of checked.findings) {
      expect(file + message).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u);
    }
    const passes = checked.findings.every(({ severity }) => severity !== 'error');
    const { outcome } = checked;
    const broken =
      outcome.kind === 'shown'
        ? outcome.code.filter(({ code: each }) => each.state !== 'resolved')
        : [];
    expect(passes, 'whether the checker passes it').toBe(group === 'valid');
    expect(outcome.kind === 'shown' || !passes, 'one Lo refuses whole fails the checker').toBe(
      true,
    );
    expect(
      !passes || (outcome.kind === 'shown' && broken.length === 0),
      'one the checker passes shows in Lo with nothing broken',
    ).toBe(true);
    // An overview that passes keeps to what the format counts, too.
    expect(parsed ? problems(parsed.tree, { counts: passes }) : []).toEqual([]);
  });
});

test('every finding there is has a fixture', () => {
  // The parse's backstop, and an artifact.md its reader failed to read, can't be made by a file.
  const made = FINDING_CODES.filter((each) => each !== 'unreadable');
  expect(made.filter((each) => !seen.has(each))).toEqual([]);
});

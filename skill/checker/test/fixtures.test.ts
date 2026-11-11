/**
 * Every overview in `testing/fixtures/artifacts/` gives the same findings through the built
 * checker as through `artifact`, which Lo uses: the checker passes those in `valid/`, and fails the
 * rest. Each is written to a folder as the checker reads one, and its code is committed to a
 * repository the checker runs in.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ARTIFACT_READ, checkArtifact, parseArtifact, type CheckedArtifact } from '@lo/artifact';

import {
  CODE_COMMIT,
  commitCode,
  FIXTURES,
  materialize,
  PR,
  referenceCode,
  referenceFolder,
  type FixtureInput,
} from './fixtures.ts';
import { runJson, scratch, type Printed } from './support.ts';

const GROUPS = ['valid', 'invalid', 'hostile'] as const;

const fixtures = GROUPS.flatMap((group) =>
  readdirSync(join(FIXTURES, group))
    .toSorted()
    .map((name) => ({ group, name, dir: join(FIXTURES, group, name) })),
);

/** What `expected.json` says of the findings. */
interface Expected {
  outcome: string;
  findings: { code: string; line?: number; file?: string }[];
}

let repo: ReturnType<typeof scratch>;
let folders: ReturnType<typeof scratch>;
let commit: string;
/** The fixtures a folder can't hold all of. */
const partial: string[] = [];

beforeAll(() => {
  repo = scratch('code');
  folders = scratch('fixtures');
  commit = commitCode(repo.dir);
});

afterAll(() => {
  repo.remove();
  folders.remove();
});

test('the fixtures’ code is committed with the id their headers name', () => {
  expect(commit).toBe(CODE_COMMIT);
});

/** The findings as `expected.json` writes them. */
function asExpected(findings: Printed['findings']): Expected['findings'] {
  return findings.map(({ code, line, file }) => ({
    code,
    ...(line === undefined ? {} : { line }),
    ...(file === 'artifact.md' ? {} : { file }),
  }));
}

/** `artifact`'s check of the folder `dir`, read as Lo reads an overview's commit. */
async function reference(dir: string, pr: number): Promise<CheckedArtifact> {
  const files = referenceFolder(dir);
  const artifact = await files
    .read('artifact.md', ARTIFACT_READ, new AbortController().signal)
    .catch(() => undefined);
  const whole = artifact?.kind === 'file' && artifact.bytes.length === artifact.size;
  const parsed = whole ? parseArtifact(artifact.bytes) : undefined;
  return checkArtifact(parsed, files, referenceCode(repo.dir), { pr });
}

describe.each(fixtures)('$group/$name', ({ group, name, dir }) => {
  test('gives the same findings through the checker as through artifact', async () => {
    const input: FixtureInput = existsSync(join(dir, 'fixture.json'))
      ? JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'))
      : {};
    const folder = join(folders.dir, group, name);
    // A file no one may read is read all the same by root.
    const whole = materialize(dir, input, folder) && process.getuid?.() !== 0;
    if (!whole) partial.push(`${group}/${name}`);
    const pr = input.ref ?? PR;
    const ran = runJson(['check', folder, '--pr', String(pr)], repo.dir);

    // Through artifact, on the same folder and repository.
    const lo = await reference(folder, pr);
    expect(ran.findings).toEqual(lo.findings);
    expect(ran.outcome).toBe(lo.outcome.kind);
    const errors = ran.findings.some(({ severity }) => severity === 'error');
    expect(ran.status, `stderr: ${ran.stderr}`).toBe(
      ran.incomplete.length > 0 ? 2 : errors ? 1 : 0,
    );

    // And what artifact's own tests find, when the folder holds all the fixture does.
    const expected: Expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const found = { findings: asExpected(ran.findings), outcome: ran.outcome, passes: !errors };
    expect(whole ? found : 'partial').toEqual(
      whole
        ? { findings: expected.findings, outcome: expected.outcome, passes: group === 'valid' }
        : 'partial',
    );

    // One Lo refuses whole fails the checker; one the checker passes shows with nothing broken.
    const { outcome } = lo;
    const broken =
      outcome.kind === 'shown'
        ? [
            ...outcome.code.filter(({ code }) => code.state !== 'resolved'),
            ...outcome.figures.filter(({ figure }) => figure.state !== 'kept'),
          ]
        : [outcome.kind];
    expect(ran.status === 0 ? broken : []).toEqual([]);
  });
});

test.skipIf(process.getuid?.() === 0)('every fixture a folder can hold is held whole', () => {
  // A file without a size, and a submodule, are what only a commit can hold.
  expect(partial.toSorted()).toEqual(['hostile/unsized', 'invalid/tree-extra']);
});

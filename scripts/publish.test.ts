import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, onTestFinished, test } from 'vitest';
import { isMap, isSeq, parseDocument } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A folder that's removed when the test finishes. */
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'lo-publish-'));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/**
 * A `curl` that answers every request with the file in `$ANSWER`, written where `-o` says, or
 * fails when `$ANSWER` isn't set, so a test sees any request it didn't expect.
 */
function fakeCurl(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'curl'),
    [
      '#!/bin/sh',
      '[ -n "${ANSWER:-}" ] || { echo "unexpected request: $*" >&2; exit 7; }',
      'while [ $# -gt 0 ]; do',
      '  if [ "$1" = -o ]; then exec cp "$ANSWER" "$2"; fi',
      '  shift',
      'done',
      'exit 2',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'curl'), 0o755);
  return bin;
}

type Versions = Record<string, { deprecated?: string }>;

/** The script of publish.yml's step that chooses the dist-tag. */
function tagStep(): string {
  const workflow = parseDocument(readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8'));
  const steps = workflow.getIn(['jobs', 'publish', 'steps']);
  const step = isSeq(steps)
    ? steps.items.find((item) => isMap(item) && item.get('id') === 'tag')
    : null;
  const run: unknown = isMap(step) ? step.get('run') : null;
  if (typeof run !== 'string') throw new Error('publish.yml has no step with the id tag');
  return run;
}

/** The tag publish.yml's step chooses for `version` when npm has `versions`. */
function chooseTag(version: string, versions: Versions): string {
  const dir = folder();
  const bin = fakeCurl(dir);
  writeFileSync(join(dir, 'step.sh'), tagStep());
  writeFileSync(join(dir, 'answer.json'), JSON.stringify({ name: '@withlo/overview', versions }));
  writeFileSync(join(dir, 'output'), '');
  // As GitHub runs a step's script on Linux.
  const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'step.sh'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      ANSWER: join(dir, 'answer.json'),
      VERSION: version,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: join(dir, 'output'),
    },
  });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  return readFileSync(join(dir, 'output'), 'utf8');
}

describe("publish.yml's tag", () => {
  test.each<[string, string, Versions, string]>([
    ['a release above every release', '0.1.2', { '0.1.0': {}, '0.1.1': {} }, 'latest'],
    ['the first release', '0.1.0', {}, 'latest'],
    ['a release below the newest', '0.1.5', { '0.1.0': {}, '0.2.0': {} }, 'previous'],
    ['a release npm compares as numbers', '0.10.0', { '0.9.0': {} }, 'latest'],
    ['a prerelease', '0.2.0-rc.1', { '0.1.0': {} }, 'previous'],
    ['a release above a newer prerelease', '0.1.1', { '0.1.0': {}, '0.2.0-rc.1': {} }, 'latest'],
    [
      'a release above a newer deprecated one',
      '0.1.1',
      { '0.1.0': {}, '0.2.0': { deprecated: 'Broken; use 0.1.1.' } },
      'latest',
    ],
    [
      'a release below a newer one with an empty deprecation message',
      '0.1.1',
      { '0.1.0': {}, '0.2.0': { deprecated: '' } },
      'previous',
    ],
  ])('%s: %s', (_, version, versions, tag) => {
    expect(chooseTag(version, versions)).toBe(`tag=${tag}\n`);
  });
});

describe('overview-npm.sh', () => {
  test('refuses a version with build metadata before asking npm', () => {
    const dir = folder();
    const bin = fakeCurl(dir);
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'skill/checker'), { recursive: true });
    copyFileSync(join(root, 'scripts/overview-npm.sh'), join(dir, 'scripts/overview-npm.sh'));
    writeFileSync(
      join(dir, 'skill/checker/package.json'),
      JSON.stringify({ name: '@withlo/overview', version: '0.1.2+build' }),
    );
    for (const command of ['lookup', 'compare']) {
      const run = spawnSync('sh', ['scripts/overview-npm.sh', command], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? ''}` },
      });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toBe(
        "@withlo/overview's version, 0.1.2+build, has build metadata, which npm drops when it" +
          ' publishes.\nGive skill/checker/package.json a version without it.\n',
      );
    }
  });
});

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
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

const script = join(dirname(fileURLToPath(import.meta.url)), 'install-pnpm.sh');

/** The package of pnpm's executable for this machine, as the script names it. */
const exe = `@pnpm/exe.${process.platform}-${process.arch}`;

/** A folder that's removed when the test finishes. */
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'lo-install-pnpm-'));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** A tarball like npm's for pnpm's executable: a `package/pnpm` that says it's `version`. */
function tarball(dir: string, version: string): string {
  const source = join(dir, 'source');
  mkdirSync(join(source, 'package'), { recursive: true });
  writeFileSync(join(source, 'package', 'pnpm'), `#!/bin/sh\necho ${version}\n`);
  chmodSync(join(source, 'package', 'pnpm'), 0o755);
  const path = join(dir, 'exe.tgz');
  const made = spawnSync('tar', ['-czf', path, '-C', source, 'package'], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stderr);
  return path;
}

function integrity(path: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

/**
 * Runs install-pnpm.sh from a repository holding `pinned` in package.json and `lockfile`, with a
 * `curl` that answers with `answer` and logs each request, or fails when there's no answer.
 */
function install(options: { pinned: string; lockfile: string; answer?: string }) {
  const repo = folder();
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(script, join(repo, 'scripts', 'install-pnpm.sh'));
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ devEngines: { packageManager: { name: 'pnpm', version: options.pinned } } }),
  );
  writeFileSync(join(repo, 'pnpm-lock.yaml'), options.lockfile);
  const bin = join(repo, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'curl'),
    [
      '#!/bin/sh',
      'echo "$*" >> "$REQUESTS"',
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
  const requests = join(repo, 'requests');
  writeFileSync(requests, '');
  const dir = join(repo, 'pnpm');
  const run = spawnSync('sh', [join(repo, 'scripts', 'install-pnpm.sh'), dir], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      REQUESTS: requests,
      ...(options.answer ? { ANSWER: options.answer } : {}),
    },
  });
  return { run, dir, requests: readFileSync(requests, 'utf8') };
}

/** A lockfile that pins `pinned` for this machine's executable. */
function lockfile(version: string, pinned: string): string {
  return [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    `  '${exe}@${version}':`,
    `    resolution: {integrity: ${pinned}}`,
    '',
  ].join('\n');
}

describe('install-pnpm.sh', () => {
  test("installs pnpm's executable when its SHA-512 is the lockfile's", () => {
    const made = tarball(folder(), '12.18.0');
    const { run, dir, requests } = install({
      pinned: '12.18.0',
      lockfile: lockfile('12.18.0', integrity(made)),
      answer: made,
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(requests).toContain(`https://registry.npmjs.org/${exe}/-/`);
    expect(spawnSync(join(dir, 'pnpm'), ['--version'], { encoding: 'utf8' }).stdout).toBe(
      '12.18.0\n',
    );
    expect(existsSync(join(dir, 'pnpm.tgz'))).toBe(false);
  });

  test('refuses a download whose SHA-512 differs, and installs nothing', () => {
    const made = tarball(folder(), '12.18.0');
    const other = tarball(folder(), '12.18.0-changed');
    const { run, dir } = install({
      pinned: '12.18.0',
      lockfile: lockfile('12.18.0', integrity(other)),
      answer: made,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('pnpm-lock.yaml pins');
    expect(existsSync(join(dir, 'pnpm'))).toBe(false);
  });

  test("refuses, before downloading, when the lockfile pins nothing for this machine's pnpm", () => {
    const made = tarball(folder(), '12.18.0');
    const { run, requests } = install({
      pinned: '12.18.0',
      lockfile: lockfile('12.17.0', integrity(made)),
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`pins no SHA-512 for ${exe}@12.18.0`);
    expect(requests).toBe('');
  });

  test.each(['^12.18.0', '12', 'latest', ''])('refuses a pin that isn’t exact: "%s"', (pin) => {
    const { run, requests } = install({ pinned: pin, lockfile: lockfile('12.18.0', 'sha512-x') });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not an exact version');
    expect(requests).toBe('');
  });

  test('refuses a pnpm that says it’s another version', () => {
    const made = tarball(folder(), '12.17.0');
    const { run } = install({
      pinned: '12.18.0',
      lockfile: lockfile('12.18.0', integrity(made)),
      answer: made,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("says it's 12.17.0");
  });
});

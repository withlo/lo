import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LISTS, writeNotices } from './notices.ts';
import type { Bundled } from './notices/packages.ts';

const root = join(import.meta.dirname, '..', '..', '..');
let dist: string;

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'lo-notices-dist-'));
  for (const list of LISTS) mkdirSync(join(dist, list, '..'), { recursive: true });
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

const text = 'MIT License\n\nCopyright (c) someone';
/** A package that holds no files of its own on disk, so nothing is found in them. */
const pack = (fields: Pick<Bundled, 'name' | 'version'> & Partial<Bundled>): Bundled => ({
  dir: '/not/there',
  files: [],
  nested: [],
  ...fields,
});
const alpha = pack({ name: 'alpha', version: '1.0.0', license: 'MIT', text });
const beta = pack({ name: 'beta', version: '2.0.0', license: 'MIT', text });

/** What each bundle's build listed. */
function lists(main: Bundled[], preload: Bundled[], window: Bundled[]): void {
  const [one, two, three] = LISTS;
  writeFileSync(join(dist, one), JSON.stringify(main));
  writeFileSync(join(dist, two), JSON.stringify(preload));
  writeFileSync(join(dist, three), JSON.stringify(window));
}

describe('writeNotices', () => {
  it("writes licenses.txt from every bundle's packages, once each, with Lo's license first and the kept list after, then removes the lists", () => {
    lists([alpha, { ...beta, text: 'REACT' }], [], [beta, { ...alpha }]);
    expect(writeNotices(root, dist)).toEqual([]);
    const licenses = readFileSync(join(dist, 'licenses.txt'), 'utf8');
    expect(
      licenses.startsWith('Lo\n==\n\nCopyright © 2026 Mike Scornavacca\n\nLo is free software'),
    ).toBe(true);
    // Lo's license, in full.
    expect(licenses).toContain(
      'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007',
    );
    expect(licenses.match(/^alpha@1\.0\.0 \(MIT\)$/gm)).toHaveLength(1);
    expect(licenses.match(/^beta@2\.0\.0 \(MIT\)$/gm)).toHaveLength(1);
    expect(licenses.indexOf('alpha@1.0.0')).toBeLessThan(licenses.indexOf('beta@2.0.0'));
    // What isn't a package: the diff VS Code made, and each grammar's.
    expect(licenses).toContain('https://github.com/microsoft/vscode at dcd3ad6e');
    expect(licenses).toContain('https://github.com/tree-sitter/tree-sitter-bash at a06c2e44');
    expect(licenses).toContain(
      'Apache License\n                           Version 2.0, January 2004',
    );
    for (const list of LISTS) expect(existsSync(join(dist, list))).toBe(false);
  });

  it('writes nothing, and names each problem, when a package has no license or one Lo does not carry', () => {
    lists(
      [alpha, pack({ name: 'bad', version: '1.0.0', license: 'GPL-2.0-only', text })],
      [],
      [pack({ name: 'bare', version: '2.0.0', text })],
    );
    const problems = writeNotices(root, dist);
    expect(problems).toEqual([
      expect.stringMatching(/^bad@1\.0\.0 is under GPL-2\.0-only/),
      expect.stringMatching(/^bare@2\.0\.0 declares no license/),
    ]);
    expect(existsSync(join(dist, 'licenses.txt'))).toBe(false);
  });

  it('fails when a bundle left no list', () => {
    lists([alpha], [], [beta]);
    rmSync(join(dist, LISTS[1]));
    expect(() => writeNotices(root, dist)).toThrow(/ENOENT/);
  });
});

/** Runs `node scripts/notices.ts` on the folder `dist` names, as the build does on its own. */
function run(folder: string) {
  const script = join(import.meta.dirname, 'notices.ts');
  return spawnSync(process.execPath, [script, folder], { encoding: 'utf8' });
}

describe('the command', () => {
  it('exits 0 and writes licenses.txt when every bundled package has a license Lo carries', () => {
    lists([alpha], [], [beta]);
    const { status, stderr } = run(dist);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(existsSync(join(dist, 'licenses.txt'))).toBe(true);
  });

  it('exits 1, names each problem on stderr, and writes nothing when one does not, so the build fails', () => {
    lists(
      [alpha, pack({ name: 'bad', version: '1.0.0', license: 'GPL-2.0-only', text })],
      [],
      [beta],
    );
    const { status, stderr } = run(dist);
    expect(stderr).toMatch(/Lo can't write its notices:\n- bad@1\.0\.0 is under GPL-2\.0-only/);
    expect(status).toBe(1);
    expect(existsSync(join(dist, 'licenses.txt'))).toBe(false);
  });
});

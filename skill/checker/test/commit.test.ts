/**
 * `commit`: what it writes, exactly what was checked, on top of the pull request's local ref, and
 * nothing else. No ref, index or working tree changes, and nothing at all when the check fails.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ARTIFACT_READ, checkArtifact, parseArtifact, type OverviewFiles } from '@lo/artifact';
import { git, gitBytes } from '@lo/testing/git';

import { referenceCode } from './fixtures.ts';
import { overview, repositoryOf, runChecker, runJson, scratch } from './support.ts';

const FIGURE =
  '<svg viewBox="0 0 860 120"><rect id="box" width="10" height="5" fill="var(--fig-panel)"/></svg>\n';

let root: ReturnType<typeof scratch>;
let repo: string;
let commit: string;

beforeAll(() => {
  root = scratch('commit');
  repo = join(root.dir, 'repo');
  mkdirSync(repo);
  commit = repositoryOf(repo, { 'src/a.ts': 'one\ntwo\nthree\n', 'README.md': 'Code.\n' });
});

afterAll(() => root.remove());

let made = 0;

/** A new folder holding `files`. */
function folder(files: Readonly<Record<string, string | Uint8Array>>): string {
  const dir = join(root.dir, `overview-${made++}`);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

/** An overview showing figures/flow.svg, with a byte-order mark and CRLF to keep. */
const TEXT = `﻿${overview(
  '',
  ':::code src/a.ts#L1-L2\n:::\n\n:::figure figures/flow.svg\nA box.\n\n- [box](code:src/a.ts#L3)\n:::\n',
).replaceAll('\n', '\r\n')}`;

/** Everything about the repository besides its objects: refs, HEAD, the index and the files. */
function state(): string {
  return [
    git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
    git(repo, 'rev-parse', 'HEAD'),
    readFileSync(join(repo, '.git/index')).toString('base64'),
    git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored'),
  ].join('\n');
}

/** The objects the repository holds. */
function objects(): string {
  return git(repo, 'cat-file', '--batch-all-objects', '--batch-check');
}

/** The commit `id`'s tree, listed. */
function tree(id: string): string[] {
  return git(repo, 'ls-tree', '-r', '-t', '--full-tree', id).split('\n');
}

describe('commit', () => {
  test('writes exactly the bytes it checked, as artifact.md and figures/, and changes nothing else', () => {
    // An index with a change staged, and a file changed besides, which must stay as they are.
    writeFileSync(join(repo, 'README.md'), 'Staged.\n');
    git(repo, 'add', 'README.md');
    writeFileSync(join(repo, 'README.md'), 'Changed.\n');
    git(repo, 'update-ref', 'refs/heads/other', 'HEAD');
    const before = state();

    const text = TEXT.replace('commit: \r\n', `commit: ${commit}\r\n`);
    const dir = folder({ 'artifact.md': text, 'figures/flow.svg': FIGURE });
    const ran = runChecker(['commit', dir, '--pr', '4797'], repo);
    expect(ran.status, `stderr: ${ran.stderr}`).toBe(0);
    const id = /Committed the overview as ([0-9a-f]{40}), with no parent/.exec(ran.stdout)?.[1];
    expect(ran.stdout).toBe(
      `No errors or warnings.\n\nCommitted the overview as ${id}, with no parent, since there's no refs/lo/pr/4797 here. Push it to the pull request's repository:\n\n  git push <remote> ${id}:refs/lo/pr/4797\n`,
    );

    expect(state()).toBe(before);
    const blob = (path: string) => gitBytes(repo, ['cat-file', 'blob', `${id}:${path}`]);
    expect(blob('artifact.md').equals(Buffer.from(text))).toBe(true);
    expect(blob('figures/flow.svg').toString('utf8')).toBe(FIGURE);
    expect(tree(id!).map((line) => line.replace(/ [0-9a-f]{40}\t/, ' '))).toEqual([
      '100644 blob artifact.md',
      '040000 tree figures',
      '100644 blob figures/flow.svg',
    ]);
    const written = git(repo, 'cat-file', 'commit', id!);
    expect(written).toMatch(
      /^tree [0-9a-f]{40}\nauthor Lo test <test@lo\.invalid> \d+ [+-]\d{4}\ncommitter Lo test <test@lo\.invalid> \d+ [+-]\d{4}\n\nOverview of pull request #4797$/,
    );
  });

  test('takes the local refs/lo/pr/<n> as its parent, that ref exactly', () => {
    const text = overview(commit, 'It points at [a](code:src/a.ts#L1).\n', 12);
    const dir = folder({ 'artifact.md': text });
    const first = runJson(['commit', dir, '--pr', '12'], repo);
    expect(first).toMatchObject({ status: 0, parent: null, ref: 'refs/lo/pr/12' });
    git(repo, 'update-ref', 'refs/lo/pr/12', first.commit!);
    // Names git might take for the ref are none of them it.
    git(repo, 'update-ref', 'refs/heads/refs/lo/pr/13', first.commit!);
    git(repo, 'update-ref', 'refs/lo/pr/123', first.commit!);
    git(repo, 'update-ref', 'refs/lo/pr/1', first.commit!);

    const second = runJson(['commit', dir, '--pr', '12'], repo);
    expect(second).toMatchObject({ status: 0, parent: first.commit });
    expect(git(repo, 'rev-parse', `${second.commit}^`)).toBe(first.commit);
    // The ref is left where it was.
    expect(git(repo, 'rev-parse', 'refs/lo/pr/12')).toBe(first.commit);
    const other = runJson(
      ['commit', folder({ 'artifact.md': overview(commit, '', 13) }), '--pr', '13'],
      repo,
    );
    expect(other).toMatchObject({ status: 0, parent: null });
  });

  test('refuses a ref that isn’t a commit as the parent', () => {
    const blob = gitBytes(repo, ['hash-object', '-w', '--stdin'], 'not a commit').toString().trim();
    git(repo, 'update-ref', 'refs/lo/pr/77', blob);
    const ran = runChecker(
      ['commit', folder({ 'artifact.md': overview(commit, '', 77) }), '--pr', '77'],
      repo,
    );
    expect(ran.status).toBe(2);
    expect(ran.stderr).toBe(
      "Lo can't check the overview. refs/lo/pr/77 isn't a commit, so it can't be the new commit's parent.\n",
    );
  });

  test('writes nothing for an overview with errors, or one for another pull request', () => {
    const before = objects();
    for (const [files, pr, code] of [
      [{ 'artifact.md': overview(commit, '[a](code:src/a.ts#L9)\n') }, '4797', 'code-lines'],
      [{ 'artifact.md': overview(commit) }, '4798', 'pr-mismatch'],
      [{ 'artifact.md': overview(commit), 'notes.md': 'Notes.' }, '4797', 'tree-extra'],
    ] as const) {
      const ran = runChecker(['commit', folder(files), '--pr', pr], repo);
      expect(ran.status).toBe(1);
      expect(ran.stdout).toContain(`[${code}]`);
      expect(ran.stdout).toMatch(/error\. Nothing was committed\.\n$/);
    }
    const missing = runChecker(
      ['commit', folder({ 'artifact.md': overview('0'.repeat(40)) }), '--pr', '4797'],
      repo,
    );
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(
      /Lo couldn't check all of the overview\. Nothing was committed\.\n$/,
    );
    expect(objects()).toBe(before);
  });

  test('leaves out figures no block shows, saying so', () => {
    const text = overview(commit, ':::figure figures/a.svg\nA box.\n:::\n');
    const dir = folder({
      'artifact.md': text,
      'figures/a.svg': FIGURE,
      'figures/old.svg': '<svg><script>alert(1)</script></svg>',
    });
    const ran = runChecker(['commit', dir, '--pr', '4797'], repo);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain(
      "figures/old.svg isn't shown in artifact.md, so it's left out of the commit.\n",
    );
    const id = /as ([0-9a-f]{40})/.exec(ran.stdout)![1]!;
    expect(tree(id).map((line) => line.split('\t')[1])).toEqual([
      'artifact.md',
      'figures',
      'figures/a.svg',
    ]);
  });

  test('writes a commit Lo shows whole', async () => {
    const text = overview(
      commit,
      ':::code src/a.ts#L1-L3\n:::\n\n:::figure figures/flow.svg\nA box.\n\n- [box](code:src/a.ts#L3)\n:::\n',
    );
    const ran = runJson(
      ['commit', folder({ 'artifact.md': text, 'figures/flow.svg': FIGURE }), '--pr', '4797'],
      repo,
    );
    expect(ran.status).toBe(0);
    // Read back from the commit, through git, as Lo reads an overview's ref.
    const files = commitFiles(ran.commit!);
    const artifact = await files.read('artifact.md', ARTIFACT_READ, new AbortController().signal);
    expect(artifact.kind).toBe('file');
    const parsed = parseArtifact(artifact.kind === 'file' ? artifact.bytes : '');
    const checked = await checkArtifact(parsed, files, referenceCode(repo), { pr: 4797 });
    expect(checked.findings).toEqual([]);
    expect(checked.outcome.kind).toBe('shown');
  });
});

/** The overview's commit `id`, read through git. */
function commitFiles(id: string): OverviewFiles {
  const listing = gitBytes(repo, ['ls-tree', '-r', '-t', '-z', '-l', '--full-tree', id]);
  const records = listing.toString('utf8').split('\0').filter(Boolean);
  const entries = records.map((record) => {
    const [meta = '', path = ''] = record.split('\t');
    const [mode = '', , , size = ''] = meta.split(/ +/);
    return mode === '040000'
      ? { path: Buffer.from(path), kind: 'folder' as const }
      : { path: Buffer.from(path), kind: 'file' as const, size: Number(size) };
  });
  return {
    entries,
    read: async (path, cap) => {
      const bytes = gitBytes(repo, ['cat-file', 'blob', `${id}:${path}`]);
      return { kind: 'file', size: bytes.length, bytes: new Uint8Array(bytes.subarray(0, cap)) };
    },
  };
}

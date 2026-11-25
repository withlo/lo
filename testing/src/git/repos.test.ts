import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, expect, test } from 'vitest';

import { git, gitBytes } from './git.ts';
import { RepoServer } from './repos.ts';

const server = new RepoServer();
afterAll(() => server.remove());

/** The tree of the commit the working copy `work` is at. */
function tree(work: string): string {
  return git(work, 'rev-parse', 'HEAD^{tree}');
}

/** The message of the commit the working copy `work` is at, as stored. */
function message(work: string): string {
  const commit = gitBytes(work, ['cat-file', 'commit', 'HEAD']).toString('utf8');
  return commit.slice(commit.indexOf('\n\n') + 2);
}

test('commitFiles commits what writing the files and committing them would, and checks it out', () => {
  const files: [string, string][] = [
    ['README.md', '# changed\n'],
    ['src/lib.rs', 'pub fn a() {}\n'],
    ['src/deep/a b.txt', 'spaced\n'],
  ];
  const [written, imported] = ['written', 'imported'].map((name) =>
    server.repo('owner', name).write('README.md', '# repo\n').write('kept.txt', 'kept\n'),
  );
  if (written === undefined || imported === undefined) throw new Error('no repositories');
  const bases = [written.commit('base'), imported.commit('base')];
  for (const [path, contents] of files) written.write(path, contents);
  written.commit('head');

  const head = imported.commitFiles(files, 'head');

  expect(tree(imported.work)).toBe(tree(written.work));
  expect(git(imported.work, 'rev-parse', 'HEAD^')).toBe(bases[1]);
  expect(message(imported.work)).toBe(message(written.work));
  expect(git(imported.work, 'log', '-1', '--format=%an <%ae>')).toBe('Lo test <test@lo.invalid>');
  expect(head).toBe(imported.head());
  // The working copy is the commit, ready for the next.
  expect(git(imported.work, 'status', '--porcelain')).toBe('');
  expect(readFileSync(join(imported.work, 'src/deep/a b.txt'), 'utf8')).toBe('spaced\n');
  expect(existsSync(join(imported.work, 'kept.txt'))).toBe(true);
});

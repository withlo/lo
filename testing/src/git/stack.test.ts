import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { git } from './git.ts';
import { STACK_PULLS, writeStackRemote } from './stack.ts';

/** The stack's repository, built in a folder of its own that goes when the test ends. */
function built(): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-stack-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  expect(writeStackRemote(folder)).toBe(`file://${folder}`);
  return join(folder, 'rozed-dev', 'e2e.git');
}

const LAYERS = ['a', 'b', 'c', 'd', 'm', 'e', 'g1', 'g2'] as const;

test(
  'stack.sh makes the pull requests with the commit IDs GitHub has for them',
  { timeout: 30_000 },
  () => {
    const bare = built();
    expect(git(bare, 'rev-parse', 'refs/heads/stack/root', 'refs/heads/stack/mroot')).toBe(
      `${STACK_PULLS.root}\n${STACK_PULLS.root}`,
    );
    for (const layer of LAYERS) {
      const { number, head } = STACK_PULLS[layer];
      expect(git(bare, 'rev-parse', `refs/heads/stack/${layer}`, `refs/pull/${number}/head`)).toBe(
        `${head}\n${head}`,
      );
    }
    // #B's overview, as GitHub holds it: one commit of artifact.md, written for #B's head.
    const ref = `refs/lo/pr/${STACK_PULLS.b.number}`;
    expect(git(bare, 'rev-parse', ref)).toBe(STACK_PULLS.b.overview);
    expect(git(bare, 'ls-tree', '-r', '--name-only', ref)).toBe('artifact.md');
    expect(git(bare, 'rev-list', '--count', ref)).toBe('1');
    expect(git(bare, 'show', `${ref}:artifact.md`)).toContain(`commit: ${STACK_PULLS.b.head}`);
    // Clients may filter, and fetch any commit by ID, as from GitHub.
    expect(git(bare, 'config', 'uploadpack.allowFilter')).toBe('true');
    expect(git(bare, 'config', 'uploadpack.allowAnySHA1InWant')).toBe('true');
  },
);

test('the pull requests sit on each other as the stacks need', { timeout: 30_000 }, () => {
  const bare = built();
  const { a, b, c, d, m, e, g1, g2, root } = STACK_PULLS;
  const parent = (head: string) => git(bare, 'rev-parse', `${head}^`);
  // #A on the root; #B on #A's branch; #D on #A's branch beside #B.
  expect(parent(a.head)).toBe(root);
  expect(parent(b.head)).toBe(a.head);
  expect(parent(d.head)).toBe(a.head);
  // #C is #B's head and one more commit, so it holds #A's and #B's commits, into the root.
  expect(parent(c.head)).toBe(b.head);
  expect(git(bare, 'rev-list', '--reverse', `${root}..${c.head}`).split('\n')).toEqual([
    a.head,
    b.head,
    c.head,
  ]);
  // #M has two commits, which #E, cut from its head, still carries.
  expect(git(bare, 'rev-list', '--count', `${root}..${m.head}`)).toBe('2');
  expect(parent(e.head)).toBe(m.head);
  // #G2 on #G1, on the root.
  expect(parent(g1.head)).toBe(root);
  expect(parent(g2.head)).toBe(g1.head);
});

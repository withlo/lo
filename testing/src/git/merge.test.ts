import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { git, testGitEnvironment } from './git.ts';
import { MERGE_PULLS, mergeScript, writeMergeRemote } from './merge.ts';

const generation = MERGE_PULLS[1];
const { pulls } = generation;

/** The branch each pull request is from, under `merge/1/`. */
const BRANCHES = {
  squash: 'squash',
  merge: 'merge',
  rebase: 'rebase',
  conflict: 'conflict',
  draft: 'draft',
  stack1: 'stack-1',
  stack2: 'stack-2',
  chain1: 'chain-1',
  chain2: 'chain-2',
  moved: 'moved',
  gatedFailing: 'gated-failing',
  gatedPassing: 'gated-passing',
  queuedPass: 'queued-pass',
  queuedSlow1: 'queued-slow-1',
  queuedSlow2: 'queued-slow-2',
  queuedFail: 'queued-fail',
  overridden: 'overridden',
} as const satisfies Record<keyof typeof pulls, string>;

type Name = keyof typeof pulls;

/** The pull requests cut from commits GitHub made, which a script can't build with their IDs. */
const E4_NAMES = [
  'gatedFailing',
  'gatedPassing',
  'queuedPass',
  'queuedSlow1',
  'queuedSlow2',
  'queuedFail',
] as const satisfies readonly Name[];

/** The rest, which are the commits GitHub has. */
const NAMES = [
  'squash',
  'merge',
  'rebase',
  'conflict',
  'draft',
  'stack1',
  'stack2',
  'chain1',
  'chain2',
  'moved',
  'overridden',
] as const satisfies readonly Name[];

test('the names cover every pull request of the generation', () => {
  expect([...NAMES, ...E4_NAMES].toSorted()).toEqual(Object.keys(pulls).toSorted());
  expect(Object.keys(BRANCHES).toSorted()).toEqual(Object.keys(pulls).toSorted());
});

/** The generation's repository, built in a folder of its own that goes when the test ends. */
function built(options?: { pushed: boolean }): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-merge-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  expect(writeMergeRemote(folder, 1, options)).toBe(`file://${folder}`);
  return join(folder, 'rozed-dev', 'e2e.git');
}

/** Whether git can merge the two commits without a conflict. */
function merges(bare: string, a: string, b: string): boolean {
  try {
    git(bare, 'merge-tree', '--write-tree', a, b);
    return true;
  } catch {
    return false;
  }
}

test(
  'merge.sh makes the pull requests with the commit IDs GitHub has for them',
  { timeout: 60_000 },
  () => {
    const bare = built();
    const { base, overrideBase } = generation;
    expect(git(bare, 'rev-parse', 'refs/heads/merge/1/base')).toBe(base.tip);
    expect(git(bare, 'rev-parse', `${base.tip}^`)).toBe(base.first);
    expect(git(bare, 'rev-parse', 'refs/heads/merge/1/override')).toBe(overrideBase);
    for (const name of NAMES) {
      const { number, head } = pulls[name];
      expect(
        git(bare, 'rev-parse', `refs/heads/merge/1/${BRANCHES[name]}`, `refs/pull/${number}/head`),
      ).toBe(`${head}\n${head}`);
    }
    // Clients may filter, and fetch any commit by ID, as from GitHub.
    expect(git(bare, 'config', 'uploadpack.allowFilter')).toBe('true');
    expect(git(bare, 'config', 'uploadpack.allowAnySHA1InWant')).toBe('true');
  },
);

test(
  'the pull requests sit on each other, and conflict, as the merging features need',
  { timeout: 60_000 },
  () => {
    const bare = built();
    const { base, overrideBase } = generation;
    const parent = (head: string) => git(bare, 'rev-parse', `${head}^`);
    const commits = (from: string, head: string) =>
      Number(git(bare, 'rev-list', '--count', `${from}..${head}`));
    // Ready ones are cut from the base's tip, the squash and the rebase with two commits.
    expect(commits(base.tip, pulls.squash.head)).toBe(2);
    expect(commits(base.tip, pulls.rebase.head)).toBe(2);
    for (const name of ['merge', 'draft', 'stack1', 'chain1', 'moved'] as const) {
      expect(parent(pulls[name].head)).toBe(base.tip);
    }
    // The layers sit on each other by their base branch.
    expect(parent(pulls.stack2.head)).toBe(pulls.stack1.head);
    expect(parent(pulls.chain2.head)).toBe(pulls.chain1.head);
    expect([pulls.stack2.base, pulls.chain2.base]).toEqual(['merge/1/stack-1', 'merge/1/chain-1']);
    // Only one conflicts with the base: it's cut from the base's first commit, and changes the line
    // the base's second changed.
    expect(parent(pulls.conflict.head)).toBe(base.first);
    for (const name of NAMES.filter((each) => each !== 'overridden')) {
      expect(merges(bare, base.tip, pulls[name].head)).toBe(name !== 'conflict');
    }
    // The override pull request is on a base of its own.
    expect(parent(pulls.overridden.head)).toBe(overrideBase);
    expect(git(bare, 'rev-list', '--max-parents=0', pulls.overridden.head)).toBe(overrideBase);
  },
);

test(
  'the pull requests into the E4 branches have the changes that make ci pass, fail or wait',
  { timeout: 60_000 },
  () => {
    const bare = built();
    const stand = git(bare, 'rev-parse', 'refs/heads/e4/gated');
    expect(git(bare, 'rev-parse', 'refs/heads/e4/queued')).toBe(stand);
    const results = {
      gatedFailing: 'fail',
      gatedPassing: 'pass',
      queuedPass: 'pass',
      queuedSlow1: 'slow',
      queuedSlow2: 'slow',
      queuedFail: 'fail-in-queue',
    } as const satisfies Record<(typeof E4_NAMES)[number], string>;
    for (const name of E4_NAMES) {
      const { number, base } = pulls[name];
      const branch = `refs/heads/merge/1/${BRANCHES[name]}`;
      // One commit on the stand-in, which adds its own folder and no other.
      expect(git(bare, 'rev-parse', `refs/pull/${number}/head`)).toBe(
        git(bare, 'rev-parse', branch),
      );
      expect(git(bare, 'rev-parse', `${branch}^`)).toBe(stand);
      expect(git(bare, 'diff', '--name-status', stand, branch).split('\n')).toEqual([
        `A\tmerge/1/${BRANCHES[name]}/ci-result`,
        `A\tmerge/1/${BRANCHES[name]}/notes.md`,
      ]);
      expect(git(bare, 'show', `${branch}:merge/1/${BRANCHES[name]}/ci-result`)).toBe(
        results[name],
      );
      expect(base).toBe(name.startsWith('gated') ? 'e4/gated' : 'e4/queued');
    }
  },
);

test('every file the fixture adds is under merge/1/', { timeout: 60_000 }, () => {
  const bare = built();
  // Everything the generation's branches reach, but the stand-in for E4's commit the pull requests
  // into its branches are cut from, which GitHub holds as it is.
  const added = git(
    bare,
    'log',
    '--format=',
    '--name-only',
    '--no-renames',
    '--branches=merge/1/*',
    '--not',
    'refs/heads/e4/gated',
  )
    .split('\n')
    .filter((path) => path !== '');
  expect(added.length).toBeGreaterThan(20);
  expect(added.filter((path) => !path.startsWith('merge/1/'))).toEqual([]);
  // And what it makes is rozed-bot's, as the fixtures' are.
  expect(
    git(bare, 'log', '--format=%an <%ae>', '--branches=merge/1/*', '--not', 'refs/heads/e4/gated')
      .split('\n')
      .filter((author, at, all) => all.indexOf(author) === at),
  ).toEqual(['rozed-bot <353226052+rozed-bot@users.noreply.github.com>']);
});

test(
  '--push adds one commit to the moved pull request, and nothing else changes',
  { timeout: 60_000 },
  () => {
    const before = built();
    const after = built({ pushed: true });
    const { moved } = pulls;
    const ref = `refs/heads/merge/1/${BRANCHES.moved}`;
    expect(git(before, 'rev-parse', ref, `refs/pull/${moved.number}/head`)).toBe(
      `${moved.head}\n${moved.head}`,
    );
    expect(git(after, 'rev-parse', ref, `refs/pull/${moved.number}/head`)).toBe(
      `${generation.pushed}\n${generation.pushed}`,
    );
    expect(git(after, 'rev-parse', `${generation.pushed}^`)).toBe(moved.head);
    expect(git(after, 'diff', '--name-status', moved.head, generation.pushed)).toBe(
      'A\tmerge/1/moved/pushed.md',
    );
    // The other pull requests' heads are as they were.
    for (const name of NAMES.filter((each) => each !== 'moved')) {
      const { number, head } = pulls[name];
      expect(git(after, 'rev-parse', `refs/pull/${number}/head`)).toBe(head);
    }
  },
);

/** Runs `merge.sh` with `args`, which must stop, and returns what it said. */
function refused(args: readonly string[], env: Record<string, string> = {}): string {
  const run = spawnSync('bash', [mergeScript, ...args], {
    env: { ...testGitEnvironment(), ...env },
    encoding: 'utf8',
  });
  expect(run.status).not.toBe(0);
  return run.stderr;
}

test('merge.sh writes nothing to GitHub without rozed-bot, and builds no generation it has no numbers for', () => {
  // With no token, it stops before it reads or writes anything.
  expect(refused(['1'], { LO_FIXTURE_TOKEN_FILE: '' })).toContain('LO_FIXTURE_TOKEN_FILE');
  expect(refused(['--local', join(tmpdir(), 'lo-merge-none'), '2'])).toContain(
    "numbers of generation 2 aren't recorded",
  );
  expect(refused(['0'])).toContain('usage');
  expect(refused(['1', '--check', '--push'])).toContain('usage');
});

/** What `merge.sh` says when `push_new` is asked to push `spec`, which it must refuse. */
function refusedPush(spec: string): string {
  const run = spawnSync(
    'bash',
    ['-c', '. "$1"; generation=1; push_new "$2"', '_', mergeScript, spec],
    { env: testGitEnvironment(), encoding: 'utf8' },
  );
  expect(run.status).not.toBe(0);
  return run.stderr;
}

test('merge.sh pushes only branches under merge/<generation>/, and never replaces one', () => {
  for (const spec of [
    'merge/1/squash:refs/heads/main',
    'merge/1/squash:refs/heads/code/fork',
    'merge/1/squash:refs/heads/e4/gated',
    'merge/1/squash:refs/heads/merge/2/squash',
    'merge/1/squash:refs/heads/merge/1/../../main',
    'merge/1/squash:refs/tags/merge/1/squash',
  ]) {
    expect(refusedPush(spec)).toContain('refusing to push to');
  }
  expect(refusedPush('+merge/1/squash:refs/heads/merge/1/squash')).toContain(
    'would replace a branch',
  );
});

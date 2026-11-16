import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { git, testGitEnvironment } from './git.ts';
import {
  MERGE_E4,
  MERGE_PULLS,
  mergeScript,
  writeMergeRemote,
  type MergeGenerationNumber,
} from './merge.ts';

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

/** The pull requests into E4's bases, which are cut from commits the bundle has. */
const E4_NAMES = [
  'gatedFailing',
  'gatedPassing',
  'queuedPass',
  'queuedSlow1',
  'queuedSlow2',
  'queuedFail',
] as const satisfies readonly Name[];

/** The rest, which sit on the generation's own base. */
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

/**
 * Generation `number`'s repository, generation 1's unless it says, built in a folder of its own
 * that goes when the test ends.
 */
function built(options?: { pushed: boolean }, number: MergeGenerationNumber = 1): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-merge-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  expect(writeMergeRemote(folder, number, options)).toBe(`file://${folder}`);
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
  'merge.sh makes every pull request with the commit ID GitHub has for it, the ones into E4 included',
  { timeout: 60_000 },
  () => {
    const bare = built();
    const { base, overrideBase } = generation;
    expect(git(bare, 'rev-parse', 'refs/heads/merge/1/base')).toBe(base.tip);
    expect(git(bare, 'rev-parse', `${base.tip}^`)).toBe(base.first);
    expect(git(bare, 'rev-parse', 'refs/heads/merge/1/override')).toBe(overrideBase);
    for (const name of [...NAMES, ...E4_NAMES]) {
      const { number, head } = pulls[name];
      expect(
        git(bare, 'rev-parse', `refs/heads/merge/1/${BRANCHES[name]}`, `refs/pull/${number}/head`),
      ).toBe(`${head}\n${head}`);
    }
    // E4's bases are as GitHub had them when the bundle was made.
    expect(git(bare, 'rev-parse', 'refs/heads/e4/gated', 'refs/heads/e4/queued')).toBe(
      `${MERGE_E4.gated}\n${MERGE_E4.queued}`,
    );
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
    // Both bases hold the commit every pull request into them is cut from.
    for (const base of [MERGE_E4.gated, MERGE_E4.queued]) {
      expect(git(bare, 'merge-base', '--is-ancestor', MERGE_E4.ancestor, base)).toBe('');
    }
    const results = {
      gatedFailing: 'fail',
      gatedPassing: 'pass',
      queuedPass: 'pass',
      queuedSlow1: 'slow',
      queuedSlow2: 'slow',
      queuedFail: 'fail-in-queue',
    } as const satisfies Record<(typeof E4_NAMES)[number], string>;
    for (const name of E4_NAMES) {
      const { head, base } = pulls[name];
      const folder = `merge/1/${BRANCHES[name]}`;
      // One commit on that commit, which adds its own folder and no other.
      expect(git(bare, 'rev-parse', `${head}^`)).toBe(MERGE_E4.ancestor);
      expect(git(bare, 'diff', '--name-status', MERGE_E4.ancestor, head).split('\n')).toEqual([
        `A\t${folder}/ci-result`,
        `A\t${folder}/notes.md`,
      ]);
      expect(git(bare, 'show', `${head}:${folder}/ci-result`)).toBe(results[name]);
      expect(base).toBe(name.startsWith('gated') ? 'e4/gated' : 'e4/queued');
    }
  },
);

test('every file the fixture adds is under merge/1/', { timeout: 60_000 }, () => {
  const bare = built();
  // Everything the generation's branches reach, but the history of E4's bases that the pull
  // requests into them are cut from, which GitHub made.
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
    for (const name of [...NAMES, ...E4_NAMES].filter((each) => each !== 'moved')) {
      const { number, head } = pulls[name];
      expect(git(after, 'rev-parse', `refs/pull/${number}/head`)).toBe(head);
    }
  },
);

test(
  'generation 2 is made with the commit IDs github has for it, pushed or not',
  { timeout: 120_000 },
  () => {
    const second = MERGE_PULLS[2];
    const bare = built(undefined, 2);
    expect(git(bare, 'rev-parse', 'refs/heads/merge/2/base', 'refs/heads/merge/2/override')).toBe(
      `${second.base.tip}\n${second.overrideBase}`,
    );
    expect(git(bare, 'rev-parse', `${second.base.tip}^`)).toBe(second.base.first);
    for (const name of [...NAMES, ...E4_NAMES]) {
      const { number, head, base } = second.pulls[name];
      expect(
        git(bare, 'rev-parse', `refs/heads/merge/2/${BRANCHES[name]}`, `refs/pull/${number}/head`),
      ).toBe(`${head}\n${head}`);
      // Into the same branch as generation 1's, under the generation's own name.
      expect(base).toBe(pulls[name].base.replace('merge/1/', 'merge/2/'));
    }
    const after = built({ pushed: true }, 2);
    expect(git(after, 'rev-parse', 'refs/heads/merge/2/moved', `${second.pushed}^`)).toBe(
      `${second.pushed}\n${second.pulls.moved.head}`,
    );
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
  expect(refused(['--local', join(tmpdir(), 'lo-merge-none'), '3'])).toContain(
    "numbers of generation 3 aren't recorded",
  );
  // Nor in a folder inside a work tree, where what it builds would be taken for the repository's.
  expect(refused(['--local', join(dirname(mergeScript), 'merge-none'), '1'])).toContain(
    'is inside the git work tree',
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
  // Nor deletes one, even one of the generation's own.
  expect(refusedPush(':refs/heads/merge/1/squash')).toContain('would delete a branch');
  expect(refusedPush(':refs/heads/main')).toContain('would delete a branch');
  expect(refusedPush('merge/1/squash:refs/heads/merge/1/squash:refs/heads/main')).toContain(
    'refusing to push',
  );
});

test('the one ruleset merge.sh makes covers only the override bases, and an admin may always bypass it', () => {
  const run = spawnSync(
    'bash',
    ['-c', '. "$1"; printf %s "$OVERRIDE_RULESET_JSON"', '_', mergeScript],
    { env: testGitEnvironment(), encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  const ruleset: unknown = JSON.parse(run.stdout);
  expect(ruleset).toMatchObject({
    name: 'Merge override',
    target: 'branch',
    enforcement: 'active',
    // Only the branches `merge/<generation>/override`, and no exception.
    conditions: { ref_name: { include: ['refs/heads/merge/*/override'], exclude: [] } },
    // GitHub offers an admin the merge past a rule only when it's always theirs to bypass.
    bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
    rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1 } }],
  });
});

import { expect, test } from 'vitest';

import { reviewRules, snapshot } from '../../test/snapshot.ts';
import type { CheckState, MergeSnapshot, RequiredCheck, UnmetRule } from '../merge.ts';
import { blockers, isWait, mayNotSeeEveryRule, type Blocker } from './blockers.ts';

const URL = 'https://github.com/rozed-dev/playground/pull/7';

function ready(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return snapshot({ url: URL, mergeable: 'MERGEABLE', mergeState: 'CLEAN', ...fields });
}

function blocked(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return ready({ mergeState: 'BLOCKED', ...fields });
}

function check(name: string, state: CheckState): RequiredCheck {
  return {
    name,
    state,
    url: state === 'missing' ? undefined : `https://github.com/rozed-dev/playground/runs/${name}`,
  };
}

function rule(description: string, waiting: boolean): UnmetRule {
  return { description, url: undefined, waiting };
}

function failing(name: string, state: CheckState): Blocker {
  return { kind: 'check', check: check(name, state) };
}

function notReported(name: string): Blocker {
  return { kind: 'notReported', check: check(name, 'missing') };
}

test('a pull request that can merge has no blockers', () => {
  for (const mergeState of ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'] as const) {
    expect(blockers(ready({ mergeState }))).toEqual([]);
  }
});

test('a merged pull request is blocked only by being merged', () => {
  const merged = ready({ state: 'MERGED', mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' });

  expect(blockers(merged)).toEqual([{ kind: 'merged' }]);
});

test('a closed pull request is blocked only by being closed', () => {
  const closed = ready({ state: 'CLOSED', draft: true, mergeable: 'CONFLICTING' });

  expect(blockers(closed)).toEqual([{ kind: 'closed' }]);
});

test('a draft is blocked until it is marked ready', () => {
  expect(blockers(blocked({ draft: true }))).toEqual([{ kind: 'draft' }]);
});

test('the draft merge state rest reports is a draft', () => {
  expect(blockers(ready({ mergeState: 'DRAFT' }))).toEqual([{ kind: 'draft' }]);
});

test('a pull request github says conflicts is blocked by conflicts', () => {
  expect(blockers(ready({ mergeable: 'CONFLICTING' }))).toEqual([{ kind: 'conflicts' }]);
  expect(blockers(ready({ mergeState: 'DIRTY' }))).toEqual([{ kind: 'conflicts' }]);
});

test('a pull request github says is behind is out of date', () => {
  expect(blockers(ready({ mergeState: 'BEHIND' }))).toEqual([{ kind: 'outOfDate' }]);
});

test('the caller can say it is out of date when github reports another block', () => {
  const behind = blocked({ outOfDate: 'yes', requiredChecks: [check('build', 'failed')] });

  expect(blockers(behind)).toEqual([{ kind: 'outOfDate' }, failing('build', 'failed')]);
});

test('being behind does not block joining a merge queue', () => {
  const queue = { required: true, method: undefined, inQueue: false, position: undefined };

  expect(blockers(ready({ outOfDate: 'yes', queue }))).toEqual([]);
  expect(blockers(ready({ mergeState: 'BEHIND', queue }))).toEqual([]);
});

test('each required check that has not passed blocks it', () => {
  const checks = blocked({
    requiredChecks: [
      check('build', 'failed'),
      check('lint', 'passed'),
      check('test', 'running'),
      check('deploy-preview', 'missing'),
      check('docs', 'failed'),
    ],
  });

  expect(blockers(checks)).toEqual([
    failing('build', 'failed'),
    failing('docs', 'failed'),
    failing('test', 'running'),
    failing('deploy-preview', 'missing'),
  ]);
});

test('every check under a required name must pass', () => {
  // A check run and a commit status both named `build`: GitHub requires both.
  const both = blocked({ requiredChecks: [check('build', 'passed'), check('build', 'failed')] });

  expect(blockers(both)).toEqual([failing('build', 'failed')]);
});

test('a check that has not reported is a wait while something on the head can report it', () => {
  const pending = blocked({ requiredChecks: [check('e2e', 'missing')], checksPending: true });

  const found = blockers(pending);
  expect(found).toEqual([failing('e2e', 'missing')]);
  expect(found.every(isWait)).toBe(true);
});

test('a running required check means something can still report', () => {
  const running = blocked({ requiredChecks: [check('e2e', 'missing'), check('test', 'running')] });

  expect(blockers(running)).toEqual([failing('test', 'running'), failing('e2e', 'missing')]);
});

test('a check nothing on the head will report blocks it until someone acts', () => {
  // A workflow its paths skipped, a renamed job, or an app that didn't run.
  const unreported = blocked({
    requiredChecks: [check('build', 'passed'), check('e2e', 'missing'), check('lint', 'failed')],
  });

  const found = blockers(unreported);
  expect(found).toEqual([failing('lint', 'failed'), notReported('e2e')]);
  expect(found.map(isWait)).toEqual([false, false]);
});

test('a deployment awaiting approval is its own wait', () => {
  const deployment = blocked({
    requiredChecks: [check('test', 'running'), check('deploy', 'awaitingApproval')],
    reviewDecision: 'REVIEW_REQUIRED',
    rules: reviewRules({ requiredApprovals: 1 }),
  });

  const found = blockers(deployment);
  expect(found).toEqual([
    { kind: 'approvals', more: 1, codeOwners: [] },
    failing('deploy', 'awaitingApproval'),
    failing('test', 'running'),
  ]);
  expect(found.every(isWait)).toBe(true);
});

test('unresolved conversations block it when the rules require resolving them', () => {
  const unresolved = blocked({
    unresolvedThreads: 3,
    rules: reviewRules({ conversationResolution: true }),
  });

  expect(blockers(unresolved)).toEqual([{ kind: 'conversations', unresolved: 3 }]);
});

test('approvals the rules want block it when github says blocked with no decision', () => {
  // A COMMENT review left GitHub's decision null, and the approval still missing.
  const rules = reviewRules({ requiredApprovals: 1, conversationResolution: true });
  const undecided = blocked({ unresolvedThreads: 1, rules });
  expect(undecided.reviewDecision).toBeUndefined();

  expect(blockers(undecided)).toEqual([
    { kind: 'conversations', unresolved: 1 },
    { kind: 'approvals', more: 1, codeOwners: [] },
  ]);
  // Where GitHub lets it merge, GitHub's verdict stands.
  expect(blockers(ready({ rules }))).toEqual([]);
  // And rules that want no approval add none.
  const noReviews = blocked({
    unresolvedThreads: 1,
    rules: reviewRules({ conversationResolution: true }),
  });
  expect(blockers(noReviews)).toEqual([{ kind: 'conversations', unresolved: 1 }]);
});

test('a suite running while it conflicts reports no required check', () => {
  // A run started by hand still runs on a head that conflicts: GitHub runs no pull request
  // workflow then, so `ci` can't report.
  const conflicting = ready({
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
    checksPending: true,
    requiredChecks: [check('ci', 'missing')],
  });
  expect(blockers(conflicting)).toEqual([{ kind: 'conflicts' }, notReported('ci')]);
  // Without the conflict, it may still report.
  const clean = { ...conflicting, mergeable: 'MERGEABLE', mergeState: 'BLOCKED' } as const;
  expect(blockers(clean)).toEqual([failing('ci', 'missing')]);
});

test('unresolved conversations do not block it otherwise', () => {
  expect(blockers(ready({ unresolvedThreads: 3 }))).toEqual([]);
});

test('resolved conversations do not block it', () => {
  expect(blockers(ready({ rules: reviewRules({ conversationResolution: true }) }))).toEqual([]);
});

test('unmet rules block it', () => {
  const unmet = blocked({
    unmetRules: [
      rule('Deployment to staging must succeed', true),
      rule('Commits must be signed', false),
    ],
  });

  expect(blockers(unmet)).toEqual([
    { kind: 'rule', rule: rule('Commits must be signed', false) },
    { kind: 'rule', rule: rule('Deployment to staging must succeed', true) },
  ]);
});

test('github still working out mergeability is a blocker', () => {
  const unknown = ready({ mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' });
  const unknownState = ready({ mergeState: 'UNKNOWN' });

  expect(blockers(unknown)).toEqual([{ kind: 'checkingMergeability' }]);
  expect(blockers(unknownState)).toEqual([{ kind: 'checkingMergeability' }]);
});

test('a block nothing explains links to the pull request', () => {
  expect(blockers(blocked())).toEqual([{ kind: 'unexplained', url: URL }]);
});

test('a block is unexplained while github works out mergeability', () => {
  expect(blockers(blocked({ mergeable: 'UNKNOWN' }))).toEqual([
    { kind: 'unexplained', url: URL },
    { kind: 'checkingMergeability' },
  ]);
});

test('a block a waiting blocker explains is not unexplained', () => {
  const running = blocked({ requiredChecks: [check('test', 'running')] });

  expect(blockers(running)).toEqual([failing('test', 'running')]);
});

test('lo may not see every rule behind a block it explains in part', () => {
  // An unsigned commit or a required workflow Lo wasn't told about, beside a running check: the
  // running check is only part of why.
  const partial = blocked({ requiredChecks: [check('test', 'running')] });

  expect(mayNotSeeEveryRule(partial)).toBe(true);
});

test('lo sees every rule when the caller says so or github does not block', () => {
  const seen = blocked({ requiredChecks: [check('test', 'running')], seesEveryRule: true });
  const unexplained = blocked();
  const conflicting = ready({ mergeState: 'DIRTY', requiredChecks: [check('test', 'running')] });
  const merged = { ...seen, state: 'MERGED' } as const;

  const unsure = [seen, unexplained, conflicting, ready(), merged].filter(mayNotSeeEveryRule);
  expect(unsure).toEqual([]);
});

test('lo may not see every rule when it cannot tell whether the head is out of date', () => {
  const unsure = blocked({
    requiredChecks: [check('test', 'running')],
    seesEveryRule: true,
    outOfDate: 'unknown',
  });

  // Not knowing isn't a blocker, but being behind may be part of why it's blocked.
  expect(blockers(unsure)).toEqual([failing('test', 'running')]);
  expect(mayNotSeeEveryRule(unsure)).toBe(true);
});

test('blockers waiting will not fix come first', () => {
  const mixed = ready({
    draft: true,
    mergeable: 'UNKNOWN',
    mergeState: 'UNKNOWN',
    requiredChecks: [check('test', 'running'), check('build', 'failed')],
    unresolvedThreads: 1,
    rules: reviewRules({ conversationResolution: true }),
    unmetRules: [rule('Deployment to staging must succeed', true)],
  });

  expect(blockers(mixed)).toEqual([
    { kind: 'draft' },
    failing('build', 'failed'),
    { kind: 'conversations', unresolved: 1 },
    failing('test', 'running'),
    { kind: 'rule', rule: rule('Deployment to staging must succeed', true) },
    { kind: 'checkingMergeability' },
  ]);
});

test('running awaiting and missing checks are waits', () => {
  expect(isWait(failing('test', 'running'))).toBe(true);
  expect(isWait(failing('deploy', 'awaitingApproval'))).toBe(true);
  expect(isWait(failing('test', 'missing'))).toBe(true);
  expect(isWait(failing('test', 'failed'))).toBe(false);
  expect(isWait(notReported('test'))).toBe(false);
});

test('a rule is a wait when it says so', () => {
  expect(isWait({ kind: 'rule', rule: rule('Deployment to staging must succeed', true) })).toBe(
    true,
  );
  expect(isWait({ kind: 'rule', rule: rule('Commits must be signed', false) })).toBe(false);
});

test('github working out mergeability is a wait', () => {
  expect(isWait({ kind: 'checkingMergeability' })).toBe(true);
});

test('blockers someone must act on are not waits', () => {
  const acts: Blocker[] = [
    { kind: 'merged' },
    { kind: 'closed' },
    { kind: 'draft' },
    { kind: 'conflicts' },
    { kind: 'outOfDate' },
    { kind: 'conversations', unresolved: 1 },
    { kind: 'unexplained', url: URL },
  ];

  expect(acts.filter(isWait)).toEqual([]);
});

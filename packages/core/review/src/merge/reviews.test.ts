import { unchecked } from '@lo/github';
import { expect, test } from 'vitest';

import { reviewRules, snapshot } from '../../test/snapshot.ts';
import type { MergeSnapshot, Review, ReviewRequest, Reviewer, ReviewRules } from '../merge.ts';
import { blockers, isWait, type Blocker } from './blockers.ts';
import type { ReviewDecision, ReviewState } from './github.ts';

function deciding(decision: ReviewDecision, fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return snapshot({
    mergeable: 'MERGEABLE',
    mergeState: 'BLOCKED',
    reviewDecision: decision,
    ...fields,
  });
}

function review(author: string, state: ReviewState): Review {
  return { author, state, commit: '9f2c4e1', counts: true, onBehalfOf: [] };
}

function withoutWriteAccess(given: Review): Review {
  return { ...given, counts: false };
}

function codeOwner(reviewer: Reviewer): ReviewRequest {
  return { reviewer, asCodeOwner: true };
}

function user(login: string): Reviewer {
  return { kind: 'user', login };
}

function team(slug: string): Reviewer {
  return { kind: 'team', slug };
}

function requiring(approvals: number): ReviewRules {
  return reviewRules({ requiredApprovals: approvals });
}

function requiringCodeOwners(approvals: number): ReviewRules {
  return { ...requiring(approvals), codeOwnerReview: true };
}

function changesRequested(by: string[]): Blocker {
  return { kind: 'changesRequested', by };
}

function missing(more: number, codeOwners: Reviewer[]): Blocker {
  return { kind: 'approvals', more, codeOwners };
}

test('requested changes block it and name who requested them', () => {
  const requested = deciding('CHANGES_REQUESTED', {
    reviews: [
      review('alice', 'CHANGES_REQUESTED'),
      review('bob', 'APPROVED'),
      withoutWriteAccess(review('carol', 'CHANGES_REQUESTED')),
      review('dave', 'DISMISSED'),
      review('erin', 'CHANGES_REQUESTED'),
    ],
    rules: requiring(1),
  });

  expect(blockers(requested)).toEqual([changesRequested(['alice', 'erin'])]);
});

test('requested changes do not block it when the rules do not require reviews', () => {
  const unrequired = deciding('CHANGES_REQUESTED', {
    mergeState: 'CLEAN',
    reviewDecision: undefined,
    reviews: [review('alice', 'CHANGES_REQUESTED')],
  });

  expect(blockers(unrequired)).toEqual([]);
});

test('a reviewers later review replaces their earlier one', () => {
  const replaced = deciding('CHANGES_REQUESTED', {
    reviews: [
      review('alice', 'CHANGES_REQUESTED'),
      review('bob', 'CHANGES_REQUESTED'),
      review('alice', 'APPROVED'),
    ],
    rules: requiring(2),
  });

  expect(blockers(replaced)).toEqual([changesRequested(['bob']), missing(1, [])]);
});

test('missing approvals say how many more are needed', () => {
  const short = deciding('REVIEW_REQUIRED', {
    reviews: [review('alice', 'APPROVED'), withoutWriteAccess(review('carol', 'APPROVED'))],
    rules: requiring(3),
  });

  expect(blockers(short)).toEqual([missing(2, [])]);
});

test('missing approvals name code owners who have not approved', () => {
  const owners = deciding('REVIEW_REQUIRED', {
    reviews: [review('alice', 'APPROVED')],
    reviewRequests: [
      codeOwner(user('erin')),
      { reviewer: user('frank'), asCodeOwner: false },
      codeOwner(team('rozed-dev/github')),
    ],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(owners)).toEqual([missing(0, [user('erin'), team('rozed-dev/github')])]);
});

test('a code owner who approved is not missing', () => {
  const approved = deciding('REVIEW_REQUIRED', {
    reviews: [review('Erin', 'APPROVED')],
    reviewRequests: [codeOwner(user('erin')), codeOwner(user('grace'))],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(approved)).toEqual([missing(0, [user('grace')])]);
});

test('an approval on behalf of a team covers its request', () => {
  const onBehalf = deciding('REVIEW_REQUIRED', {
    reviews: [{ ...review('heidi', 'APPROVED'), onBehalfOf: ['rozed-dev/github'] }],
    reviewRequests: [codeOwner(team('rozed-dev/github')), codeOwner(team('rozed-dev/ui'))],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(onBehalf)).toEqual([missing(0, [team('rozed-dev/ui')])]);
});

test('an approval without write access covers no code owner', () => {
  const reader = deciding('REVIEW_REQUIRED', {
    reviews: [withoutWriteAccess(review('erin', 'APPROVED'))],
    reviewRequests: [codeOwner(user('erin'))],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(reader)).toEqual([missing(1, [user('erin')])]);
});

test('code owners are not missing when the rules do not require their review', () => {
  const unrequired = deciding('REVIEW_REQUIRED', {
    reviews: [review('alice', 'APPROVED')],
    reviewRequests: [codeOwner(user('erin'))],
    rules: requiring(2),
  });

  expect(blockers(unrequired)).toEqual([missing(1, [])]);
});

test('a review github requires for a reason lo cannot see is still missing', () => {
  const unattributed = deciding('REVIEW_REQUIRED', {
    reviews: [review('alice', 'APPROVED')],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(unattributed)).toEqual([missing(0, [])]);
});

test('github approving wins over the reviews', () => {
  const approved = deciding('APPROVED', {
    mergeState: 'CLEAN',
    reviews: [review('alice', 'APPROVED')],
    reviewRequests: [codeOwner(user('erin'))],
    rules: requiringCodeOwners(2),
  });

  expect(blockers(approved)).toEqual([]);
});

test('requested changes list missing approvals only when some are', () => {
  const requested = deciding('CHANGES_REQUESTED', {
    reviews: [review('alice', 'CHANGES_REQUESTED'), review('bob', 'APPROVED')],
    rules: requiring(1),
  });

  expect(blockers(requested)).toEqual([changesRequested(['alice'])]);
});

test('review blockers come in their groups', () => {
  const draft = deciding('CHANGES_REQUESTED', {
    draft: true,
    reviews: [review('alice', 'CHANGES_REQUESTED')],
    rules: requiring(1),
  });

  expect(blockers(draft)).toEqual([{ kind: 'draft' }, changesRequested(['alice']), missing(1, [])]);
});

test('missing approvals are a wait and requested changes are not', () => {
  expect(isWait(missing(1, [user('erin')]))).toBe(true);
  expect(isWait(changesRequested(['alice']))).toBe(false);
});

test('a request for a reviewer without a login is covered by no approval', () => {
  // A request GitHub gave in a shape newer than Lo.
  const nobody = unchecked<Reviewer>({ kind: 'user' });
  const unnamed = deciding('REVIEW_REQUIRED', {
    reviews: [review('alice', 'APPROVED')],
    reviewRequests: [codeOwner(nobody)],
    rules: requiringCodeOwners(1),
  });

  expect(blockers(unnamed)).toEqual([missing(0, [nobody])]);
});

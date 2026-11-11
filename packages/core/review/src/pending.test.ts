import type { DraftPullRequestReviewThread } from '@lo/github';
import { expect, test } from 'vitest';

import { UnknownValue } from './enums.ts';
import {
  pendingReviewFrom,
  readReviewEvent,
  reviewChoices,
  sendsComment,
  YourReview,
  type Mutation,
  type NewReply,
  type NewThread,
  type PendingReview,
  type ReviewEvent,
  yourReview,
} from './pending.ts';

/** The pull request's node ID. */
const PULL = 'PR_kwDO1';

/** Revisions r1 to r3 have heads `a1` to `a3`; `a3` is the latest. */
const HEAD = 'a3';

function thread(body: string): NewThread {
  return {
    kind: 'thread',
    path: 'src/parse.rs',
    lines: { end: { side: 'RIGHT', number: 12 } },
    body,
  };
}

function file(body: string): NewThread {
  return { kind: 'thread', path: 'README.md', body };
}

function reply(body: string): NewReply {
  return { kind: 'reply', thread: 'PRRT_9', body };
}

function none(): YourReview {
  return new YourReview(PULL);
}

function pending(commit: string, comments: number): YourReview {
  return new YourReview(PULL, { id: 'PRR_1', commit, comments });
}

/** `addPullRequestReview`'s draft thread for {@link thread}'s line comment. */
function draft(body: string): DraftPullRequestReviewThread {
  return {
    path: 'src/parse.rs',
    body,
    line: 12,
    side: 'RIGHT',
    startLine: undefined,
    startSide: undefined,
  };
}

/** Starting your pending review on `commit`, with {@link thread}'s comment `body` in it if any. */
function startReview(commit: string, body?: string): Mutation {
  return {
    kind: 'startReview',
    head: HEAD,
    variables: {
      pullRequestId: PULL,
      commitOID: commit,
      event: undefined,
      body: undefined,
      threads: body === undefined ? undefined : [draft(body)],
    },
  };
}

function addThread(body: string): Mutation {
  return {
    kind: 'addThread',
    head: HEAD,
    variables: {
      pullRequestReviewId: 'PRR_1',
      path: 'src/parse.rs',
      body,
      subjectType: 'LINE',
      line: 12,
      side: 'RIGHT',
      startLine: undefined,
      startSide: undefined,
    },
  };
}

function addFileThread(body: string): Mutation {
  return {
    kind: 'addThread',
    head: HEAD,
    variables: {
      pullRequestReviewId: 'PRR_1',
      path: 'README.md',
      body,
      subjectType: 'FILE',
      line: undefined,
      side: undefined,
      startLine: undefined,
      startSide: undefined,
    },
  };
}

function addReply(body: string): Mutation {
  return {
    kind: 'addReply',
    head: HEAD,
    variables: { pullRequestReviewThreadId: 'PRRT_9', body, pullRequestReviewId: 'PRR_1' },
  };
}

function postThread(commit: string, body: string): Mutation {
  return {
    kind: 'postThread',
    head: HEAD,
    variables: {
      pullRequestId: PULL,
      commitOID: commit,
      event: 'COMMENT',
      body: undefined,
      threads: [draft(body)],
    },
  };
}

function postReply(body: string): Mutation {
  return {
    kind: 'postReply',
    head: HEAD,
    variables: { pullRequestReviewThreadId: 'PRRT_9', body, pullRequestReviewId: undefined },
  };
}

function submitReview(event: ReviewEvent, body?: string): Mutation {
  return {
    kind: 'submitReview',
    head: HEAD,
    variables: { pullRequestReviewId: 'PRR_1', event, body },
  };
}

function review(commit: string, event: ReviewEvent, body?: string): Mutation {
  return {
    kind: 'review',
    head: HEAD,
    variables: { pullRequestId: PULL, commitOID: commit, event, body, threads: undefined },
  };
}

/** The mutation `planned` is, failing the test if it's a refusal. */
function planned(result: Mutation | { refusal: string }): Mutation {
  if ('refusal' in result) throw new Error(`refused: ${result.refusal}`);
  return result;
}

test('the first comment starts a pending review on the revision on screen', () => {
  expect(none().add('a3', HEAD, thread('Off by one?'))).toEqual(startReview('a3', 'Off by one?'));
});

test('later comments join the pending review and count', () => {
  const yours = none();
  const start = planned(yours.add('a3', HEAD, thread('Off by one?')));
  yours.accepted(start, 'PRR_1');

  expect(yours.pending).toEqual({ id: 'PRR_1', commit: 'a3', comments: 1 });

  const add = planned(yours.add('a3', HEAD, thread('And here.')));
  expect(add).toEqual(addThread('And here.'));
  yours.accepted(add);

  const answer = planned(yours.add('a3', HEAD, reply('Agreed.')));
  expect(answer).toEqual(addReply('Agreed.'));
  yours.accepted(answer);

  expect(yours.pendingComments).toBe(3);
});

test('a reply as the first comment starts an empty review then joins it', () => {
  const yours = none();
  // From any revision, the review starts on the latest head: a reply has no revision.
  const start = planned(yours.add('a1', HEAD, reply('Agreed.')));
  expect(start).toEqual(startReview('a3'));
  expect(sendsComment(start)).toBe(false);
  yours.accepted(start, 'PRR_1');
  expect(yours.pendingComments).toBe(0);

  const answer = planned(yours.add('a1', HEAD, reply('Agreed.')));
  expect(answer).toEqual(addReply('Agreed.'));
  expect(sendsComment(answer)).toBe(true);
  yours.accepted(answer);
  expect(yours.pendingComments).toBe(1);
});

test('a file level first comment starts an empty review then adds its thread', () => {
  // `addPullRequestReview`'s threads can't be file-level.
  const yours = none();
  const start = planned(yours.add('a2', HEAD, file('Needs a changelog entry.')));
  expect(start).toEqual(startReview('a3'));
  yours.accepted(start, 'PRR_1');

  expect(yours.add('a2', HEAD, file('Needs a changelog entry.'))).toEqual(
    addFileThread('Needs a changelog entry.'),
  );
});

test('a file level comment joins a pending review from any revision', () => {
  expect(pending('a3', 1).add('a1', HEAD, file('Needs a changelog entry.'))).toEqual(
    addFileThread('Needs a changelog entry.'),
  );
});

test('an empty review whose first comment failed has nothing to submit', () => {
  const yours = none();
  const start = planned(yours.add('a3', HEAD, reply('Agreed.')));
  yours.accepted(start, 'PRR_1');
  // GitHub refused the reply, so it's never accepted.
  planned(yours.add('a3', HEAD, reply('Agreed.')));

  expect(yours.pendingComments).toBe(0);
  expect(yours.submit('COMMENT', '', false, 'a3', HEAD)).toEqual({ refusal: 'nothingToSubmit' });
});

test('a new thread joins a pending review on any revision from the latest head', () => {
  // GitHub puts it on the latest head, whatever revision the review was started on.
  expect(pending('a2', 1).add('a3', HEAD, thread('Off by one?'))).toEqual(addThread('Off by one?'));
});

test('a new line thread on an older revision does not join the pending review', () => {
  // It would land on the latest head's line of that number, so the UI offers to submit the
  // pending review or to switch to the latest revision.
  const notLatest = { refusal: 'notLatest', head: 'a3' };

  expect(pending('a3', 1).add('a2', HEAD, thread('Off by one?'))).toEqual(notLatest);
  // Even on the revision the review was started on.
  expect(pending('a2', 1).add('a2', HEAD, thread('Off by one?'))).toEqual(notLatest);
});

test('a reply joins the pending review from any revision', () => {
  for (const on of ['a1', 'a2', 'a3']) {
    expect(pending('a2', 1).add(on, HEAD, reply('Agreed.'))).toEqual(addReply('Agreed.'));
  }
});

test('without a pending review a line comment on an older revision starts one there', () => {
  // `addPullRequestReview`'s threads are on its `commitOID`.
  expect(none().add('a2', HEAD, thread('Off by one?'))).toEqual(startReview('a2', 'Off by one?'));
});

test('a blank comment is refused', () => {
  const blank = { refusal: 'blank' };
  expect(none().add('a3', HEAD, thread(' \n\t'))).toEqual(blank);
  expect(pending('a3', 1).add('a3', HEAD, reply(''))).toEqual(blank);
  expect(none().post('a3', HEAD, thread(''))).toEqual(blank);
});

test('c posts one comment at once without a pending review', () => {
  const yours = none();

  expect(yours.post('a3', HEAD, thread('Off by one?'))).toEqual({
    mutation: postThread('a3', 'Off by one?'),
    pending: false,
  });
  expect(yours.post('a3', HEAD, reply('Agreed.'))).toEqual({
    mutation: postReply('Agreed.'),
    pending: false,
  });
  // On an older revision, a line comment is posted on that revision.
  expect(yours.post('a2', HEAD, thread('Off by one?'))).toEqual({
    mutation: postThread('a2', 'Off by one?'),
    pending: false,
  });
});

test('c on a file posts a file comment through rest', () => {
  expect(none().post('a2', HEAD, file('Needs a changelog entry.'))).toEqual({
    mutation: {
      kind: 'postFileComment',
      head: HEAD,
      body: {
        commit_id: 'a2',
        path: 'README.md',
        body: 'Needs a changelog entry.',
        subject_type: 'file',
      },
    },
    pending: false,
  });
  expect(pending('a3', 1).post('a2', HEAD, file('Needs a changelog entry.'))).toEqual({
    mutation: addFileThread('Needs a changelog entry.'),
    pending: true,
  });
});

test('every mutation but an empty start or a submission sends the comment', () => {
  const sends = sendsComment;

  expect(sends(startReview('a3', 'Off by one?'))).toBe(true);
  expect(sends(startReview('a3'))).toBe(false);
  expect(sends(addThread('Off by one?'))).toBe(true);
  expect(sends(addReply('Agreed.'))).toBe(true);
  expect(sends(postThread('a3', 'Off by one?'))).toBe(true);
  expect(
    sends({
      kind: 'postFileComment',
      head: HEAD,
      body: { commit_id: 'a3', path: 'README.md', body: 'Agreed.', subject_type: 'file' },
    }),
  ).toBe(true);
  expect(sends(postReply('Agreed.'))).toBe(true);
  expect(sends(submitReview('COMMENT', 'Agreed.'))).toBe(false);
  expect(sends(review('a3', 'COMMENT', 'Agreed.'))).toBe(false);
});

test('a comment posted at once leaves no pending review', () => {
  const yours = none();
  for (const comment of [thread('Off by one?'), file('Changelog?'), reply('Agreed.')]) {
    const posting = yours.post('a3', HEAD, comment);
    if ('refusal' in posting || posting.pending)
      throw new Error('expected a comment posted at once');
    // GitHub gives a review id for a comment posted at once too: it's a review of its own.
    yours.accepted(posting.mutation, 'PRR_posted');
  }

  expect(yours.pending).toBeUndefined();
  expect(yours.pendingComments).toBe(0);
  // So `c` still starts one.
  expect(yours.add('a3', HEAD, thread('Off by one?'))).toMatchObject({ kind: 'startReview' });
});

test('c adds to the pending review when there is one', () => {
  expect(pending('a3', 2).post('a3', HEAD, thread('Off by one?'))).toEqual({
    mutation: addThread('Off by one?'),
    pending: true,
  });
  expect(pending('a3', 2).post('a2', HEAD, thread('Off by one?'))).toEqual({
    refusal: 'notLatest',
    head: 'a3',
  });
  expect(pending('a3', 2).post('a1', HEAD, reply('Agreed.'))).toEqual({
    mutation: addReply('Agreed.'),
    pending: true,
  });
});

test('submitting sends the pending review and ends it', () => {
  const yours = pending('a3', 2);
  const submit = planned(yours.submit('APPROVE', '', false, 'a3', HEAD));

  expect(submit).toEqual(submitReview('APPROVE'));
  yours.accepted(submit);
  expect(yours.pending).toBeUndefined();
  expect(yours.pendingComments).toBe(0);
});

test('a blank summary sends none and a written one is sent as it is', () => {
  // GitHub wipes a summary written on its page for an empty one, and keeps it for none.
  const yours = pending('a3', 1);
  for (const blank of ['', ' \n\t']) {
    expect(yours.submit('COMMENT', blank, false, 'a3', HEAD)).toEqual(submitReview('COMMENT'));
    expect(none().submit('APPROVE', blank, false, 'a3', HEAD)).toEqual(review('a3', 'APPROVE'));
  }
  expect(yours.submit('APPROVE', ' Ship it. ', false, 'a3', HEAD)).toEqual(
    submitReview('APPROVE', ' Ship it. '),
  );
});

test('approving or requesting changes needs the pending reviews revision on screen', () => {
  // GitHub would record the approval on r3, code that isn't on screen.
  const yours = pending('a3', 1);
  const otherRevision = { refusal: 'otherRevision', reviewOn: 'a3' };

  expect(yours.submit('APPROVE', '', false, 'a2', HEAD)).toEqual(otherRevision);
  expect(yours.submit('REQUEST_CHANGES', 'Wait.', false, 'a2', HEAD)).toEqual(otherRevision);
  // A comment approves nothing, so it's sent from any revision.
  expect(yours.submit('COMMENT', '', false, 'a2', HEAD)).toEqual(submitReview('COMMENT'));
  // Your own pull request's refusal comes first.
  expect(yours.submit('APPROVE', '', true, 'a2', HEAD)).toEqual({ refusal: 'ownPullRequest' });
});

test('without a pending review submitting reviews the revision on screen', () => {
  expect(none().submit('REQUEST_CHANGES', 'Needs tests.', false, 'a3', HEAD)).toEqual(
    review('a3', 'REQUEST_CHANGES', 'Needs tests.'),
  );
});

test('your own pull request offers only comment', () => {
  expect(reviewChoices(true)).toEqual(['COMMENT']);
  expect(reviewChoices(false)).toEqual(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);

  const yours = pending('a3', 1);
  expect(yours.submit('APPROVE', '', true, 'a3', HEAD)).toEqual({ refusal: 'ownPullRequest' });
  expect(yours.submit('REQUEST_CHANGES', 'Wait.', true, 'a3', HEAD)).toEqual({
    refusal: 'ownPullRequest',
  });
  expect(yours.submit('COMMENT', '', true, 'a3', HEAD)).not.toHaveProperty('refusal');
});

test('a comment or request for changes needs a summary or a pending comment', () => {
  const nothing = none();
  const empty = pending('a3', 0);
  const some = pending('a3', 1);

  expect(some.submit('COMMENT', ' \n', false, 'a3', HEAD)).toEqual(submitReview('COMMENT'));
  for (const event of ['COMMENT', 'REQUEST_CHANGES'] as const) {
    expect(nothing.submit(event, ' ', false, 'a3', HEAD)).toEqual({ refusal: 'nothingToSubmit' });
    expect(empty.submit(event, '', false, 'a3', HEAD)).toEqual({ refusal: 'nothingToSubmit' });
    expect(nothing.submit(event, 'Looks off.', false, 'a3', HEAD)).not.toHaveProperty('refusal');
    expect(some.submit(event, '', false, 'a3', HEAD)).not.toHaveProperty('refusal');
  }
  expect(nothing.submit('APPROVE', '', false, 'a3', HEAD)).not.toHaveProperty('refusal');
});

test('the submit dialog shows the count the account and the revision', () => {
  expect(pending('a3', 2).submitDialog('alice', false, 'a3')).toEqual({
    choices: reviewChoices(false),
    pendingComments: 2,
    account: 'alice',
    on: 'a3',
    onScreen: true,
  });
  expect(none().submitDialog('alice', true, 'a3')).toEqual({
    choices: reviewChoices(true),
    pendingComments: 0,
    account: 'alice',
    on: 'a3',
    onScreen: true,
  });
});

test('a pending review whose commit github lost is on no revision', () => {
  const yours = new YourReview(PULL, { id: 'PRR_1', commit: undefined, comments: 1 });
  const dialog = yours.submitDialog('alice', false, 'a3');
  expect([dialog.on, dialog.onScreen]).toEqual([undefined, false]);
  expect(yours.submit('APPROVE', '', false, 'a3', HEAD)).toEqual({
    refusal: 'otherRevision',
    reviewOn: undefined,
  });
  expect(yours.submit('COMMENT', '', false, 'a3', HEAD)).not.toHaveProperty('refusal');
});

test('the submit dialog says when the pending review is on another revision', () => {
  const dialog = pending('a2', 1).submitDialog('alice', false, 'a3');

  expect(dialog.on).toBe('a2');
  expect(dialog.onScreen).toBe(false);
});

test('a pending review goes with its last comment', () => {
  const yours = pending('a3', 2);
  yours.pendingCommentDeleted();
  expect(yours.pendingComments).toBe(1);
  yours.pendingCommentDeleted();
  expect(yours.pending).toBeUndefined();
  yours.pendingCommentDeleted();
  expect(yours.pending).toBeUndefined();
});

test('review events have graphql names', () => {
  expect(readReviewEvent('REQUEST_CHANGES')).toBe('REQUEST_CHANGES');
  expect(readReviewEvent('approve')).toBe('APPROVE');
  expect(() => readReviewEvent('DISMISS')).toThrow(UnknownValue);
});

test('a range from the base sends its starts side', () => {
  // GitHub's default start side is `RIGHT`, which would turn it into a range from the head.
  const range: NewThread = {
    kind: 'thread',
    path: 'src/parse.rs',
    lines: { start: { side: 'LEFT', number: 10 }, end: { side: 'RIGHT', number: 11 } },
    body: 'Why?',
  };
  expect(none().add('a3', HEAD, range)).toEqual({
    kind: 'startReview',
    head: HEAD,
    variables: {
      pullRequestId: PULL,
      commitOID: 'a3',
      threads: [
        {
          path: 'src/parse.rs',
          body: 'Why?',
          line: 11,
          side: 'RIGHT',
          startLine: 10,
          startSide: 'LEFT',
        },
      ],
    },
  });
  expect(pending('a3', 1).add('a3', HEAD, range)).toMatchObject({
    variables: { subjectType: 'LINE', line: 11, side: 'RIGHT', startLine: 10, startSide: 'LEFT' },
  });
});

const READ = {
  id: 'PRR_kwDOAbc',
  commit: { oid: 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62' },
  comments: { totalCount: 2 },
};

test('a pending review maps into reviews', () => {
  const expected: PendingReview = {
    id: 'PRR_kwDOAbc',
    commit: 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62',
    comments: 2,
  };
  expect(pendingReviewFrom(READ)).toEqual(expected);
  expect(pendingReviewFrom(undefined)).toBeUndefined();
});

test('a pending review on a lost commit is on no revision', () => {
  const lost = pendingReviewFrom({ ...READ, commit: null, comments: { totalCount: 1 } });
  const yours = new YourReview(PULL, lost);
  const head = 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62';
  expect(yours.submitDialog('alice', false, head).onScreen).toBe(false);
});

test('every plan carries the head it was planned against', () => {
  // r4 was pushed while r3 is on screen: GitHub puts a thread added to a pending review on r4, so
  // the sender checks where an added thread landed against the head its plan assumed.
  const latest = 'a4';
  const yours = pending('a3', 1);
  const plans = [
    none().add('a3', latest, thread('Off by one?')),
    none().add('a3', latest, file('Needs a changelog entry.')),
    yours.add(latest, latest, thread('And here.')),
    yours.add('a3', latest, file('Needs a changelog entry.')),
    yours.add('a3', latest, reply('Agreed.')),
    none().post('a3', latest, thread('Off by one?')),
    none().post('a3', latest, file('Needs a changelog entry.')),
    none().post('a3', latest, reply('Agreed.')),
    yours.post('a1', latest, reply('Agreed.')),
    yours.submit('COMMENT', '', false, 'a3', latest),
    none().submit('APPROVE', '', false, 'a3', latest),
  ].map((plan) => ('mutation' in plan ? plan.mutation : planned(plan)));

  expect(plans.map((plan) => plan.kind)).toEqual([
    'startReview',
    'startReview',
    'addThread',
    'addThread',
    'addReply',
    'postThread',
    'postFileComment',
    'postReply',
    'addReply',
    'submitReview',
    'review',
  ]);
  expect(plans.map((plan) => plan.head)).toEqual(plans.map(() => latest));
});

test('a pending review github left out plans nothing but a reply posted at once', () => {
  // A review started now would be refused if one is pending, and adding to one needs its id.
  const unknown = yourReview(PULL, { kind: 'unknown', why: 'Something went wrong' });
  const refused = { refusal: 'pendingUnknown' };

  expect(unknown.known).toBe(false);
  for (const comment of [thread('Off by one?'), file('Needs a changelog entry.'), reply('Ok.')]) {
    expect(unknown.add('a3', HEAD, comment)).toEqual(refused);
  }
  for (const comment of [thread('Off by one?'), file('Needs a changelog entry.')]) {
    expect(unknown.post('a3', HEAD, comment)).toEqual(refused);
  }
  // A reply posted at once starts no review, so it can't be a second one.
  expect(unknown.post('a3', HEAD, reply('Ok.'))).toEqual({
    mutation: postReply('Ok.'),
    pending: false,
  });
  for (const event of ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const) {
    expect(unknown.submit(event, 'Looks good.', false, 'a3', HEAD)).toEqual(refused);
  }
  // A read that says which review you have, or none, plans as usual.
  const read = yourReview(PULL, {
    kind: 'read',
    review: { id: 'PRR_1', commit: { oid: 'a2' }, comments: { totalCount: 1 } },
  });
  expect(read.pending).toEqual({ id: 'PRR_1', commit: 'a2', comments: 1 });
  expect(
    yourReview(PULL, { kind: 'read', review: undefined }).add('a3', HEAD, thread('Hm.')),
  ).toEqual(startReview('a3', 'Hm.'));
});

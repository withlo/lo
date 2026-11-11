import { expect, test } from 'vitest';

import {
  afterLostEdit,
  beforeEdit,
  changeRefusal,
  deleteFacts,
  deleteFactsNow,
  newestYours,
  type CommentNow,
} from './edits.ts';
import type { ThreadComment } from './threads.ts';

function comment(
  id: string,
  author: string | undefined,
  update: boolean,
  remove: boolean,
): ThreadComment {
  return {
    id,
    author,
    body: `${id} says`,
    state: 'SUBMITTED',
    createdAt: '1970-01-01T00:00:00Z',
    url: '',
    hidden: undefined,
    viewerCanUpdate: update,
    viewerCanDelete: remove,
  };
}

/** The comment as a fresh read finds it: yours, with `body`, and alone in its thread. */
function now(body: string): CommentNow {
  return {
    body,
    author: undefined,
    state: 'SUBMITTED',
    lastEditedAt: undefined,
    editor: undefined,
    viewerDidAuthor: true,
    viewerCanUpdate: true,
    viewerCanDelete: true,
    cannotUpdate: [],
    threadComments: 1,
    resolved: false,
    reviewComments: undefined,
  };
}

test('the keys take your newest comment github lets you change', () => {
  const thread = {
    comments: [
      comment('1', 'Bot', true, true),
      comment('2', 'alice', true, true),
      comment('3', 'bot', false, true),
    ],
  };
  expect(newestYours(thread, 'bot', 'delete')).toBe(thread.comments[2]);
  expect(newestYours(thread, 'bot', 'edit')).toBe(thread.comments[0]);
  expect(newestYours(thread, 'carol', 'edit')).toEqual({ refusal: 'noneOfYours' });
});

test('someone elses comment is refused even when github allows it', () => {
  const theirs = comment('2', 'alice', true, true);
  expect(changeRefusal(theirs, 'bot', 'edit')).toEqual({ refusal: 'theirs', author: 'alice' });
  const ghost = comment('2', undefined, true, true);
  expect(changeRefusal(ghost, 'bot', 'delete')).toEqual({ refusal: 'theirs', author: undefined });
  const locked = comment('1', 'bot', false, false);
  expect(changeRefusal(locked, 'bot', 'edit')).toEqual({ refusal: 'notAllowed' });
  expect(newestYours({ comments: [locked] }, 'bot', 'edit')).toEqual({ refusal: 'notAllowed' });
});

test('an edit goes only over the text it started from', () => {
  expect(beforeEdit('old', 'new', now('old\r\n'))).toEqual({ kind: 'send' });
  expect(beforeEdit('old', 'new', now(' new '))).toEqual({ kind: 'alreadySo' });
  expect(beforeEdit('old', 'new', now('theirs'))).toMatchObject({
    kind: 'changed',
    now: { body: 'theirs' },
  });
  expect(beforeEdit('old', 'new', undefined)).toEqual({ kind: 'gone' });
  const theirs = { ...now('old'), viewerDidAuthor: false };
  expect(beforeEdit('old', 'new', theirs)).toEqual({ kind: 'theirs' });
  const locked: CommentNow = { ...now('old'), viewerCanUpdate: false, cannotUpdate: ['LOCKED'] };
  expect(beforeEdit('old', 'new', locked)).toEqual({ kind: 'notAllowed', reasons: ['LOCKED'] });
});

test('a lost edit found with its text was taken whatever the base', () => {
  expect(afterLostEdit('old', 'new', now('new'))).toEqual({ kind: 'taken' });
  // An edit back to the base: the text sent is what counts.
  expect(afterLostEdit('same', 'same', now('same'))).toEqual({ kind: 'taken' });
  expect(afterLostEdit('old', 'new', now('old'))).toEqual({ kind: 'notTaken' });
  expect(afterLostEdit('old', 'new', now('third'))).toMatchObject({ kind: 'changed' });
  expect(afterLostEdit('old', 'new', undefined)).toEqual({ kind: 'gone' });
});

test('delete facts name what goes', () => {
  const pending: ThreadComment = {
    ...comment('1', 'bot', true, true),
    body: 'Hm.\r\n',
    state: 'PENDING',
  };
  const facts = deleteFacts({ comments: [pending] }, pending, 2);
  expect(facts).toEqual({ body: 'Hm.', pending: true, onlyComment: true, reviewComments: 2 });
  const read: CommentNow = {
    ...now('Hm.'),
    viewerDidAuthor: false,
    viewerCanUpdate: false,
    viewerCanDelete: false,
    state: 'PENDING',
    reviewComments: 2,
  };
  expect(deleteFactsNow(read)).toEqual(facts);
  // Another reply since, or another pending comment gone: it's asked again.
  expect(deleteFactsNow({ ...read, threadComments: 2 })).not.toEqual(facts);
  expect(deleteFactsNow({ ...read, reviewComments: 1 })).not.toEqual(facts);
  // A posted comment's facts hold no count.
  expect(
    deleteFacts({ comments: [pending, pending] }, { ...pending, state: 'SUBMITTED' }, 2),
  ).toEqual({ body: 'Hm.', pending: false, onlyComment: false, reviewComments: undefined });
});

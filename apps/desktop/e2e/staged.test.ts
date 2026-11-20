// A cassette served a stage at a time (`./staged.ts`), on `app_merge_ship`: however many times Lo
// reads rozed-dev/e2e#264 before it merges it, it gets the answers recorded before the merge, the
// last repeating, and once the merge is sent, those recorded after, in order. Served as it is, the
// tenth read already answers as merged. With `sooner`, a read recorded only after the merge, made
// sooner, gets its first answer; without it, none. A write never does: on `app_comments_box`, a
// comment's deletion sent before the writes recorded ahead of it gets no answer either way.

import { readFileSync } from 'node:fs';

import { Replay, ReplayError, type SeenRequest } from '@lo/testing';
import { MERGE_PULLS } from '@lo/testing/git';
import { expect, it } from 'vitest';

import { Staged } from './staged.ts';

const PULL = 'https://api.github.com/repos/rozed-dev/e2e/pulls/264';

/** Each status the replay answers `times` reads of #264 with, as Lo polls it. */
function polls(replay: Replay, times: number): number[] {
  return Array.from(
    { length: times },
    () =>
      replay.answer({
        method: 'GET',
        url: PULL,
        headers: new Headers({ 'if-modified-since': 'Fri, 20 Nov 2026 04:26:07 GMT' }),
        body: new Uint8Array(),
      }).status,
  );
}

/** Merges #264 at its head, with a merge commit, as Lo did. */
function merge(replay: Replay): number {
  const { head } = MERGE_PULLS[10].pulls.squash;
  const body = `{"sha":"${head}","merge_method":"merge","merge_action":"direct_merge"}`;
  return replay.answer({
    method: 'PUT',
    url: `${PULL}/merge-async`,
    headers: new Headers(),
    body: new TextEncoder().encode(body),
  }).status;
}

/** Whether a request merges a pull request. */
const merging = ({ method, url }: { method: string; url: string }) =>
  method === 'PUT' && url.endsWith('/merge-async');

/** The overview's ref, read again only after the merge as it was recorded. */
const REFS: SeenRequest = {
  method: 'GET',
  url: 'https://api.github.com/repos/rozed-dev/e2e/git/matching-refs/lo/pr/264',
  headers: new Headers({
    'if-none-match': '"a5b1adb5c0ca493d0c80f8b7a69503be16db08a72cc02c3e043626a88caa5c23"',
  }),
  body: new Uint8Array(),
};

it('answers each read as recorded before the merge until Lo sends it, and as after once it has', () => {
  const staged = new Staged('app_merge_ship', merging, { sooner: true });
  expect(polls(staged, 30)).toEqual(Array.from({ length: 30 }, () => 304));
  expect(staged.answer(REFS).status).toBe(304);
  expect(merge(staged)).toBe(202);
  expect(polls(staged, 2)).toEqual([304, 200]);

  expect(polls(Replay.cassette('app_merge_ship'), 10)).toContain(200);
});

it('answers a read recorded only after the merge, made sooner, only when asked to', () => {
  expect(() => new Staged('app_merge_ship', merging).answer(REFS)).toThrow(ReplayError);
});

/** The comment rozed-bot deleted last, as Lo deletes it. */
const DELETE: SeenRequest = {
  method: 'POST',
  url: 'https://api.github.com/graphql',
  headers: new Headers(),
  body: new TextEncoder().encode(
    JSON.stringify({
      query: readFileSync(
        new URL(
          '../../../packages/core/github/graphql/delete_issue_comment.graphql',
          import.meta.url,
        ),
        'utf8',
      ),
      operationName: 'DeleteIssueComment',
      variables: { id: 'IC_kwDOVleUfc8AAAABmZVUog' },
    }),
  ),
};

it.each([false, true])(
  'answers no write sent before the writes recorded ahead of it, with sooner %s',
  (sooner) => {
    const writes = new Set(['AddComment', 'UpdateIssueComment', 'DeleteIssueComment']);
    const staged = new Staged('app_comments_box', ({ operation }) => writes.has(operation ?? ''), {
      sooner,
    });
    expect(() => staged.answer(DELETE)).toThrow(ReplayError);
    // Recorded as it's sent here, it's answered so in its turn.
    expect(Replay.cassette('app_comments_box').answer(DELETE).status).toBe(200);
  },
);

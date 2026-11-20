// A cassette served a stage at a time (`./staged.ts`), on `app_merge_ship`: however many times Lo
// reads rozed-dev/e2e#264 before it merges it, it gets the answers recorded before the merge, the
// last repeating, and once the merge is sent, those recorded after, in order. Served as it is, the
// tenth read already answers as merged.

import { Replay } from '@lo/testing';
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

it('answers each read as recorded before the merge until Lo sends it, and as after once it has', () => {
  const staged = new Staged(
    'app_merge_ship',
    ({ method, url }) => method === 'PUT' && url.endsWith('/merge-async'),
  );
  expect(polls(staged, 30)).toEqual(Array.from({ length: 30 }, () => 304));
  expect(merge(staged)).toBe(202);
  expect(polls(staged, 2)).toEqual([304, 200]);

  expect(polls(Replay.cassette('app_merge_ship'), 10)).toContain(200);
});

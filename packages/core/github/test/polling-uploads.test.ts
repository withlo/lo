// The poller's uploads on a fake clock: one at a time, in a queue of their own beside the account's,
// replaying `poll_playground` and what rozed-bot uploaded to rozed-dev/e2e (`attachments_e2e`).

import { cassette, type Interaction } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  answer,
  at,
  comment,
  oneAtATime,
  outcome,
  pr,
  Polling,
  postComment,
  QUIET,
  recorded,
  useFakeClock,
  wall,
  type Logged,
} from './support/polling.ts';
import { prepareAttachment, type PreparedAttachment } from '../src/attachments.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

const E2E = new RepoRef('rozed-dev', 'e2e');

/** A 2×2 red PNG, the bytes that were recorded. */
const PNG = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001949444154780101' +
      '0e00f1ff00c81e1ec81e1e00c81e1ec81e1e1f260411ecbcd8e10000000049454e44ae426082',
    'hex',
  ),
);

function png(): PreparedAttachment {
  return prepareAttachment('lo-attachment.png', PNG);
}

/** Where rozed-dev/e2e's attachments go, then GitHub's answer to the PNG's upload. */
function uploaded(): Interaction[] {
  const { interactions } = cassette('attachments_e2e');
  return interactions.slice(0, 2).map(({ interaction }) => interaction);
}

const TARGET = 'GET /repos/rozed-dev/e2e';
const UPLOAD =
  'POST /user-attachments/assets?name=lo-attachment.png&content_type=image%2Fpng&repository_id=1448580221';

/** Uploads take 10 s; everything else a second. */
function slowUploads(what: string): number {
  return what.startsWith('POST /user-attachments') ? 10_000 : 1000;
}

/** A comment GitHub answers with a secondary rate limit, a minute long. */
function limitedComment(r: readonly Interaction[]): Interaction {
  const limited = comment(r);
  limited.response = answer(
    at(r, 0),
    403,
    [['retry-after', '60']],
    '{"message":"You have exceeded a secondary rate limit."}',
  ).response;
  return limited;
}

const ASSET = 'https://github.com/user-attachments/assets/2c8f1e6f-0846-4210-a57f-c0c6b27e9717';

test('uploads go one at a time beside the accounts queue, which polls go on using', async () => {
  const t = await Polling.start('uploads', [...recorded(), ...uploaded()], {
    delay: slowUploads,
  });
  void t.poller.setOpen(pr(1));
  await t.run();
  const heard: number[] = [];
  const first = t.poller.upload(E2E, png(), { progress: () => heard.push(1) });
  const second = t.poller.upload(E2E, png());
  expect(await t.finish(first)).toBe(ASSET);
  expect(await t.finish(second)).toBe(ASSET);

  const requests = t.requests();
  const uploads = requests.filter(([, what]) => what === UPLOAD);
  // The target is read once, in the queue after the open pull request's poll (0–3 s), as a read
  // someone waits on: before the repository's poll that was waiting.
  expect(requests.filter(([, what]) => what === TARGET)).toEqual([[3, TARGET]]);
  expect(uploads).toEqual([
    [4, UPLOAD],
    [14, UPLOAD],
  ]);
  // The account's queue goes on one request at a time while each upload is under way.
  const queued: Logged[] = requests.filter(([, what]) => what !== UPLOAD);
  expect(queued).toSatisfy(oneAtATime);
  expect(queued.filter(([secs]) => secs >= 4 && secs < 14).map(([, what]) => what)).toEqual([
    'GET /pulls?state=open&per_page=100',
    'OpenPullRequests',
    'TrunkRules',
  ]);
  expect(queued.filter(([secs]) => secs >= 14 && secs < 24).map(([, what]) => what)).toEqual([
    'GET /pulls/1 (since)',
  ]);
  // The replayer can't tell how much has gone.
  expect(heard).toEqual([]);
});

test('an upload is refused while github asks lo to hold off, when asked for and at its turn', async () => {
  const r = recorded();
  const t = await Polling.start('uploads_paused', [limitedComment(r), ...uploaded()], {
    delay: slowUploads,
  });
  const first = t.poller.upload(E2E, png());
  await t.runUntil(3);
  // The second waits for the first, while GitHub answers a comment (3–4 s) asking Lo to hold off.
  const second = t.poller.upload(E2E, png());
  const write = outcome(postComment(t.poller));
  expect((await t.finish(write)).ok).toBe(false);
  const held = { refusal: 'paused', until: wall(64) };
  expect(await t.poller.upload(E2E, png())).toEqual(held);
  expect(await t.finish(first)).toBe(ASSET);
  expect(await t.finish(second)).toEqual(held);
  expect(t.requests().map(([, what]) => what)).toEqual([TARGET, UPLOAD, 'POST /issues/1/comments']);
});

test('an upload given up while it waits is never sent, and one under way is cancelled', async () => {
  const t = await Polling.start('uploads_given_up', uploaded(), { delay: slowUploads });
  const sending = new AbortController();
  const first = outcome(t.poller.upload(E2E, png(), { signal: sending.signal }));
  const waiting = new AbortController();
  const second = outcome(t.poller.upload(E2E, png(), { signal: waiting.signal }));
  await t.runUntil(3);
  const reason = new Error('cancelled');
  waiting.abort(reason);
  sending.abort(reason);
  expect(await t.finish(first)).toEqual({ ok: false, error: reason });
  expect(await t.finish(second)).toEqual({ ok: false, error: reason });
  await t.runUntil(30);
  expect(t.requests()).toEqual([
    [0, TARGET],
    [1, UPLOAD],
  ]);
});

/** The token each request the cassette was asked was sent with. */
function sentAs(t: Polling): (string | null)[] {
  return t.http.seen.map((request) => request.headers.get('authorization'));
}

test('an upload given a token is sent as it, alone, through the same queue and checks', async () => {
  const t = await Polling.start('uploads_as_gh', uploaded(), { delay: slowUploads });
  const gh = new Token('gho_GH');
  const first = t.poller.upload(E2E, png(), { token: gh });
  const second = t.poller.upload(E2E, png());
  expect(await t.finish(first)).toBe(ASSET);
  expect(await t.finish(second)).toBe(ASSET);
  expect(t.requests()).toEqual([
    [0, TARGET],
    [1, UPLOAD],
    [11, UPLOAD],
  ]);
  expect(sentAs(t)).toEqual(['token gho_FAKE', 'token gho_GH', 'token gho_FAKE']);
});

test('a token given for an upload that github refuses is neither kept nor named', async () => {
  const [target, upload] = uploaded();
  if (!target || !upload) throw new Error('attachments_e2e changed');
  const refused = answer(
    upload,
    401,
    [['content-type', 'application/json; charset=utf-8']],
    '{"message":"Bad credentials"}',
  );
  const t = await Polling.start('uploads_as_gh_refused', [target, refused, upload]);
  const gh = new Token('gho_GH_REFUSED');
  const failed = await t.finish(outcome(t.poller.upload(E2E, png(), { token: gh })));
  expect(failed.ok).toBe(false);
  const said = failed.ok ? '' : `${String(failed.error)} ${JSON.stringify(failed.error)}`;
  expect(said).not.toContain('gho_GH_REFUSED');
  // Sent once, and the account's own token was never taken for refused.
  expect(await t.finish(t.poller.upload(E2E, png()))).toBe(ASSET);
  expect(sentAs(t)).toEqual(['token gho_FAKE', 'token gho_GH_REFUSED', 'token gho_FAKE']);
  expect(t.status()).toEqual(QUIET);
  expect(t.logs.join('\n')).not.toContain('gho_GH_REFUSED');
});

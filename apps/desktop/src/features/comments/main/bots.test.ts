import { GithubClient, GithubError, Token, type PollStatus, type ReadPriority } from '@lo/github';
import { describe, expect, it } from 'vitest';

import {
  askGitHub,
  BotPictures,
  type BotAccounts,
  type BotAccountState,
  type BotAnswer,
  type BotLimits,
  type BotPoller,
} from './bots.ts';
import { ImageError } from './images.ts';

const CURSOR = 'https://avatars.githubusercontent.com/in/1210556?v=4';

/**
 * `BotPictures` over a GitHub that answers each ask as `answer` says, on a clock the test moves;
 * and the bots it was asked about, in order.
 */
function pictures(
  answer: (login: string) => BotAnswer | Promise<BotAnswer>,
  limits?: Partial<BotLimits>,
) {
  const asked: string[] = [];
  const clock = { now: 0 };
  const bots = new BotPictures({
    ask: async (login) => {
      asked.push(login);
      return answer(login);
    },
    now: () => clock.now,
    limits,
  });
  return { bots, asked, clock };
}

const found = (avatar = CURSOR): BotAnswer => ({ kind: 'found', avatar });

/** Why `finding` failed. */
async function refusal(finding: Promise<unknown>): Promise<{ reason: string; message: string }> {
  const error: unknown = await finding.then(
    () => new Error('it was found'),
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ImageError)) throw error;
  return { reason: error.reason, message: error.message };
}

describe('BotPictures', () => {
  it("keeps where each bot's picture is for the run, asking once for each bot", async () => {
    const { bots, asked } = pictures(() => found());
    const [one, two] = await Promise.all([bots.picture('cursor'), bots.picture('Cursor')]);
    expect(one.href).toBe('https://avatars.githubusercontent.com/in/1210556');
    expect(two.href).toBe(one.href);
    // Each caller gets an address of its own to put its size on.
    one.searchParams.set('s', '40');
    expect((await bots.picture('CURSOR')).href).toBe(
      'https://avatars.githubusercontent.com/in/1210556',
    );
    expect(asked).toEqual(['cursor']);
  });

  it('keeps for the run that GitHub has no such bot, or no picture for it on the avatars’ host', async () => {
    const { bots, asked } = pictures((login) =>
      login === 'gone' ? { kind: 'none' } : found('https://example.com/in/12'),
    );
    for (let time = 0; time < 2; time++) {
      expect(await refusal(bots.picture('gone'))).toEqual({
        reason: 'refused',
        message: 'GitHub has no bot gone',
      });
      expect(await refusal(bots.picture('elsewhere'))).toEqual({
        reason: 'refused',
        message: 'GitHub has no avatar for elsewhere on avatars.githubusercontent.com',
      });
    }
    expect(asked).toEqual(['gone', 'elsewhere']);
  });

  it('refuses a picture anywhere but an app’s or an account’s on the avatars’ host', async () => {
    for (const given of [
      'https://avatars.githubusercontent.com/cursor',
      'https://avatars.githubusercontent.com/in/',
      'https://avatars.githubusercontent.com/in/0',
      'https://avatars.githubusercontent.com/in/12/more',
      'https://avatars.githubusercontent.com:444/in/12',
      'http://avatars.githubusercontent.com/in/12',
      'https://me@avatars.githubusercontent.com/in/12',
      'https://example.com/in/12',
      'not an address',
    ]) {
      const { bots } = pictures(() => found(given));
      expect(await refusal(bots.picture('cursor'))).toMatchObject({ reason: 'refused' });
    }
    const { bots } = pictures(() => found('https://avatars.githubusercontent.com/u/9919?v=4'));
    expect((await bots.picture('github-merge-queue')).href).toBe(
      'https://avatars.githubusercontent.com/u/9919',
    );
  });

  it('holds off asking after a failure, twice as long after each in a row, an hour at most', async () => {
    let failing = true;
    const { bots, asked, clock } = pictures(() =>
      failing ? Promise.reject(new Error('offline: a secret')) : found(),
    );
    expect(await refusal(bots.picture('cursor'))).toEqual({
      reason: 'failed',
      message: 'GitHub couldn’t say where cursor’s avatar is',
    });
    // Every bot waits, not only the one that failed.
    clock.now = 59_000;
    expect(await refusal(bots.picture('renovate'))).toEqual({
      reason: 'failed',
      message: 'asking GitHub about a bot failed, so it’s asked again in 1 s',
    });
    expect(asked).toEqual(['cursor']);
    // Then 2 minutes, 4, and so on, up to an hour.
    const waits: number[] = [];
    for (let at = 60_000; waits.length < 8;) {
      clock.now = at;
      await refusal(bots.picture('cursor'));
      const held = await refusal(bots.picture('cursor'));
      const wait = Number(/in (\d+) s/.exec(held.message)?.[1]) * 1000;
      waits.push(wait);
      at += wait;
    }
    expect(waits).toEqual([
      120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000,
    ]);
    // An answer starts the count over.
    failing = false;
    clock.now += 3_600_000;
    await bots.picture('cursor');
    failing = true;
    await refusal(bots.picture('renovate'));
    clock.now += 60_000;
    expect(await refusal(bots.picture('renovate'))).toMatchObject({
      message: 'GitHub couldn’t say where renovate’s avatar is',
    });
  });

  it('asks again the next time for a bot it didn’t ask GitHub about, holding nothing off', async () => {
    let later = true;
    const { bots, asked } = pictures(() =>
      later ? { kind: 'later', why: 'no account is signed in' } : found(),
    );
    expect(await refusal(bots.picture('cursor'))).toEqual({
      reason: 'failed',
      message: 'GitHub wasn’t asked about cursor: no account is signed in',
    });
    later = false;
    expect((await bots.picture('cursor')).pathname).toBe('/in/1210556');
    expect(asked).toEqual(['cursor', 'cursor']);
  });

  it('asks about so many bots a run at most, and again about one already asked', async () => {
    let failing = false;
    const { bots, asked, clock } = pictures(
      (login) => {
        if (failing) throw new Error('offline');
        return login === 'later' ? { kind: 'later', why: 'offline' } : found();
      },
      { bots: 2, firstWait: 1, longestWait: 1 },
    );
    // One GitHub wasn't asked about doesn't count.
    await refusal(bots.picture('later'));
    failing = true;
    await refusal(bots.picture('first'));
    failing = false;
    clock.now = 10;
    await bots.picture('second');
    expect(await refusal(bots.picture('third'))).toEqual({
      reason: 'refused',
      message: 'GitHub was asked about 2 bots this run, the most it’s asked about',
    });
    await bots.picture('first');
    expect(asked).toEqual(['later', 'first', 'second', 'first']);
  });

  it('asks about one bot at a time', async () => {
    const answers: ((answer: BotAnswer) => void)[] = [];
    const { bots, asked } = pictures(
      () => new Promise<BotAnswer>((resolve) => answers.push(resolve)),
    );
    const cursor = bots.picture('cursor');
    const renovate = bots.picture('renovate');
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toEqual(['cursor']);
    answers[0]?.({ kind: 'none' });
    await refusal(cursor);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['cursor', 'renovate']);
    answers[1]?.(found());
    expect((await renovate).pathname).toBe('/in/1210556');
  });

  it('asks again at once after a failure, once released, as when an account is added', async () => {
    let failing = true;
    const { bots, asked } = pictures(() => (failing ? Promise.reject(new Error('502')) : found()));
    await refusal(bots.picture('cursor'));
    expect(await refusal(bots.picture('cursor'))).toMatchObject({
      message: 'asking GitHub about a bot failed, so it’s asked again in 60 s',
    });
    failing = false;
    bots.release();
    expect((await bots.picture('cursor')).pathname).toBe('/in/1210556');
    expect(asked).toEqual(['cursor', 'cursor']);
  });

  it("holds nothing off when GitHub didn't answer for a reason the account shows", async () => {
    let unanswered = true;
    const { bots, asked } = pictures(
      (): BotAnswer =>
        unanswered ? { kind: 'unanswered', why: 'GitHub can’t be reached' } : found(),
      { bots: 1 },
    );
    expect(await refusal(bots.picture('cursor'))).toEqual({
      reason: 'failed',
      message: 'GitHub didn’t answer about cursor: GitHub can’t be reached',
    });
    unanswered = false;
    expect((await bots.picture('cursor')).pathname).toBe('/in/1210556');
    // It was asked about, so it counts.
    expect(await refusal(bots.picture('renovate'))).toMatchObject({ reason: 'refused' });
    expect(asked).toEqual(['cursor', 'cursor']);
  });
});

const NORMAL: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
const OFFLINE: PollStatus = {
  ...NORMAL,
  offline: { since: 0, retryAt: 1, cause: { kind: 'offline' }, error: 'offline' },
};
const LOW: PollStatus = {
  ...NORMAL,
  rateLimit: { kind: 'slowed', low: { resource: 'core', remaining: 10, limit: 5000, reset: 1 } },
};

/**
 * Lo's accounts, as `states` says, each polled by a poller whose status is `status` (its own, or
 * all's), over a GitHub that answers as `answer` says; and the reads each poller made, and at what
 * priority.
 */
function accounts(
  states: readonly BotAccountState[],
  options: {
    status?: Readonly<Record<string, PollStatus>>;
    answer?: (path: string) => Response;
    /** The account's status once a read failed. */
    failed?: PollStatus;
  } = {},
) {
  const reads: { login: string; priority: ReadPriority | undefined }[] = [];
  const answer =
    options.answer ?? (() => Response.json({ type: 'Bot', avatar_url: CURSOR }, { status: 200 }));
  const client = new GithubClient({
    fetch: (input: string | URL | Request) =>
      Promise.resolve(answer(new URL(input instanceof Request ? input.url : input).pathname)),
    token: new Token('gho_FAKE'),
  });
  const access: BotAccounts = {
    accounts: () => Promise.resolve(states),
    poller(login) {
      if (!states.some((state) => state.account.login === login)) {
        return Promise.reject(new Error(`no account ${login}`));
      }
      let status = options.status?.[login] ?? NORMAL;
      const poller: BotPoller = {
        login,
        status: () => status,
        async readOnce(request, _signal, priority) {
          reads.push({ login, priority });
          try {
            return await request(client);
          } catch (error) {
            status = options.failed ?? status;
            throw error;
          }
        },
      };
      return Promise.resolve(poller);
    },
  };
  return { access, reads };
}

const serverError = () => Response.json({ message: 'Server Error' }, { status: 502 });

const account = (login: string, how: Partial<BotAccountState> = {}): BotAccountState => ({
  account: { login },
  signedOut: undefined,
  needsKeyring: false,
  ...how,
});

describe('askGitHub', () => {
  it('asks as the first account signed in whose token can be read, as a background read', async () => {
    const { access, reads } = accounts([
      account('gone', { signedOut: { kind: 'revoked' } }),
      account('locked', { needsKeyring: true }),
      account('rozed-bot'),
      account('octocat'),
    ]);
    expect(await askGitHub(access, 'cursor')).toEqual({ kind: 'found', avatar: CURSOR });
    expect(reads).toEqual([{ login: 'rozed-bot', priority: 'background' }]);
  });

  it("has none for a bot GitHub doesn't have", async () => {
    const { access } = accounts([account('rozed-bot')], {
      answer: () => Response.json({ message: 'Not Found' }, { status: 404 }),
    });
    expect(await askGitHub(access, 'gone')).toEqual({ kind: 'none' });
  });

  it('asks nothing with no account signed in', async () => {
    const { access, reads } = accounts([account('gone', { signedOut: { kind: 'revoked' } })]);
    expect(await askGitHub(access, 'cursor')).toEqual({
      kind: 'later',
      why: 'no account is signed in',
    });
    expect(reads).toEqual([]);
  });

  it("asks nothing while the account is signed out, can't reach GitHub, or its rate limit is low", async () => {
    for (const [status, why] of [
      [{ ...NORMAL, signedOut: true }, 'rozed-bot is signed out'],
      [OFFLINE, 'GitHub can’t be reached'],
      [LOW, 'rozed-bot’s rate limit is low'],
      [
        { ...NORMAL, rateLimit: { kind: 'paused', until: 1, reason: { kind: 'secondary' } } },
        'rozed-bot’s rate limit is low',
      ],
    ] as const) {
      const { access, reads } = accounts([account('rozed-bot')], {
        status: { 'rozed-bot': status },
      });
      expect(await askGitHub(access, 'cursor')).toEqual({ kind: 'later', why });
      expect(reads).toEqual([]);
    }
  });

  it('says why GitHub didn’t answer when the account shows it, and throws otherwise', async () => {
    const offline = accounts([account('rozed-bot')], { answer: serverError, failed: OFFLINE });
    expect(await askGitHub(offline.access, 'cursor')).toEqual({
      kind: 'unanswered',
      why: 'GitHub can’t be reached',
    });
    const other = accounts([account('rozed-bot')], { answer: serverError });
    await expect(askGitHub(other.access, 'cursor')).rejects.toBeInstanceOf(GithubError);
  });

  it('throws for an account gone by the time its poller is asked for', async () => {
    const { access } = accounts([account('rozed-bot')]);
    const gone: BotAccounts = { ...access, accounts: () => Promise.resolve([account('removed')]) };
    await expect(askGitHub(gone, 'cursor')).rejects.toThrow('no account removed');
  });
});

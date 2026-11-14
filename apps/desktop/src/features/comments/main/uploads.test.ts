import {
  GithubError,
  RepoRef,
  Token,
  type UploadOptions,
  type UploadRefusal as PollerRefusal,
} from '@lo/github';
import { describe, expect, test } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { UploadProgressRow } from '../contract.ts';
import { checkedFile, Uploads, type UploadsPoller } from './uploads.ts';

/** A 2×2 red PNG. */
const PNG = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001949444154780101' +
      '0e00f1ff00c81e1ec81e1e00c81e1ec81e1e1f260411ecbcd8e10000000049454e44ae426082',
    'hex',
  ),
);

const ASSET = 'https://github.com/user-attachments/assets/2c8f1e6f-0846-4210-a57f-c0c6b27e9717';

/** A stand-in token gh hands over, never a real one. */
const GH_TOKEN = 'gho_FAKE_FROM_GH';

/** #94's view `t1`, as rozed-bot. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 94,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: undefined,
    latest: undefined,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: true,
    run: undefined,
    ...overrides,
  };
}

const NOT_FOUND = new GithubError({ kind: 'notFound', message: 'Not Found' });

/** What an upload the poller is asked for does: answers, throws, or waits to be given up. */
type Answer = (options: UploadOptions) => Promise<string | PollerRefusal>;

const answers = {
  taken: (): Promise<string> => Promise.resolve(ASSET),
  refused: (error: Error) => (): Promise<string> => Promise.reject(error),
  /** Hears it half sent, then waits until it's given up. */
  hanging: ({ signal, progress }: UploadOptions): Promise<string> => {
    progress?.(1, 2);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(signal.reason instanceof Error ? signal.reason : new Error('given up')),
        { once: true },
      );
    });
  },
} satisfies Record<string, Answer | ((error: Error) => Answer)>;

/**
 * Uploads through a poller that answers each upload with the next of `given`, where the account can
 * write as `canWrite` says, and a gh that has `gh` for a token.
 */
function setUp(
  given: Answer[],
  options: {
    canWrite?: boolean | undefined;
    /** Why GitHub couldn't be asked whether the account can write, if it couldn't. */
    unreadable?: Error;
    gh?: () => Promise<Token | undefined>;
    view?: PullTabInfo;
  } = {},
) {
  const sent: { repo: RepoRef; name: string; token: string | undefined }[] = [];
  const targets: RepoRef[] = [];
  const progress: UploadProgressRow[] = [];
  const logged: string[] = [];
  let ghAsked = 0;
  const canWrite = 'canWrite' in options ? options.canWrite : true;
  const poller: UploadsPoller = {
    attachmentTarget(repo) {
      targets.push(repo);
      if (options.unreadable) return Promise.reject(options.unreadable);
      return Promise.resolve({ repositoryId: 1448580221, canWrite });
    },
    upload(repo, file, uploadOptions = {}) {
      sent.push({ repo, name: file.name, token: uploadOptions.token?.expose() });
      const answer = given.shift();
      if (!answer) throw new Error('an upload the test didn’t expect');
      return answer(uploadOptions);
    },
  };
  const uploads = new Uploads({
    poller: () => Promise.resolve(poller),
    view: (id) => (id === 't1' ? (options.view ?? info()) : undefined),
    ghToken: () => {
      ghAsked += 1;
      return options.gh?.() ?? Promise.resolve(undefined);
    },
    publish: (row) => progress.push(row),
    log: (line) => logged.push(line),
  });
  return { uploads, sent, targets, progress, logged, ghAsked: () => ghAsked };
}

describe('checking a file again before it goes', () => {
  test.each([
    [
      'notes.txt',
      PNG,
      'GitHub takes PNG, JPEG, GIF, WebP and SVG images and MP4, MOV and WebM videos',
    ],
    ['shot.png', new Uint8Array(), "it's empty"],
    ['shot.jpg', PNG, "its name says JPEG, but it isn't"],
    [
      'shot.png',
      new Uint8Array(10 * 1024 * 1024 + 1).fill(0x89),
      "it's larger than GitHub's 10 MB",
    ],
  ])('refuses %s as GitHub would', (name, bytes, why) => {
    expect(checkedFile(name, bytes)).toEqual({ refusal: { kind: 'file', why } });
  });

  test('takes a PNG whose bytes agree', () => {
    expect(checkedFile('shot.png', PNG)).toMatchObject({ name: 'shot.png', kind: 'png' });
  });
});

describe('whether the account can upload', () => {
  test('is what GitHub says of its writing to the pull request’s repository', async () => {
    const can = setUp([]);
    expect(await can.uploads.check('t1')).toEqual({ kind: 'open', login: 'rozed-bot' });
    expect(can.targets.map((repo) => repo.key)).toEqual([new RepoRef('rozed-dev', 'e2e').key]);
    expect(await setUp([], { canWrite: false }).uploads.check('t1')).toEqual({
      kind: 'cantWrite',
      login: 'rozed-bot',
      repo: 'e2e',
    });
    // GitHub didn't say: the upload finds out.
    expect(await setUp([], { canWrite: undefined }).uploads.check('t1')).toEqual({
      kind: 'open',
      login: 'rozed-bot',
    });
  });

  test('isn’t known for a view acting as nobody, a run of layers, or while GitHub can’t be asked', async () => {
    const nobody = setUp([], { view: info({ acting: { kind: 'anonymous' } }) });
    const run = setUp([], { view: info({ run: [94, 95] }) });
    const offline = setUp([], {
      unreadable: new GithubError({ kind: 'network', failure: 'offline', message: 'offline' }),
    });
    expect(
      await Promise.all([nobody, run, offline].map(({ uploads }) => uploads.check('t1'))),
    ).toEqual([{ kind: 'unknown' }, { kind: 'unknown' }, { kind: 'unknown' }]);
    expect([...nobody.targets, ...run.targets]).toEqual([]);
    expect(offline.logged).toEqual([
      "reading whether rozed-bot can upload to rozed-dev/e2e: couldn't reach GitHub: offline",
    ]);
  });
});

describe('uploading', () => {
  test('sends a file to the pull request’s repository and answers the Markdown that shows it, saying how far it went', async () => {
    const { uploads, sent, targets, progress } = setUp([
      ({ progress: heard }) => {
        heard?.(64, 128);
        return answers.taken();
      },
    ]);
    expect(await uploads.upload('t1', 'u1', 'retry storm.png', PNG)).toEqual({
      kind: 'uploaded',
      markdown: `![retry storm](${ASSET})`,
      viaGh: false,
    });
    expect(targets.map((repo) => repo.key)).toEqual([new RepoRef('rozed-dev', 'e2e').key]);
    expect(sent).toEqual([
      { repo: expect.any(RepoRef), name: 'retry storm.png', token: undefined },
    ]);
    expect(progress).toEqual([{ id: 't1', upload: 'u1', sent: 64, total: 128 }]);
  });

  test('sends nothing for a file it refuses, a view acting as nobody, or a run of layers', async () => {
    const { uploads, sent, targets } = setUp([]);
    expect(await uploads.upload('t1', 'u1', 'notes.txt', PNG)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'file' },
    });
    const nobody = setUp([], { view: info({ acting: { kind: 'anonymous' } }) });
    expect(await nobody.uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'refused',
      refusal: { kind: 'signIn' },
    });
    const run = setUp([], { view: info({ run: [94, 95] }) });
    expect(await run.uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'refused',
      refusal: { kind: 'run' },
    });
    expect([...sent, ...targets, ...nobody.sent, ...run.sent]).toEqual([]);
  });

  test('refuses before sending when the account can’t write to the repository', async () => {
    const { uploads, sent } = setUp([], { canWrite: false });
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'refused',
      refusal: { kind: 'cantWrite', repo: 'e2e' },
    });
    expect(sent).toEqual([]);
  });

  test('refuses while GitHub has asked Lo to hold off', async () => {
    const until = Date.now() + 60_000;
    const { uploads } = setUp([() => Promise.resolve({ refusal: 'paused', until })]);
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'refused',
      refusal: { kind: 'paused', until },
    });
  });

  test('gives up an upload under way when the window cancels it', async () => {
    const { uploads, sent } = setUp([answers.hanging]);
    const uploading = uploads.upload('t1', 'u1', 'shot.png', PNG);
    await expect.poll(() => sent.length).toBe(1);
    uploads.cancel('t1', 'u2');
    uploads.cancel('t1', 'u1');
    expect(await uploading).toEqual({ kind: 'cancelled' });
  });

  test('says a lost answer may have reached GitHub, and never sends it again', async () => {
    const lost = new GithubError({
      kind: 'network',
      failure: 'lost',
      message: 'net::ERR_CONNECTION_RESET',
    });
    const { uploads, sent, ghAsked } = setUp([answers.refused(lost)]);
    const outcome = await uploads.upload('t1', 'u1', 'shot.png', PNG);
    expect(outcome).toEqual({
      kind: 'failed',
      message:
        "couldn't reach GitHub: net::ERR_CONNECTION_RESET. It may have reached GitHub anyway; nothing went into the comment, so attach it again to try once more.",
    });
    expect(sent).toHaveLength(1);
    expect(ghAsked()).toBe(0);
  });
});

describe('gh’s sign-in, when GitHub won’t take Lo’s for uploads', () => {
  test('is asked for once, after Not Found from an account that can write, and sends the file once more with it', async () => {
    const { uploads, sent, ghAsked } = setUp([answers.refused(NOT_FOUND), answers.taken], {
      gh: () => Promise.resolve(new Token(GH_TOKEN)),
    });
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'uploaded',
      markdown: `![shot](${ASSET})`,
      viaGh: true,
    });
    expect(sent.map(({ token }) => token)).toEqual([undefined, GH_TOKEN]);
    expect(ghAsked()).toBe(1);
  });

  test('isn’t there without gh: uploads need its sign-in', async () => {
    const { uploads, sent } = setUp([answers.refused(NOT_FOUND)]);
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'refused',
      refusal: { kind: 'needsGh' },
    });
    expect(sent).toHaveLength(1);
  });

  test('isn’t asked for when GitHub didn’t say the account can write, or for any other refusal', async () => {
    const unknown = setUp([answers.refused(NOT_FOUND)], {
      canWrite: undefined,
      gh: () => Promise.resolve(new Token(GH_TOKEN)),
    });
    expect(await unknown.uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'failed',
      message:
        "GitHub answered Not Found, as it does when the account can't write to rozed-dev/e2e, or won't take Lo's sign-in for uploads.",
    });
    const tooLarge = new GithubError({
      kind: 'api',
      status: 422,
      message: 'Bad size',
      errors: [],
    });
    const other = setUp([answers.refused(tooLarge)], {
      gh: () => Promise.resolve(new Token(GH_TOKEN)),
    });
    expect(await other.uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'failed',
      message: 'GitHub refused it: Bad size.',
    });
    expect([unknown.ghAsked(), other.ghAsked()]).toEqual([0, 0]);
  });

  test('is used once: refused too, the upload fails, and isn’t sent a third time', async () => {
    const { uploads, sent, ghAsked } = setUp(
      [answers.refused(NOT_FOUND), answers.refused(NOT_FOUND)],
      { gh: () => Promise.resolve(new Token(GH_TOKEN)) },
    );
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toMatchObject({ kind: 'failed' });
    expect(sent).toHaveLength(2);
    expect(ghAsked()).toBe(1);
  });

  test('says so when gh couldn’t be asked, and never logs a token', async () => {
    const { uploads, logged } = setUp([answers.refused(NOT_FOUND)], {
      gh: () => Promise.reject(new Error("gh didn't answer within 10 s, so Lo stopped it.")),
    });
    expect(await uploads.upload('t1', 'u1', 'shot.png', PNG)).toEqual({
      kind: 'failed',
      message:
        "GitHub took no upload with Lo’s sign-in, and Lo couldn’t read gh’s: gh didn't answer within 10 s, so Lo stopped it.",
    });
    expect(logged.join('\n')).not.toContain(GH_TOKEN);
  });
});

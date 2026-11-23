// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { Blocked, Preview } from '../contract.ts';
import {
  boxClosed,
  boxStore,
  closeBox,
  currentPreview,
  enterAction,
  LOOK_AFTER,
  type BoxState,
  openBox,
  submit,
  typeText,
} from './box.ts';

const E2E = 'https://github.com/rozed-dev/e2e/pull/78';

const pull: Preview = {
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 78,
  as: { kind: 'account', login: 'rozed-bot' },
  title: 'A title',
  state: 'open',
};

const restricted: Extract<Preview, { kind: 'blocked' }> = {
  kind: 'blocked',
  owner: 'rozed-dev',
  repo: 'restricted',
  number: 3,
  why: {
    kind: 'refused',
    cause: { kind: 'unapproved', org: 'rozed-dev' },
    links: [
      {
        label: 'Request approval on GitHub',
        url: 'https://github.com/settings/connections/applications/x',
      },
    ],
    openAnyway: false,
  },
};

/** The restricted pull request, blocked for `why`. */
function refused(why: Blocked): Preview {
  return { ...restricted, kind: 'blocked', why };
}

/** What the box holds once main has said `preview` of `text`. */
function holding(text: string, preview: Preview | undefined, highlighted?: string): BoxState {
  return {
    ...boxStore.getState(),
    text,
    preview,
    lookedAt: preview === undefined ? undefined : text,
    highlighted,
  };
}

const web = (secure: boolean): Preview => ({
  kind: 'web',
  url: E2E,
  github: true,
  page: 'issue',
  secure,
});

/** What the window's bridge answers, which each test sets: the feature's client keeps one bridge. */
const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

/** Answers with `given` from now on, and forgets what was asked before. */
function answering(given: Record<string, (input: unknown) => unknown>) {
  for (const channel of Object.keys(answers)) Reflect.deleteProperty(answers, channel);
  Object.assign(answers, given);
  bridge.calls.length = 0;
  return bridge;
}

afterEach(() => {
  closeBox();
  boxClosed();
  vi.useRealTimers();
});

/** Lets the bridge's answers, and what waits on them, run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe('the open box', () => {
  it('fills itself in with the link main finds on the clipboard, and looks it up', async () => {
    answering({
      'open.clipboard': () => E2E,
      'open.look': () => pull,
    });
    openBox();
    await settle();
    expect(boxStore.getState()).toMatchObject({ open: true, text: E2E, fromClipboard: true });
    expect(currentPreview()).toEqual(pull);
    expect(bridge.calls).toEqual([
      ['open.clipboard', undefined],
      ['open.look', { text: E2E }],
    ]);
  });

  it('leaves what was typed meanwhile, and stays empty when the clipboard holds no link', async () => {
    answering({ 'open.clipboard': () => null });
    openBox();
    await settle();
    expect(boxStore.getState()).toMatchObject({ text: '', fromClipboard: false });

    const answer = { with: (_link: string): void => undefined };
    answering({
      'open.clipboard': () =>
        new Promise<string>((resolve) => {
          answer.with = resolve;
        }),
      'open.look': () => pull,
    });
    vi.useFakeTimers();
    openBox();
    typeText('https://github.com/rozed-dev/e2e/pull/7');
    answer.with(E2E);
    await settle();
    expect(boxStore.getState()).toMatchObject({ text: 'https://github.com/rozed-dev/e2e/pull/7' });
  });

  it('looks a link up once typing pauses, and only shows what main said of the text there now', async () => {
    vi.useFakeTimers();
    answering({ 'open.clipboard': () => null, 'open.look': () => pull });
    openBox();
    await settle();
    typeText('https://github.com/rozed-dev/e2e/pull/7');
    typeText(E2E);
    expect(bridge.calls.filter(([channel]) => channel === 'open.look')).toEqual([]);
    vi.advanceTimersByTime(LOOK_AFTER);
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'open.look')).toEqual([
      ['open.look', { text: E2E }],
    ]);
    expect(currentPreview()).toEqual(pull);
    typeText(`${E2E}/files`);
    expect(currentPreview()).toBeUndefined();
  });

  it('says what ⏎ does for what’s in it', () => {
    const ask: Preview = { ...pull, as: { kind: 'ask', logins: ['a', 'b'], remember: 'owner' } };
    expect(enterAction(holding('', undefined))).toBeUndefined();
    expect(enterAction(holding(E2E, undefined))).toBe('Open');
    expect(enterAction(holding(E2E, pull))).toBe('Open');
    expect(enterAction(holding(E2E, ask))).toBe('Open as a');
    expect(enterAction(holding(E2E, ask, 'b'))).toBe('Open as b');
    // A login highlighted for an earlier link that this one doesn't offer isn't who it opens as.
    expect(enterAction(holding(E2E, ask, 'c'))).toBe('Open as a');
    expect(enterAction(holding(E2E, web(true)))).toBe('Open on GitHub');
    expect(
      enterAction(holding(E2E, { kind: 'web', url: E2E, github: false, page: null, secure: true })),
    ).toBe('Open in browser');
    expect(enterAction(holding(E2E, web(false)))).toBe('Copy link');
    expect(enterAction(holding('x', { kind: 'invalid', why: 'link' }))).toBeUndefined();
    expect(enterAction(holding(E2E, restricted))).toBe('Request approval on GitHub');
    const unapproved = { kind: 'unapproved', org: 'rozed-dev' } as const;
    expect(
      enterAction(
        holding(E2E, refused({ kind: 'refused', cause: unapproved, links: [], openAnyway: true })),
      ),
    ).toBe('Open anyway');
    expect(
      enterAction(
        holding(
          E2E,
          refused({
            kind: 'refused',
            cause: { kind: 'signedOut', login: 'rozed-bot' },
            links: [],
            openAnyway: false,
          }),
        ),
      ),
    ).toBe('Sign in again');
    expect(
      enterAction(
        holding(
          E2E,
          refused({
            kind: 'refused',
            cause: { kind: 'unreadable', login: 'rozed-bot' },
            links: [],
            openAnyway: false,
          }),
        ),
      ),
    ).toBe('Try again');
    expect(enterAction(holding(E2E, refused({ kind: 'hidden', signedIn: false })))).toBe(
      'Sign in with GitHub…',
    );
    expect(enterAction(holding(E2E, refused({ kind: 'missing' })))).toBeUndefined();
    // GitHub's rate limit holds opening anyway too: nothing to press.
    const limit = { kind: 'rateLimit', resets: null } as const;
    expect(
      enterAction(
        holding(E2E, refused({ kind: 'refused', cause: limit, links: [], openAnyway: true })),
      ),
    ).toBeUndefined();
    expect(enterAction(holding(E2E, refused({ kind: 'unchecked', cause: limit })))).toBeUndefined();
    expect(enterAction({ ...holding(E2E, pull), error: { title: 'x', retry: true } })).toBe(
      'Try again',
    );
  });

  it('opens GitHub’s page for asking an organization to approve Lo on ⏎, and nothing else', async () => {
    answering({
      'open.clipboard': () => null,
      'open.look': () => restricted,
      'tab.openExternal': () => undefined,
    });
    openBox('https://github.com/rozed-dev/restricted/pull/3');
    await settle();
    submit();
    await settle();
    expect(bridge.calls.slice(-1)).toEqual([
      ['tab.openExternal', { url: 'https://github.com/settings/connections/applications/x' }],
    ]);
    expect(bridge.calls.some(([channel]) => channel === 'open.open')).toBe(false);
  });

  it('looks a link up again on ⏎ when its account’s sign-in couldn’t be read', async () => {
    const unreadable = refused({
      kind: 'refused',
      cause: { kind: 'unreadable', login: 'rozed-bot' },
      links: [],
      openAnyway: false,
    });
    const looks: Preview[] = [unreadable, pull];
    answering({ 'open.look': () => looks.shift() });
    openBox(E2E);
    await settle();
    expect(currentPreview()).toEqual(unreadable);
    submit();
    await settle();
    expect(bridge.calls).toEqual([
      ['open.look', { text: E2E }],
      ['open.look', { text: E2E }],
    ]);
    expect(currentPreview()).toEqual(pull);
    expect(boxStore.getState().open).toBe(true);
  });

  it('copies a plain http link on ⏎, and hands it to nothing', async () => {
    const insecure = 'http://example.com/x';
    answering({
      'open.look': () => ({ kind: 'web', url: insecure, github: false, page: null, secure: false }),
      'tab.copy': () => undefined,
    });
    openBox(insecure);
    await settle();
    submit();
    await settle();
    expect(bridge.calls.slice(1)).toEqual([['tab.copy', { text: insecure }]]);
    expect(boxStore.getState().open).toBe(false);
  });

  it('opens a pull request and closes, or stays open and says why main didn’t', async () => {
    const opened: unknown[] = [];
    answering({
      'open.look': () => pull,
      'open.open': (input) => {
        opened.push(input);
        return { kind: 'tab', id: 't1', choice: 'account' };
      },
    });
    openBox(E2E);
    await settle();
    submit();
    await settle();
    expect(opened).toEqual([{ text: E2E }]);
    expect(boxStore.getState().open).toBe(false);

    answering({
      'open.look': () => web(true),
      'open.open': () => ({ kind: 'refused', why: 'cameBack' }),
    });
    openBox('https://github.com/rozed-dev/e2e/issues/1');
    await settle();
    submit();
    await settle();
    expect(boxStore.getState()).toMatchObject({
      open: true,
      error: { title: 'Couldn’t open the link', reason: 'The browser sent it straight back.' },
    });
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { Preview } from '../contract.ts';
import {
  boxClosed,
  boxStore,
  closeBox,
  currentPreview,
  enterAction,
  LOOK_AFTER,
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

const restricted: Preview = {
  kind: 'blocked',
  owner: 'rozed-dev',
  repo: 'restricted',
  number: 3,
  title: 'rozed-dev hasn’t approved Lo',
  message: '…',
  links: [
    {
      label: 'Request approval on GitHub',
      url: 'https://github.com/settings/connections/applications/x',
    },
  ],
  signIn: true,
  openAnyway: false,
};

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
    expect(enterAction(undefined, '')).toBeUndefined();
    expect(enterAction(undefined, E2E)).toBe('Open');
    expect(enterAction(pull, E2E)).toBe('Open');
    expect(
      enterAction({ ...pull, as: { kind: 'ask', logins: ['a', 'b'], remember: 'owner' } }, E2E),
    ).toBe('Open as the account chosen');
    expect(enterAction({ kind: 'web', url: E2E, title: '', message: '', browse: true }, E2E)).toBe(
      'Open in the browser',
    );
    expect(enterAction({ kind: 'web', url: E2E, title: '', message: '', browse: false }, E2E)).toBe(
      'Copy the link',
    );
    expect(enterAction({ kind: 'invalid', message: '' }, 'x')).toBeUndefined();
    expect(enterAction(restricted, E2E)).toBe('Request approval on GitHub');
    expect(enterAction({ ...restricted, links: [], openAnyway: true }, E2E)).toBe('Open anyway');
    expect(enterAction({ ...restricted, links: [] }, E2E)).toBe('Add an account');
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

  it('copies a plain http link on ⏎, and hands it to nothing', async () => {
    const insecure = 'http://example.com/x';
    answering({
      'open.look': () => ({ kind: 'web', url: insecure, title: '', message: '', browse: false }),
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
      'open.look': () => ({ kind: 'web', url: E2E, title: '', message: '', browse: true }),
      'open.open': () => ({ kind: 'refused', message: 'It came straight back.' }),
    });
    openBox('https://github.com/rozed-dev/e2e/issues/1');
    await settle();
    submit();
    await settle();
    expect(boxStore.getState()).toMatchObject({ open: true, error: 'It came straight back.' });
  });
});

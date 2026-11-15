// Asking the reader to trust: nothing but "Trust" in main's own dialog, pressed while the window
// is there, writes an entry, and only the entry that dialog named.

import type { PullRequestRepositories } from '@lo/github';
import { describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { TrustEntry } from '../settings.ts';
import {
  BUTTONS,
  questionFor,
  TrustAsker,
  type AskedView,
  type AskOptions,
  type AskWindow,
  type Question,
  type TrustRequest,
} from './confirm.ts';

const E2E = { id: 'R_kgDOVleUfQ', name: 'rozed-dev/e2e' };
const FORK = { id: 'R_kgDOVvlr6A', name: 'rozed-bot/e2e' };
const NOW = new Date('2026-11-15T09:12:44.000Z');

const OWN: PullRequestRepositories = { base: E2E, head: E2E, isCrossRepository: false };
const FORKED: PullRequestRepositories = { base: E2E, head: FORK, isCrossRepository: true };
const GONE: PullRequestRepositories = { base: E2E, head: undefined, isCrossRepository: true };

const TRUST = BUTTONS.indexOf('Trust');
const CANCEL = BUTTONS.indexOf('Cancel');

/** A dialog the test answers: what it was asked, and the answer it gives each. */
interface Asked {
  /** The window it's attached to. */
  readonly window: TestWindow;
  readonly question: Question;
  readonly signal: AbortSignal;
  answer(button: number): void;
}

/** A window the test can close. */
class TestWindow implements AskWindow {
  readonly #listeners = new Set<() => void>();
  onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  close(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** An asker over the views `views`, reading `read` for each, with a dialog the test answers. */
function asker(
  views: Record<string, AskedView>,
  read: (view: AskedView) => Promise<PullRequestRepositories> = () => Promise.resolve(OWN),
  change: Partial<AskOptions<TestWindow>> = {},
) {
  const window = new TestWindow();
  const dialogs: Asked[] = [];
  const written: TrustEntry[] = [];
  const write = vi.fn<(entry: TrustEntry) => Promise<void>>(async (entry) => {
    written.push(entry);
  });
  const real = new TrustAsker<TestWindow>({
    view: (id) => views[id],
    read,
    confirm: (at, question, signal) =>
      new Promise((resolve) => {
        dialogs.push({ window: at, question, signal, answer: resolve });
      }),
    write,
    now: () => NOW,
    ...change,
  });
  /** The asker, asked from the test's window. */
  const trust = {
    ask: (request: TrustRequest) => real.ask(request, window),
    get asking() {
      return real.asking;
    },
  };
  return { real, trust, window, dialogs, written, write };
}

const views: Record<string, AskedView> = {
  t1: { id: 't1', repo: 'rozed-dev/e2e', number: 80 },
  t2: { id: 't2', repo: 'rozed-dev/e2e', number: 97 },
  t3: { id: 't3', repo: 'rozed-dev/other', number: 3 },
};

/** Lets what's waiting on promises settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 100 && !done(); round++) await Promise.resolve();
  expect(done()).toBe(true);
}

async function refusal(promise: Promise<unknown>): Promise<IpcError | undefined> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(IpcError);
  return error instanceof IpcError ? error : undefined;
}

describe('the dialog', () => {
  it('asks about a repository, Cancel its default and its Esc', () => {
    expect(questionFor({ kind: 'repo', repo: 'fieldwork/atlas-api', id: 'R_1' })).toEqual({
      type: 'warning',
      message: 'Trust fieldwork/atlas-api?',
      detail:
        'Lo will check out its pull requests and run language servers on them. A language server can run code from the repository, such as its build files.',
      buttons: ['Trust', 'Cancel'],
      defaultId: CANCEL,
      cancelId: CANCEL,
      noLink: true,
    });
  });

  it('asks about a fork’s pull request, saying later pushes are trusted too', () => {
    const question = questionFor({
      kind: 'pull',
      repo: 'fieldwork/atlas-api',
      id: 'R_1',
      pull: 4833,
      from: 'sam-whit/atlas-api',
      fromId: 'R_2',
    });
    expect(question.message).toBe('Trust pull request #4833 from sam-whit/atlas-api?');
    expect(question.detail).toBe(
      'Lo will check it out and run language servers on it. A language server can run code from the repository, such as its build files. Later pushes to this pull request are trusted too.',
    );
    expect([question.buttons[question.defaultId], question.buttons[question.cancelId]]).toEqual([
      'Cancel',
      'Cancel',
    ]);
  });
});

describe('asking to trust', () => {
  it('writes the repository’s entry once the reader says Trust, and only then', async () => {
    const { trust, dialogs, written } = asker(views);
    const asking = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
    await until(() => dialogs.length === 1);
    // The window's request alone has written nothing.
    expect(written).toEqual([]);
    expect(dialogs[0]?.question.message).toBe('Trust rozed-dev/e2e?');
    dialogs[0]?.answer(TRUST);
    expect(await asking).toBe('trusted');
    expect(written).toEqual([
      { kind: 'repo', repo: 'rozed-dev/e2e', id: E2E.id, at: '2026-11-15T09:12:44.000Z' },
    ]);
  });

  it('writes nothing for ⏎ held down, for Esc, or for Cancel', async () => {
    const { trust, dialogs, write } = asker(views);
    const presses: ((question: Question) => number)[] = [
      // ⏎, held down from the banner: the dialog's default, each time it asks.
      ...Array.from({ length: 5 }, () => (question: Question) => question.defaultId),
      // Esc.
      (question) => question.cancelId,
      () => CANCEL,
    ];
    for (const press of presses) {
      const asking = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
      await until(() => dialogs.length === 1);
      const [shown] = dialogs;
      shown?.answer(press(shown.question));
      expect(await asking).toBe('cancelled');
      dialogs.length = 0;
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('asks in the window that asked, which alone cancels it by closing', async () => {
    const { real, window, dialogs, write } = asker(views);
    const other = new TestWindow();
    const asking = real.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null }, other);
    await until(() => dialogs.length === 1);
    expect(dialogs[0]?.window).toBe(other);
    // Another window closing leaves the dialog asking.
    window.close();
    expect(dialogs[0]?.signal.aborted).toBe(false);
    other.close();
    expect(dialogs[0]?.signal.aborted).toBe(true);
    dialogs[0]?.answer(TRUST);
    expect(await asking).toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses, asking nothing, a repository GitHub names in a way it doesn’t allow', async () => {
    for (const name of [
      'rozed-dev/e2e\nTrust rozed-dev/safe',
      'rozed-dev/\u202Eppa',
      'rozed-dev/e2e ',
      '../e2e',
    ]) {
      for (const repositories of [
        { base: { ...E2E, name }, head: FORK, isCrossRepository: true },
        { base: E2E, head: { ...FORK, name }, isCrossRepository: true },
      ]) {
        const { trust, dialogs, write } = asker(views, () => Promise.resolve(repositories));
        const refused = await refusal(trust.ask({ view: 't2', repo: 'rozed-dev/e2e', pull: 97 }));
        expect(refused?.code).toBe('refused');
        expect(dialogs).toEqual([]);
        expect(write).not.toHaveBeenCalled();
      }
    }
  });

  it('writes nothing once the window closes during the dialog, whatever it answers', async () => {
    const { trust, window, dialogs, write } = asker(views);
    const asking = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
    await until(() => dialogs.length === 1);
    window.close();
    // Closing it closes the dialog, as if cancelled; an answer that comes anyway counts for nothing.
    expect(dialogs[0]?.signal.aborted).toBe(true);
    dialogs[0]?.answer(TRUST);
    expect(await asking).toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
  });

  it('asks nothing, and writes nothing, once the window closes while GitHub is read', async () => {
    let answer: ((repositories: PullRequestRepositories) => void) | undefined;
    const { trust, window, dialogs, write } = asker(
      views,
      () => new Promise((resolve) => (answer = resolve)),
    );
    const asking = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
    await until(() => answer !== undefined);
    window.close();
    answer?.(OWN);
    expect(await asking).toBe('cancelled');
    expect(dialogs).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('asks one dialog at a time: a second request meanwhile is refused, and writes nothing', async () => {
    const { trust, dialogs, written } = asker(views, (view) =>
      Promise.resolve(view.number === 97 ? FORKED : OWN),
    );
    const first = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
    const second = trust.ask({ view: 't2', repo: 'rozed-dev/e2e', pull: 97 });
    expect((await refusal(second))?.code).toBe('busy');
    await until(() => dialogs.length === 1);
    dialogs[0]?.answer(TRUST);
    expect(await first).toBe('trusted');
    // The one dialog's entry alone.
    expect(written).toEqual([expect.objectContaining({ kind: 'repo', id: E2E.id })]);
    expect(dialogs).toHaveLength(1);
    // And once it's answered, another may ask.
    const third = trust.ask({ view: 't2', repo: 'rozed-dev/e2e', pull: 97 });
    await until(() => dialogs.length === 2);
    dialogs[1]?.answer(CANCEL);
    expect(await third).toBe('cancelled');
  });

  it('refuses a request for another repository than the view’s, asking nothing', async () => {
    const read = vi.fn<(view: AskedView) => Promise<PullRequestRepositories>>(() =>
      Promise.resolve(OWN),
    );
    const { trust, dialogs, write } = asker(views, read);
    expect(
      (await refusal(trust.ask({ view: 't1', repo: 'rozed-dev/other', pull: null })))?.code,
    ).toBe('invalid');
    expect((await refusal(trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: 81 })))?.code).toBe(
      'invalid',
    );
    expect(
      (await refusal(trust.ask({ view: 't9', repo: 'rozed-dev/e2e', pull: null })))?.code,
    ).toBe('missing');
    expect(read).not.toHaveBeenCalled();
    expect(dialogs).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a repository GitHub names otherwise than the window did, asking nothing', async () => {
    // The tab says rozed-dev/other, and GitHub says its pull request is in rozed-dev/e2e.
    const { trust, dialogs, write } = asker(views, () => Promise.resolve(OWN));
    const refused = await refusal(trust.ask({ view: 't3', repo: 'rozed-dev/other', pull: null }));
    expect(refused?.code).toBe('changed');
    expect(dialogs).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('writes what the dialog named, though the view changes meanwhile', async () => {
    const changing: Record<string, AskedView> = { ...views };
    const { trust, dialogs, written } = asker(changing);
    const asking = trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null });
    await until(() => dialogs.length === 1);
    changing.t1 = { id: 't1', repo: 'rozed-dev/other', number: 3 };
    dialogs[0]?.answer(TRUST);
    expect(await asking).toBe('trusted');
    expect(written).toEqual([expect.objectContaining({ repo: 'rozed-dev/e2e', id: E2E.id })]);
  });

  it('trusts a fork’s pull request alone, by its fork’s ID', async () => {
    const { trust, dialogs, written } = asker(views, () => Promise.resolve(FORKED));
    const asking = trust.ask({ view: 't2', repo: 'rozed-dev/e2e', pull: 97 });
    await until(() => dialogs.length === 1);
    expect(dialogs[0]?.question.message).toBe('Trust pull request #97 from rozed-bot/e2e?');
    dialogs[0]?.answer(TRUST);
    expect(await asking).toBe('trusted');
    expect(written).toEqual([
      {
        kind: 'pull',
        repo: 'rozed-dev/e2e',
        id: E2E.id,
        pull: 97,
        from: 'rozed-bot/e2e',
        fromId: FORK.id,
        at: '2026-11-15T09:12:44.000Z',
      },
    ]);
  });

  it('refuses to trust as a pull request one from the repository’s own branch, or a gone fork', async () => {
    for (const repositories of [OWN, GONE]) {
      const { trust, dialogs, write } = asker(views, () => Promise.resolve(repositories));
      const refused = await refusal(trust.ask({ view: 't2', repo: 'rozed-dev/e2e', pull: 97 }));
      expect(refused?.code).toBe('refused');
      expect(dialogs).toEqual([]);
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('asks nothing when GitHub can’t be read, or there’s no window to ask in', async () => {
    const failing = asker(views, () => Promise.reject(new Error('offline')));
    expect(
      (await refusal(failing.trust.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null })))?.code,
    ).toBe('unread');
    expect(failing.dialogs).toEqual([]);
    const windowless = asker(views);
    expect(
      (
        await refusal(
          windowless.real.ask({ view: 't1', repo: 'rozed-dev/e2e', pull: null }, undefined),
        )
      )?.code,
    ).toBe('unavailable');
    expect(failing.write).not.toHaveBeenCalled();
    expect(windowless.write).not.toHaveBeenCalled();
    // Neither leaves it asking.
    expect(failing.trust.asking).toBe(false);
  });
});

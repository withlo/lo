// Asking the reader to trust a repository, or one pull request from a fork: the only way Lo comes
// to trust one. The window only asks main to ask; main reads from GitHub what the pull request
// joins, asks in a dialog of its own attached to the window that asked, which a page can't answer
// for the reader, and writes what that dialog named only once the reader trusts it there. It
// names only what GitHub calls by a name GitHub allows, so no line break or direction mark ever
// reaches it. "Cancel" is the dialog's default and its `Esc`, so a key held down from the banner
// never trusts anything. One dialog at a time, for all of Lo: asked about another view meanwhile,
// it says so, and brings its dialog forward. Meanwhile it says how far it has got, for the window
// to show. It waits a while at most for GitHub, giving up on the read once nobody waits on it, so
// it leaves the account's queue; the settings file is local, and its write ends or fails, so Lo
// never says it couldn't trust what it then trusts. Nothing here calls Electron, so it runs under
// unit tests.

import { causeOf, saidBy, type PullRequestRepositories } from '@lo/github';

import { detailsOf, githubCause } from '../../../ipc/cause.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { Unwritten } from '../../settings/service.ts';
import type { Asked, Trusting } from '../contract.ts';
import { repoName, sameName, type TrustEntry } from '../settings.ts';

/**
 * How long Lo waits for GitHub to say which repo a view's is, in ms, before it gives up on the read
 * and says it couldn't.
 */
export const READ_LIMIT = 30_000;

/** What the reader is asked to trust: a repository, or one pull request from a fork. */
export type Subject =
  | { readonly kind: 'repo'; readonly repo: string; readonly id: string }
  | {
      readonly kind: 'pull';
      readonly repo: string;
      readonly id: string;
      readonly pull: number;
      readonly from: string;
      readonly fromId: string;
    };

/** A native dialog's question, as Electron's `showMessageBox` takes it. */
export interface Question {
  readonly type: 'warning';
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  /** The button `⏎` presses: "Cancel". */
  readonly defaultId: number;
  /** The button `Esc` presses: "Cancel". */
  readonly cancelId: number;
  readonly noLink: true;
}

/** The dialog's buttons for each kind of subject, in order: the one that trusts, then "Cancel". */
export const BUTTONS = {
  repo: ['Trust repo', 'Cancel'],
  pull: ['Trust pull request', 'Cancel'],
} as const;
const TRUST = 0;
const CANCEL = 1;

/** The dialog that asks whether to trust `subject`. */
export function questionFor(subject: Subject): Question {
  const asked = { type: 'warning', defaultId: CANCEL, cancelId: CANCEL, noLink: true } as const;
  if (subject.kind === 'repo') {
    return {
      ...asked,
      buttons: BUTTONS.repo,
      message: `Trust ${subject.repo}?`,
      detail:
        'Language servers read this repo’s code and settings. They aren’t sandboxed. Trust only repos whose code you’d run.',
    };
  }
  return {
    ...asked,
    buttons: BUTTONS.pull,
    message: `Trust #${subject.pull} from ${subject.from}?`,
    detail:
      'Language servers read this pull request’s code and settings, at every revision. They aren’t sandboxed. Trust only code you’d run.',
  };
}

/** The entry that trusts `subject`, trusted at `at`. */
export function entryFor(subject: Subject, at: Date): TrustEntry {
  return { ...subject, at: at.toISOString() };
}

/** What the asker needs of a view, as the tab has it when the window asks. */
export interface AskedView {
  readonly id: string;
  /** Its repository, `owner/name`, as the tab names it. */
  readonly repo: string;
  readonly number: number;
}

/** The window the dialog is attached to, while it's open. */
export interface AskWindow {
  /** Calls `listener` once the window closes. Returns a function that stops it. */
  onClosed(listener: () => void): () => void;
}

export interface AskOptions<W extends AskWindow> {
  /** View `id` as the tab has it now, or nothing for no such view. */
  readonly view: (id: string) => AskedView | undefined;
  /**
   * Reads afresh the repositories `view`'s pull request joins, from GitHub. Once `signal` aborts,
   * nobody waits on it: a read still waiting its turn in the account's queue leaves it.
   */
  readonly read: (view: AskedView, signal: AbortSignal) => Promise<PullRequestRepositories>;
  /**
   * Shows `question` in main's dialog, attached to `window`, and answers the index of the button
   * the reader pressed. Once `signal` aborts, the dialog closes as if cancelled.
   */
  readonly confirm: (window: W, question: Question, signal: AbortSignal) => Promise<number>;
  /**
   * Trusts `entry`: writes it in the settings file. Fails with an {@link Unwritten} that says why it
   * couldn't.
   */
  readonly write: (entry: TrustEntry) => Promise<void>;
  /** Hears how far trusting view `view` has got, and, with nothing, that it's over. */
  readonly progress?: (view: string, step: Trusting | undefined) => void;
  /** Brings `window`, and the dialog attached to it, to the front. */
  readonly focus?: (window: W) => void;
  readonly now?: () => Date;
  /** How long GitHub's read may take, in ms: {@link READ_LIMIT}. */
  readonly readLimit?: number;
}

/** What the window asks: to trust view `view`'s repository, named `repo`, or its pull request. */
export interface TrustRequest {
  readonly view: string;
  readonly repo: string;
  readonly pull: number | null;
}

/**
 * What the dialog asks about, from what GitHub says `view`'s pull request joins: the repository,
 * as the window named it, or, given `pull`, the pull request from its fork. Throws an `IpcError`
 * for what can't be asked.
 */
export function subjectOf(
  request: TrustRequest,
  view: AskedView,
  repositories: PullRequestRepositories,
): Subject {
  const { base, head, isCrossRepository } = repositories;
  for (const named of [base, head]) {
    if (named && !repoName.safeParse(named.name).success) {
      // What GitHub named it, behind Details.
      throw new IpcError('unexpectedName', named.name.slice(0, 200));
    }
  }
  if (!sameName(base.name, request.repo)) {
    // The name GitHub has for it now, which the window says.
    throw new IpcError('renamed', base.name);
  }
  if (request.pull === null) return { kind: 'repo', repo: base.name, id: base.id };
  if (!isCrossRepository) {
    throw new IpcError('notFork', '');
  }
  if (!head) {
    throw new IpcError('forkGone', '');
  }
  return {
    kind: 'pull',
    repo: base.name,
    id: base.id,
    pull: view.number,
    from: head.name,
    fromId: head.id,
  };
}

/**
 * Why the entry wasn't written, for the window, which says it where the reader asked: what the
 * settings file holds, which editing it fixes (`settingsFile`), or anything else (`unsaved`), with
 * what was wrong behind Details.
 */
export function unsaved(error: unknown): IpcError {
  if (error instanceof Unwritten && error.inFile) return new IpcError('settingsFile', error.why);
  if (error instanceof Unwritten) return new IpcError('unsaved', error.why);
  return new IpcError('unsaved', error instanceof Error ? error.message : '');
}

/** The ask under way: what it's about, in which window, how far it has got, and what ends it. */
interface Current<W> {
  readonly request: TrustRequest;
  readonly window: W | undefined;
  step?: Trusting | undefined;
  /** Aborts once the window or the view closes: whatever it answers then counts for nothing. */
  readonly gone: AbortController;
}

/** Asks the reader to trust what the window names, one dialog at a time. */
export class TrustAsker<W extends AskWindow = AskWindow> {
  readonly #options: AskOptions<W>;
  #current: Current<W> | undefined;

  constructor(options: AskOptions<W>) {
    this.#options = options;
  }

  /** Whether a dialog is being asked, or about to be. */
  get asking(): boolean {
    return this.#current !== undefined;
  }

  /**
   * Asks in `window`, the window that sent `request`, and answers how it went: `trusted` once the
   * reader said to trust and the entry is written, `cancelled` for any other answer, or once that
   * window, or the view, closed meanwhile. Throws an `IpcError` for a request it won't ask, with no
   * window to ask in, and while it's asking already, so two requests never share a dialog: `busy`
   * for the same view, which asks already, and `asking` for another, saying which, once its dialog
   * is brought forward; and, once the reader said to trust, for an entry it couldn't write
   * ({@link unsaved}). GitHub's read failing or taking too long answers `unread`, by its cause. Meanwhile `progress`
   * hears each step, and that it's over.
   */
  async ask(request: TrustRequest, window: W | undefined): Promise<Asked> {
    const current = this.#current;
    if (current) {
      if (current.request.view === request.view) {
        throw new IpcError('busy', 'Lo is already asking whether to trust it.');
      }
      if (current.step === 'asking' && current.window) this.#options.focus?.(current.window);
      const { repo, pull } = current.request;
      // What it's asking about, which the window names.
      throw new IpcError('asking', pull === null ? repo : `${repo}#${pull}`);
    }
    const asked: Current<W> = { request, window, gone: new AbortController() };
    this.#current = asked;
    try {
      return await this.#ask(asked);
    } finally {
      this.#current = undefined;
    }
  }

  /** Hears that view `id` changed: once its tab has closed, the ask about it ends, as if cancelled. */
  update(id: string): void {
    const current = this.#current;
    if (current?.request.view === id && !this.#options.view(id)) current.gone.abort();
  }

  async #ask(asked: Current<W>): Promise<Asked> {
    const { request, window, gone } = asked;
    const options = this.#options;
    const view = options.view(request.view);
    if (!view) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
    if (!sameName(view.repo, request.repo)) {
      throw new IpcError('invalid', `That tab is of ${view.repo}, not ${request.repo}.`);
    }
    if (request.pull !== null && request.pull !== view.number) {
      throw new IpcError('invalid', `That tab is of #${view.number}, not #${request.pull}.`);
    }
    if (!window) throw new IpcError('unavailable', 'Lo has no window to ask in.');
    const stop = window.onClosed(() => gone.abort());
    const step = (now: Trusting | undefined) => {
      asked.step = now;
      options.progress?.(request.view, now);
    };
    try {
      step('reading');
      const repositories = await this.#read(view, gone.signal);
      if (!repositories || gone.signal.aborted) return 'cancelled';
      if ('kind' in repositories) return repositories;
      const subject = subjectOf(request, view, repositories);
      step('asking');
      const answer = await options.confirm(window, questionFor(subject), gone.signal);
      // Only the trust button, pressed while the window and the view were there to ask in, trusts.
      if (gone.signal.aborted || answer !== TRUST) return 'cancelled';
      step('saving');
      // Not given up on: once the reader said to trust, Lo says it couldn't only once it hasn't.
      try {
        await options.write(entryFor(subject, options.now?.() ?? new Date()));
      } catch (error) {
        throw unsaved(error);
      }
      return 'trusted';
    } finally {
      stop();
      step(undefined);
    }
  }

  /**
   * Reads `view`'s repositories from GitHub, or nothing once `gone` aborts first. The read is given
   * up on then, or once the limit passes, which is `unread` as GitHub not answering in time; any
   * other failure is `unread` by GitHub's cause.
   */
  async #read(
    view: AskedView,
    gone: AbortSignal,
  ): Promise<PullRequestRepositories | Extract<Asked, { kind: 'unread' }> | undefined> {
    const reading = new AbortController();
    const giveUp = () => reading.abort(new Error('Nobody waits on it.'));
    const timer = setTimeout(giveUp, this.#options.readLimit ?? READ_LIMIT);
    gone.addEventListener('abort', giveUp, { once: true });
    try {
      return await new Promise<PullRequestRepositories>((resolve, reject) => {
        reading.signal.addEventListener('abort', () => reject(new Error('Given up on.')), {
          once: true,
        });
        this.#options.read(view, reading.signal).then(resolve, reject);
      });
    } catch (error) {
      if (gone.aborted) return undefined;
      // Why, by its cause, with what GitHub or the system said behind Details.
      if (reading.signal.aborted) return { kind: 'unread', cause: { kind: 'timeout' } };
      const [owner] = view.repo.split('/');
      return {
        kind: 'unread',
        cause: githubCause(causeOf(error, { owner })),
        details: detailsOf(saidBy(error)),
      };
    } finally {
      clearTimeout(timer);
      gone.removeEventListener('abort', giveUp);
    }
  }
}

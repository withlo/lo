// Asking the reader to trust a repository, or one pull request from a fork: the only way Lo comes
// to trust one. The window only asks main to ask; main reads from GitHub what the pull request
// joins, asks in a dialog of its own attached to the window that asked, which a page can't answer
// for the reader, and writes what that dialog named only once the reader says "Trust" there. It
// names only what GitHub calls by a name GitHub allows, so no line break or direction mark ever
// reaches it. "Cancel" is the dialog's default and its `Esc`, so a key held down from the banner
// never trusts anything. One dialog at a time, for all of Lo. Nothing here calls Electron, so it
// runs under unit tests.

import type { PullRequestRepositories } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { Asked } from '../contract.ts';
import { repoName, sameName, type TrustEntry } from '../settings.ts';

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

/** The dialog's buttons, in order. */
export const BUTTONS = ['Trust', 'Cancel'] as const;
const TRUST = BUTTONS.indexOf('Trust');
const CANCEL = BUTTONS.indexOf('Cancel');

const RUNS_CODE = 'A language server can run code from the repository, such as its build files.';

/** The dialog that asks whether to trust `subject`. */
export function questionFor(subject: Subject): Question {
  const asked = { type: 'warning', buttons: BUTTONS, defaultId: CANCEL, cancelId: CANCEL } as const;
  if (subject.kind === 'repo') {
    return {
      ...asked,
      message: `Trust ${subject.repo}?`,
      detail: `Lo will check out its pull requests and run language servers on them. ${RUNS_CODE}`,
      noLink: true,
    };
  }
  return {
    ...asked,
    message: `Trust pull request #${subject.pull} from ${subject.from}?`,
    detail: `Lo will check it out and run language servers on it. ${RUNS_CODE} Later pushes to this pull request are trusted too.`,
    noLink: true,
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
  /** Reads afresh the repositories `view`'s pull request joins, from GitHub. */
  readonly read: (view: AskedView) => Promise<PullRequestRepositories>;
  /**
   * Shows `question` in main's dialog, attached to `window`, and answers the index of the button
   * the reader pressed. Once `signal` aborts, the dialog closes as if cancelled.
   */
  readonly confirm: (window: W, question: Question, signal: AbortSignal) => Promise<number>;
  /** Trusts `entry`: writes it in the settings file. */
  readonly write: (entry: TrustEntry) => Promise<void>;
  readonly now?: () => Date;
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
      throw new IpcError(
        'refused',
        "GitHub named a repository of this PR in a way Lo doesn't expect, so Lo didn't ask about it.",
      );
    }
  }
  if (!sameName(base.name, request.repo)) {
    throw new IpcError(
      'changed',
      `GitHub calls this repository ${base.name} now, so Lo didn't ask about ${request.repo}. Reopen its tab to trust it.`,
    );
  }
  if (request.pull === null) return { kind: 'repo', repo: base.name, id: base.id };
  if (!isCrossRepository) {
    throw new IpcError(
      'refused',
      `This PR's branch is in ${base.name} itself, so Lo trusts it with the repo. Trust the repo instead.`,
    );
  }
  if (!head) {
    throw new IpcError(
      'refused',
      "GitHub no longer has the fork this PR comes from, so Lo can't tell whose code it is.",
    );
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

/** Asks the reader to trust what the window names, one dialog at a time. */
export class TrustAsker<W extends AskWindow = AskWindow> {
  readonly #options: AskOptions<W>;
  #asking = false;

  constructor(options: AskOptions<W>) {
    this.#options = options;
  }

  /** Whether a dialog is being asked, or about to be. */
  get asking(): boolean {
    return this.#asking;
  }

  /**
   * Asks in `window`, the window that sent `request`, and answers how it went: `trusted` once the
   * reader said "Trust" and the entry is written, `cancelled` for any other answer, or once that
   * window closed meanwhile. Throws an `IpcError` for a request it won't ask, with no window to ask
   * in, and while it's asking already (`busy`), so two requests never share a dialog.
   */
  async ask(request: TrustRequest, window: W | undefined): Promise<Asked> {
    if (this.#asking) {
      throw new IpcError('busy', 'Lo is already asking whether to trust a repo.');
    }
    this.#asking = true;
    try {
      return await this.#ask(request, window);
    } finally {
      this.#asking = false;
    }
  }

  async #ask(request: TrustRequest, window: W | undefined): Promise<Asked> {
    const options = this.#options;
    const view = options.view(request.view);
    if (!view) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (!sameName(view.repo, request.repo)) {
      throw new IpcError('invalid', `That tab is of ${view.repo}, not ${request.repo}.`);
    }
    if (request.pull !== null && request.pull !== view.number) {
      throw new IpcError('invalid', `That tab is of #${view.number}, not #${request.pull}.`);
    }
    if (!window) throw new IpcError('unavailable', 'Lo has no window to ask in.');
    const closed = new AbortController();
    const stop = window.onClosed(() => closed.abort());
    try {
      let repositories: PullRequestRepositories;
      try {
        repositories = await options.read(view);
      } catch {
        throw new IpcError(
          'unread',
          "Lo couldn't read from GitHub which repo this is, so it didn't ask. Try again.",
        );
      }
      if (closed.signal.aborted) return 'cancelled';
      const subject = subjectOf(request, view, repositories);
      const answer = await options.confirm(window, questionFor(subject), closed.signal);
      // Only "Trust", pressed while the window was there to ask in, trusts anything.
      if (closed.signal.aborted || answer !== TRUST) return 'cancelled';
      await options.write(entryFor(subject, options.now?.() ?? new Date()));
      return 'trusted';
    } finally {
      stop();
    }
  }
}

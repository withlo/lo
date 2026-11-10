/**
 * Viewed marks as a pull request's tab shows them: GitHub's, with the marks Lo is setting on top
 * until GitHub has answered (`docs/design.md`, "Viewed marks").
 *
 * `e` marks the current file viewed, or clears the mark of a file that's viewed. The new mark shows
 * at once. If the write fails, the file shows GitHub's mark again and a toast says why.
 */

import type { FileViewedState, GithubError } from '@lo/github';

/** What `e` asked GitHub to do to a file. */
export interface ViewedToggle {
  readonly path: string;
  /** Whether it marks the file viewed, or clears its mark. */
  readonly mark: boolean;
  /** Which toggle it was, counting from 1, so a write that finishes after a later toggle of the same file doesn't undo it. */
  readonly id: number;
}

/** The mark a file shows once a toggle's write succeeds. */
export function toggledState(toggle: ViewedToggle): FileViewedState {
  return toggle.mark ? 'VIEWED' : 'UNVIEWED';
}

/** A mark set in Lo whose write hasn't finished. */
interface Setting {
  state: FileViewedState;
  toggle: number;
}

/** How many files show as viewed, and how many have a mark. */
export interface ViewedCount {
  viewed: number;
  files: number;
}

/** GitHub's viewed marks for the account acting, and the ones Lo is setting. */
export class ViewedMarks {
  /** GitHub's marks, by path, as last read. */
  #github = new Map<string, FileViewedState>();
  /**
   * Every path GitHub lists for the pull request, when it listed them all. GitHub caps a pull
   * request's files, and leaves out what it can't show.
   */
  #listed: ReadonlySet<string> | undefined;
  /** The head GitHub listed them, and gave its marks, at. */
  #listedAt: string | undefined;
  /** Marks set in Lo whose write hasn't finished, by path. */
  readonly #pending = new Map<string, Setting>();
  /** How many toggles there have been. */
  #toggles = 0;
  /** When GitHub last took a write for each path, so marks it gave before then don't undo it. */
  readonly #written = new Map<string, number>();

  /** The mark `path` shows: the one Lo is setting, or GitHub's. Nothing when GitHub hasn't said. */
  state(path: string): FileViewedState | undefined {
    return this.#pending.get(path)?.state ?? this.#github.get(path);
  }

  /** GitHub's own mark on `path`, as last read or as a write that GitHub took set it. */
  githubState(path: string): FileViewedState | undefined {
    return this.#github.get(path);
  }

  /** Every file's mark as {@link ViewedMarks.state} gives it, by path. */
  shown(): Map<string, FileViewedState> {
    const shown = new Map(this.#github);
    for (const [path, setting] of this.#pending) shown.set(path, setting.state);
    return shown;
  }

  /** Whether GitHub listed every file the pull request changes, so every one has a mark. */
  listsEveryFile(): boolean {
    return this.#listed !== undefined;
  }

  /**
   * Whether GitHub lists `path` among the pull request's files at `head`. Nothing when it can't
   * tell, as when it listed only some of them and not this one, or listed them at another head.
   */
  lists(path: string, head: string): boolean | undefined {
    if (this.#listedAt !== head) return undefined;
    if (this.#listed) return this.#listed.has(path);
    return this.#github.has(path) ? true : undefined;
  }

  /** How many files show as viewed, as {@link ViewedMarks.state} gives them, and how many have a mark. */
  viewedCount(): ViewedCount {
    const shown = [...this.shown().values()];
    return { viewed: shown.filter((state) => state === 'VIEWED').length, files: shown.length };
  }

  /** Takes GitHub's marks. Marks Lo is setting still show over them. Says whether GitHub's marks changed. */
  setGithub(marks: ReadonlyMap<string, FileViewedState>): boolean {
    if (sameMarks(marks, this.#github)) return false;
    this.#github = new Map(marks);
    return true;
  }

  /**
   * Takes the paths GitHub lists for the pull request at `head`, or nothing when it didn't list
   * them all. Says whether they, or the head, changed.
   */
  setListed(listed: ReadonlySet<string> | undefined, head: string): boolean {
    if (samePaths(listed, this.#listed) && this.#listedAt === head) return false;
    this.#listed = listed && new Set(listed);
    this.#listedAt = head;
    return true;
  }

  /**
   * The path GitHub knows a file by, which its mark and the writes use, for a file the local copy
   * lists at `path`: `path`, or, for a rename GitHub lists by its old path, `previous`. Nothing
   * when GitHub listed every file and neither is among them: GitHub refuses a mark on a path it
   * doesn't list. While its list is partial, any path may be on it.
   */
  githubPath(path: string, previous?: string): string | undefined {
    const lists = (candidate: string): boolean =>
      this.#listed ? this.#listed.has(candidate) : this.#github.has(candidate);
    if (lists(path)) return path;
    if (previous !== undefined && lists(previous)) return previous;
    return this.#listed ? undefined : path;
  }

  /**
   * `marks`, as GitHub gave them at `fetchedAt` (milliseconds since the Unix epoch), less what's
   * out of date: a file GitHub took a write for after then keeps the mark it has now.
   */
  withoutStale(
    marks: ReadonlyMap<string, FileViewedState>,
    fetchedAt: number,
  ): Map<string, FileViewedState> {
    const fresh = new Map(marks);
    for (const [path, writtenAt] of this.#written) {
      if (fetchedAt >= writtenAt) continue;
      const state = this.#github.get(path);
      if (state === undefined) fresh.delete(path);
      else fresh.set(path, state);
    }
    return fresh;
  }

  /** Whether a write for `path` hasn't finished. */
  isPending(path: string): boolean {
    return this.#pending.has(path);
  }

  /**
   * `e` on `path`: a viewed file's mark is cleared, and any other file, unviewed, changed since
   * viewed or with no mark known, is marked viewed. The new mark shows at once.
   */
  toggle(path: string): ViewedToggle {
    this.#toggles += 1;
    const toggle = { path, mark: this.state(path) !== 'VIEWED', id: this.#toggles };
    this.#pending.set(path, { state: toggledState(toggle), toggle: toggle.id });
    return toggle;
  }

  /**
   * A toggle's write finished, at `at` (milliseconds since the Unix epoch). If it succeeded,
   * GitHub's mark is the new one until GitHub says otherwise; if it failed, the file shows
   * GitHub's mark again. Either way a later toggle of the same file still shows until its own
   * write finishes.
   */
  finish(toggle: ViewedToggle, succeeded: boolean, at: number): void {
    if (succeeded) {
      this.#github.set(toggle.path, toggledState(toggle));
      this.#written.set(toggle.path, at);
    }
    if (this.#pending.get(toggle.path)?.toggle === toggle.id) this.#pending.delete(toggle.path);
  }
}

function sameMarks(
  a: ReadonlyMap<string, FileViewedState>,
  b: ReadonlyMap<string, FileViewedState>,
): boolean {
  return a.size === b.size && [...a].every(([path, state]) => b.get(path) === state);
}

function samePaths(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.size === b.size && [...a].every((path) => b.has(path));
}

/** The toast for a toggle whose write failed, as `login`: what couldn't be done and why. */
export function writeFailed(toggle: ViewedToggle, login: string, error: GithubError): string {
  const what = toggle.mark
    ? `mark ${toggle.path} viewed`
    : `clear the viewed mark on ${toggle.path}`;
  return `Couldn't ${what}: ${whyWriteFailed(toggle, login, error)}. It shows GitHub's mark again.`;
}

function whyWriteFailed(toggle: ViewedToggle, login: string, error: GithubError): string {
  const { detail } = error;
  switch (detail.kind) {
    case 'network':
      return "Lo can't reach GitHub";
    case 'rateLimited':
      return detail.secondary
        ? 'GitHub asked Lo to slow down'
        : `${login} has used up GitHub's rate limit`;
    case 'unauthorized':
      return `${login} is signed out`;
    case 'tokenUnavailable':
      return `${login}'s token couldn't be read`;
    case 'notFound':
      return `${login} can't see this pull request`;
    case 'graphql': {
      const messages = detail.errors.map((graphqlError) => graphqlError.message).join('; ');
      const typed = (type: string): boolean =>
        detail.errors.some((graphqlError) => graphqlError.type === type);
      // GitHub's answer for a path the pull request doesn't list.
      if (typed('UNPROCESSABLE')) {
        return `GitHub doesn't list ${toggle.path} in this pull request (${messages})`;
      }
      if (typed('FORBIDDEN')) return `${login} isn't allowed to (${messages})`;
      return `GitHub said: ${messages}`;
    }
    case 'api':
      return detail.status === 403
        ? `${login} isn't allowed to (${detail.message})`
        : error.message;
    case 'ssoRequired':
    case 'oauthAppRestricted':
    case 'inconsistent':
    case 'refusedUrl':
    case 'decode':
      return error.message;
    default:
      return detail satisfies never;
  }
}

/**
 * What the diff shows of a file GitHub says changed since it was viewed, as the revisions module
 * works it out from the file's mark, the head this computer recorded when it was marked viewed
 * and the commit of your last review. Revisions are named by head, and `to` is the latest.
 */
export type ViewedFileComparison =
  /** What changed since the revision this computer recorded when the file was marked viewed. */
  | { kind: 'sinceViewed'; from: string; to: string }
  /** What changed since your last review: the file was marked viewed elsewhere, or this computer's record of it is no use. */
  | { kind: 'sinceLastReview'; from: string; to: string }
  /** The file's whole diff in the pull request, with no marker to compare from. */
  | { kind: 'full' };

/**
 * The note on a file GitHub says changed since it was viewed: since when it changed, which is what
 * the diff shows of it when the comparison goes up to the latest revision. `comparison` is the
 * file's, or nothing for any other file, which gets no note. `viewedAt` is the head this computer
 * recorded when the file was marked viewed, and `label` names a revision by its head, such as
 * `r2`, or nothing for a commit no revision has.
 */
export function changedSinceViewed(
  comparison: ViewedFileComparison | undefined,
  viewedAt: string | undefined,
  label: (head: string) => string | undefined,
): string | undefined {
  const since = (from: string, when: string): string =>
    `Changed since ${when} in ${label(from) ?? from.slice(0, 7)}.`;
  if (comparison === undefined) return undefined;
  switch (comparison.kind) {
    // The comparison starts from an earlier revision when that one is gone; the note still names
    // the one the file was viewed in.
    case 'sinceViewed':
      return since(viewedAt ?? comparison.from, 'you viewed it');
    case 'sinceLastReview':
      return since(comparison.from, 'your last review');
    case 'full':
      return 'Changed since it was viewed.';
    default:
      return comparison satisfies never;
  }
}

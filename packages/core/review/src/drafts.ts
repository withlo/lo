/**
 * Text typed into comment boxes and not yet posted (`docs/design.md`, "Unsent text").
 *
 * {@link Drafts} keeps each comment box's text by account, pull request and place until it's
 * posted. The app saves it on this computer whenever it changes and restores it at launch, so a
 * crash or restart loses nothing. Logins, owners and repositories ignore case, as GitHub's do.
 *
 * A new thread's draft is kept on the revision it was written on. When a push makes another
 * revision the latest, {@link Drafts.onOlderRevisions} says where each such draft goes on the
 * latest one, or that it's stranded there, so no text is lost. {@link Drafts.prune} drops them
 * once the app learns their revision is gone.
 */

import type { Line, Lines } from './threads.ts';

/** A pull request, by its repository and number. {@link Drafts} ignores the case of `owner` and `repo`. */
export interface DraftPullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * A new thread on `lines` of the revision with head `commit`, or on the file when there are none.
 * Lines are GitHub's, as a new thread takes them.
 */
export interface ThreadDraftPlace {
  readonly kind: 'thread';
  readonly commit: string;
  readonly path: string;
  readonly lines?: Lines | undefined;
}

/** Where a comment box is. */
export type DraftPlace =
  | ThreadDraftPlace
  /** A reply to the thread with this id. */
  | { readonly kind: 'reply'; readonly thread: string }
  /** An edit of the comment with this id. */
  | { readonly kind: 'edit'; readonly comment: string }
  /** The submit dialog's summary. */
  | { readonly kind: 'summary' }
  /** The comment box at the bottom of the timeline, for a comment on the pull request itself. */
  | { readonly kind: 'conversation' };

/**
 * What a draft is kept by: the account writing it, by login, the pull request, and the comment
 * box. {@link Drafts} ignores the case of `account`.
 */
export interface DraftKey {
  readonly account: string;
  readonly pullRequest: DraftPullRequest;
  readonly place: DraftPlace;
}

/** A draft and what it's kept by. */
export interface Draft {
  readonly key: DraftKey;
  readonly text: string;
}

/**
 * A new thread's draft written on a revision other than the latest, and where it goes on the
 * latest. Its key's place names the revision it was written on: it's the draft to take once its
 * comment is sent.
 */
export interface OlderDraft extends Draft {
  /**
   * Where its comment box opens on the latest revision, a thread's place there. Nothing when it's
   * stranded: its lines changed, or the latest revision has a draft there already. The threads
   * panel lists stranded drafts, so their text can still be copied or posted.
   */
  readonly onLatest: DraftPlace | undefined;
}

/** Text typed into comment boxes and not yet posted, by {@link DraftKey}, with its login, owner and repository lowercased. */
export class Drafts {
  /** The drafts by {@link keyText} of their key. */
  readonly #drafts = new Map<string, Draft>();

  /** The drafts the app saved, skipping blank ones. */
  static from(saved: Iterable<Draft>): Drafts {
    const drafts = new Drafts();
    for (const { key, text } of saved) {
      if (isBlank(text)) continue;
      const lowered = lowercased(key);
      drafts.#drafts.set(keyText(lowered), { key: lowered, text });
    }
    return drafts;
  }

  /** The draft at `key`. */
  get(key: DraftKey): string | undefined {
    return this.#drafts.get(keyText(lowercased(key)))?.text;
  }

  /**
   * Keeps `text` as the draft at `key`, as it's typed. Blank text removes the draft. Says whether
   * anything changed, so the app saves only then.
   */
  set(key: DraftKey, text: string): boolean {
    const lowered = lowercased(key);
    const id = keyText(lowered);
    if (isBlank(text)) return this.#drafts.delete(id);
    if (this.#drafts.get(id)?.text === text) return false;
    this.#drafts.set(id, { key: lowered, text });
    return true;
  }

  /** Removes the draft at `key` and returns it: once its comment is posted, or its box is closed without posting. */
  take(key: DraftKey): string | undefined {
    const id = keyText(lowercased(key));
    const draft = this.#drafts.get(id);
    this.#drafts.delete(id);
    return draft?.text;
  }

  /** The drafts `account` has on `pullRequest`, ordered by place, to reopen their comment boxes. */
  on(account: string, pullRequest: DraftPullRequest): { place: DraftPlace; text: string }[] {
    return this.#mine(account, pullRequest).map(({ key, text }) => ({ place: key.place, text }));
  }

  /**
   * The new threads' drafts `account` wrote on `pullRequest` on revisions other than `latest`, the
   * latest head, ordered by key, and where each goes on `latest`.
   *
   * `moved` gets each one's place and says where it is on `latest`, or nothing when it's gone. The
   * caller maps its lines through the diff between the two revisions, and keeps them only when
   * they're unchanged and take a comment on `latest`. A file-level draft moves when the file still
   * takes a file-level comment. A place that isn't a new thread on `latest` counts as gone. A
   * draft whose place on `latest` already has one, from `latest` or from an earlier draft here, is
   * stranded.
   */
  onOlderRevisions(
    account: string,
    pullRequest: DraftPullRequest,
    latest: string,
    moved: (place: ThreadDraftPlace) => DraftPlace | undefined,
  ): OlderDraft[] {
    const onLatest = (place: DraftPlace): boolean =>
      place.kind === 'thread' && place.commit === latest;
    const mine = this.#mine(account, pullRequest);
    const taken = new Set(
      mine
        .map(({ key }) => key.place)
        .filter(onLatest)
        .map((place) => placeText(place)),
    );
    const older: OlderDraft[] = [];
    for (const { key, text } of mine) {
      if (key.place.kind !== 'thread' || onLatest(key.place)) continue;
      const place = moved(key.place);
      const free = place !== undefined && onLatest(place) && !taken.has(placeText(place));
      if (free) taken.add(placeText(place));
      older.push({ key, text, onLatest: free ? place : undefined });
    }
    return older;
  }

  /**
   * Removes the new threads' drafts on `pullRequest`, by any account, written on revisions that
   * `exists` says are gone, such as one force-pushed away that GitHub no longer has. Returns how
   * many it removed, so the app saves when any were.
   */
  prune(pullRequest: DraftPullRequest, exists: (commit: string) => boolean): number {
    let removed = 0;
    for (const [id, { key }] of this.#drafts) {
      const { place } = key;
      if (place.kind !== 'thread' || !samePullRequest(key.pullRequest, pullRequest)) continue;
      if (exists(place.commit)) continue;
      this.#drafts.delete(id);
      removed += 1;
    }
    return removed;
  }

  /** Every draft, ordered by key, for the app to save. Keys come back lowercased. */
  entries(): Draft[] {
    return [...this.#drafts.values()].toSorted((a, b) => compareKeys(a.key, b.key));
  }

  get size(): number {
    return this.#drafts.size;
  }

  isEmpty(): boolean {
    return this.#drafts.size === 0;
  }

  /** `account`'s drafts on `pullRequest`, ordered by key. */
  #mine(account: string, pullRequest: DraftPullRequest): Draft[] {
    return this.entries().filter(
      ({ key }) => sameText(key.account, account) && samePullRequest(key.pullRequest, pullRequest),
    );
  }
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

/** `text` with its ASCII letters lowercased, as GitHub's logins, owners and repositories are. */
function asciiLowercase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function sameText(a: string, b: string): boolean {
  return asciiLowercase(a) === asciiLowercase(b);
}

function samePullRequest(a: DraftPullRequest, b: DraftPullRequest): boolean {
  return sameText(a.owner, b.owner) && sameText(a.repo, b.repo) && a.number === b.number;
}

/** The key as {@link Drafts} keeps it: login, owner and repository lowercased. */
function lowercased(key: DraftKey): DraftKey {
  const { owner, repo, number } = key.pullRequest;
  return {
    account: asciiLowercase(key.account),
    pullRequest: { owner: asciiLowercase(owner), repo: asciiLowercase(repo), number },
    place: key.place,
  };
}

/** A key as text, the same for equal keys. */
function keyText(key: DraftKey): string {
  const { owner, repo, number } = key.pullRequest;
  return JSON.stringify([key.account, owner, repo, number, placeText(key.place)]);
}

/** A place as text, the same for equal places. */
function placeText(place: DraftPlace): string {
  switch (place.kind) {
    case 'thread': {
      const { kind, commit, path, lines } = place;
      return JSON.stringify([kind, commit, path, lineParts(lines?.start), lineParts(lines?.end)]);
    }
    case 'reply':
      return JSON.stringify([place.kind, place.thread]);
    case 'edit':
      return JSON.stringify([place.kind, place.comment]);
    case 'summary':
    case 'conversation':
      return JSON.stringify([place.kind]);
    default:
      return place satisfies never;
  }
}

function lineParts(line: Line | undefined): [string, number] | null {
  return line ? [line.side, line.number] : null;
}

/** The order of places' kinds, in which {@link compareKeys} orders them. */
const KINDS: readonly DraftPlace['kind'][] = ['thread', 'reply', 'edit', 'summary', 'conversation'];

/** Orders keys by account, owner, repository, number, then place. */
function compareKeys(a: DraftKey, b: DraftKey): number {
  return (
    compareText(a.account, b.account) ||
    compareText(a.pullRequest.owner, b.pullRequest.owner) ||
    compareText(a.pullRequest.repo, b.pullRequest.repo) ||
    a.pullRequest.number - b.pullRequest.number ||
    comparePlaces(a.place, b.place)
  );
}

/** Orders places by kind, in {@link KINDS}' order, then by what they're on. */
function comparePlaces(a: DraftPlace, b: DraftPlace): number {
  const byKind = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  if (a.kind === 'thread' && b.kind === 'thread') {
    return (
      compareText(a.commit, b.commit) ||
      compareText(a.path, b.path) ||
      compareLines(a.lines, b.lines)
    );
  }
  if (a.kind === 'reply' && b.kind === 'reply') return compareText(a.thread, b.thread);
  if (a.kind === 'edit' && b.kind === 'edit') return compareText(a.comment, b.comment);
  return 0;
}

/** Orders lines with none first, then by their first line, a single line first, then their last. */
function compareLines(a: Lines | undefined, b: Lines | undefined): number {
  if (a === undefined || b === undefined) return Number(a !== undefined) - Number(b !== undefined);
  return compareLine(a.start, b.start) || compareLine(a.end, b.end);
}

/** Orders lines with none first, then `LEFT` before `RIGHT`, then by number. */
function compareLine(a: Line | undefined, b: Line | undefined): number {
  if (a === undefined || b === undefined) return Number(a !== undefined) - Number(b !== undefined);
  return compareText(a.side, b.side) || a.number - b.number;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

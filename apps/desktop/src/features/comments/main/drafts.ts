// The drafts of comment boxes, in main: what the reader typed and hasn't posted, by account, pull
// request and place, saved in the database as the window hands it over, so quitting Lo or a crash
// loses none of it. Those saved before Lo started come back marked restored. Besides new threads'
// boxes, a pull request has one summary, the submit dialog's, which the review feature keeps here
// through the `comments.drafts` service. A place of a kind this version of Lo doesn't know, written
// by a later one, stays in the database as it is and is never opened. Nothing here calls Electron.

import { PullRef } from '@lo/github';
import { Drafts, type DraftPlace, type ThreadDraftPlace } from '@lo/review';

import type { Database } from '../../../main/database.ts';
import { draftPlace, type DraftPlaceRow } from '../contract.ts';

/** The submit dialog's summary: one a pull request, for each account. */
export interface SummaryPlace {
  readonly kind: 'summary';
}

/** The summary's place. */
export const SUMMARY: SummaryPlace = { kind: 'summary' };

/** Any place a draft is kept by: a new thread's, or the summary. */
export type StoredPlace = DraftPlaceRow | SummaryPlace;

/** A draft as main keeps it, a new thread's unless it says otherwise. */
export interface Kept<P extends StoredPlace = DraftPlaceRow> {
  readonly place: P;
  readonly text: string;
  /** When it was last saved, in milliseconds since the Unix epoch. */
  readonly savedAt: number;
  /** Whether it was saved before Lo started. */
  readonly restored: boolean;
  /**
   * The text sent, from when Lo sends it until GitHub answers, or, when the answer was lost, until
   * Lo has looked whether it posted: it may be on GitHub.
   */
  readonly sent: string | null;
  /** When it was sent, while it's marked sent. */
  readonly sentAt: number | null;
}

function integer(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0;
}

/** `text` with its ASCII letters lowercased, as GitHub's logins, owners and repositories are. */
function lower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Whether `place` is a new thread's. */
function isThread(place: StoredPlace): place is DraftPlaceRow {
  return place.kind === 'thread';
}

/** A place as the database keeps it: JSON, the same for the same place. */
export function placeJson(place: StoredPlace): string {
  if (!isThread(place)) return JSON.stringify({ kind: place.kind });
  const { lines } = place;
  return JSON.stringify({
    kind: place.kind,
    commit: lower(place.commit),
    path: place.path,
    lines: lines && {
      start: lines.start && { side: lines.start.side, number: lines.start.number },
      end: { side: lines.end.side, number: lines.end.number },
    },
  });
}

/** A place the database kept, if this version of Lo knows its kind. */
export function readPlace(json: string): StoredPlace | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (json === placeJson(SUMMARY)) return SUMMARY;
  const read = draftPlace.safeParse(value);
  return read.success ? read.data : undefined;
}

/** A place as `@lo/review` takes it. */
export function corePlace(place: DraftPlaceRow): ThreadDraftPlace {
  const { lines } = place;
  return {
    kind: 'thread',
    commit: place.commit,
    path: place.path,
    lines: lines ? { start: lines.start ?? undefined, end: lines.end } : undefined,
  };
}

/** A place from `@lo/review`, if it's of a kind the contract carries. */
export function rowPlace(place: DraftPlace): DraftPlaceRow | undefined {
  if (place.kind !== 'thread') return undefined;
  const { lines } = place;
  return {
    kind: 'thread',
    commit: place.commit,
    path: place.path,
    lines: lines ? { start: lines.start ?? null, end: lines.end } : null,
  };
}

/** Whether `kept` is kept by a place of `place`'s kind, as one kept by its JSON is. */
function sameKind<P extends StoredPlace>(kept: Kept<StoredPlace>, place: P): kept is Kept<P> {
  return kept.place.kind === place.kind;
}

/** Whether `kept` is a new thread's draft. */
function isThreadDraft(kept: Kept<StoredPlace>): kept is Kept {
  return isThread(kept.place);
}

/** What a pull request's drafts are kept by, for one account. */
function keyOf(account: string, pull: PullRef): string {
  return `${lower(account)}|${pull.key}`;
}

export class DraftStore {
  readonly #database: Database;
  readonly #now: () => number;
  /** Each account's drafts on each pull request, by {@link keyOf}, then by {@link placeJson}. */
  readonly #kept = new Map<string, Map<string, Kept<StoredPlace>>>();
  /** The account and pull request each {@link keyOf} names. */
  readonly #named = new Map<string, { account: string; pull: PullRef }>();

  /** The drafts in `database`, each marked restored. */
  constructor(database: Database, now: () => number = Date.now) {
    this.#database = database;
    this.#now = now;
    const rows = database
      .prepare(
        'SELECT account, owner, repo, number, place, body, sent, sent_at, saved_at FROM comments_drafts',
      )
      .all();
    for (const row of rows) {
      const place = readPlace(String(row.place));
      if (!place) continue;
      const pull = new PullRef(String(row.owner), String(row.repo), integer(row.number));
      this.#own(String(row.account), pull).set(placeJson(place), {
        place,
        text: String(row.body),
        savedAt: integer(row.saved_at),
        restored: true,
        sent: row.sent === null ? null : String(row.sent),
        sentAt: row.sent === null || row.sent_at === null ? null : integer(row.sent_at),
      });
    }
  }

  /** `account`'s new threads' drafts on `pull`, ordered by place. */
  of(account: string, pull: PullRef): Kept[] {
    const own = this.#kept.get(keyOf(account, pull));
    if (!own) return [];
    return [...own.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([, kept]) => (isThreadDraft(kept) ? [kept] : []));
  }

  /** Every new thread's draft marked sent, with its account and pull request. */
  marked(): { account: string; pull: PullRef; kept: Kept }[] {
    return this.#marked(isThreadDraft);
  }

  /** Every summary marked sent, with its account and pull request. */
  markedSummaries(): { account: string; pull: PullRef; kept: Kept<SummaryPlace> }[] {
    return this.#marked((kept): kept is Kept<SummaryPlace> => kept.place.kind === SUMMARY.kind);
  }

  #marked<P extends StoredPlace>(
    is: (kept: Kept<StoredPlace>) => kept is Kept<P>,
  ): { account: string; pull: PullRef; kept: Kept<P> }[] {
    const found: { account: string; pull: PullRef; kept: Kept<P> }[] = [];
    for (const [key, own] of this.#kept) {
      const named = this.#named.get(key);
      if (!named) continue;
      for (const kept of own.values())
        if (kept.sent !== null && is(kept)) found.push({ ...named, kept });
    }
    return found;
  }

  /** The draft at `place`, if there is one. */
  get<P extends StoredPlace>(account: string, pull: PullRef, place: P): Kept<P> | undefined {
    const kept = this.#kept.get(keyOf(account, pull))?.get(placeJson(place));
    return kept && sameKind(kept, place) ? kept : undefined;
  }

  /**
   * Keeps `text` as the draft at `place`, as typed: blank text removes it, unless it was sent with
   * its answer lost, which keeps it until that's settled. Says whether anything changed.
   */
  save(account: string, pull: PullRef, place: StoredPlace, text: string): boolean {
    const json = placeJson(place);
    const was = this.#kept.get(keyOf(account, pull))?.get(json);
    if (text.trim() === '' && was?.sent == null)
      return this.take(account, pull, place) !== undefined;
    if (was?.text === text) return false;
    this.#put(account, pull, json, {
      place,
      text,
      savedAt: this.#now(),
      restored: false,
      sent: was?.sent ?? null,
      sentAt: was?.sentAt ?? null,
    });
    return true;
  }

  /**
   * Marks the draft at `place` sent, `sent` the text sent, now or at `at`: it may be on GitHub
   * until Lo knows. `null` settles it. With `keep`, a place with no draft gets one with that text,
   * as a review sent with no summary does, so the mark outlasts a restart.
   */
  markSent(
    account: string,
    pull: PullRef,
    place: StoredPlace,
    sent: string | null,
    at: number = this.#now(),
    keep = false,
  ): void {
    const json = placeJson(place);
    const was =
      this.#kept.get(keyOf(account, pull))?.get(json) ??
      (keep && sent !== null
        ? { place, text: sent, savedAt: at, restored: false, sent: null, sentAt: null }
        : undefined);
    if (!was || (was.sent === null && sent === null)) return;
    this.#put(account, pull, json, { ...was, sent, sentAt: sent === null ? null : at });
  }

  /** Removes the draft at `place` and returns it: once it's posted, or discarded. */
  take<P extends StoredPlace>(account: string, pull: PullRef, place: P): Kept<P> | undefined {
    const own = this.#kept.get(keyOf(account, pull));
    const json = placeJson(place);
    const was = this.get(account, pull, place);
    if (!was) return undefined;
    own!.delete(json);
    if (own!.size === 0) {
      this.#kept.delete(keyOf(account, pull));
      this.#named.delete(keyOf(account, pull));
    }
    this.#database
      .prepare(
        'DELETE FROM comments_drafts WHERE account = ? AND owner = ? AND repo = ? AND number = ? AND place = ?',
      )
      .run(account, pull.repo.owner, pull.repo.name, pull.number, json);
    return was;
  }

  /**
   * Moves `account`'s new threads' drafts on `pull` written on revisions other than `latest`, the
   * head now on screen, to where `@lo/review`'s `onOlderRevisions` says they go there, as
   * `moved` maps their places: a draft whose lines changed, or whose place there has one already,
   * stays where it was written. Says whether any moved.
   */
  moveToLatest(
    account: string,
    pull: PullRef,
    latest: string,
    moved: (place: ThreadDraftPlace) => DraftPlace | undefined,
  ): boolean {
    const own = this.of(account, pull);
    if (own.length === 0) return false;
    const { owner, name } = pull.repo;
    const pullRequest = { owner, repo: name, number: pull.number };
    const drafts = Drafts.from(
      own.map((kept) => ({
        key: { account, pullRequest, place: corePlace(kept.place) },
        text: kept.text,
      })),
    );
    let any = false;
    for (const older of drafts.onOlderRevisions(account, pullRequest, latest, moved)) {
      const from = rowPlace(older.key.place);
      const to = older.onLatest && rowPlace(older.onLatest);
      if (!from || !to) continue;
      const kept = this.get(account, pull, from);
      // One sent with its answer lost stays where it was sent from until that's settled.
      if (!kept || kept.sent !== null) continue;
      this.take(account, pull, from);
      this.#put(account, pull, placeJson(to), { ...kept, place: to });
      any = true;
    }
    return any;
  }

  /** Forgets every draft of `account`, as it's removed. */
  forget(account: string): void {
    for (const key of this.#kept.keys()) {
      if (!key.startsWith(`${lower(account)}|`)) continue;
      this.#kept.delete(key);
      this.#named.delete(key);
    }
    this.#database.prepare('DELETE FROM comments_drafts WHERE account = ?').run(account);
  }

  #own(account: string, pull: PullRef): Map<string, Kept<StoredPlace>> {
    const key = keyOf(account, pull);
    let own = this.#kept.get(key);
    if (!own) {
      own = new Map();
      this.#kept.set(key, own);
      this.#named.set(key, { account, pull });
    }
    return own;
  }

  #put(account: string, pull: PullRef, json: string, kept: Kept<StoredPlace>): void {
    this.#own(account, pull).set(json, kept);
    this.#database
      .prepare(
        `INSERT INTO comments_drafts
           (account, owner, repo, number, place, body, sent, sent_at, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account, owner, repo, number, place) DO UPDATE SET
           body = excluded.body, sent = excluded.sent, sent_at = excluded.sent_at,
           saved_at = excluded.saved_at`,
      )
      .run(
        account,
        pull.repo.owner,
        pull.repo.name,
        pull.number,
        json,
        kept.text,
        kept.sent,
        kept.sentAt === null ? null : Math.round(kept.sentAt),
        Math.round(kept.savedAt),
      );
  }
}

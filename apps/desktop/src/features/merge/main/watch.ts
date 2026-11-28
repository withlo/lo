// The auto-merge watch: auto-merge that approve and ship turned on after you approved is kept in
// `merge_shipped`, a restart included. GitHub keeps auto-merge on when someone with write access
// pushes, and unless the base branch's rules want a new approval after a push, the push merges with
// the approvals already given, yours included. So while Lo runs, it reads each watched pull
// request's merge facts every 2 minutes, 5 while Lo is off screen, with a tab on it or without, as
// the account that turned it on, and hands each read that came after auto-merge went on to
// `@lo/review`'s `afterPush`. On a push that would merge with your approval, Lo turns auto-merge off,
// in the pull request's turn among merge writes, and says so; when it can't tell, it says that and
// reads again; once there's nothing more to watch, the row goes. It watches only what approve and
// ship turned on: auto-merge someone else turned on, before or after, or turned on again with
// another method, ends the watch, as does auto-merge GitHub refused to turn on. Nothing here calls
// Electron.

import {
  describeMergeRefusal,
  isOnScreen,
  MERGE_FACTS,
  PullRef,
  type MergeFacts,
  type Poller,
  type ReadMark,
} from '@lo/github';
import { afterPush, mergeSnapshot, type ShippedAutoMerge } from '@lo/review';

import type { Database } from '../../../main/database.ts';
import type { Confirmed, Method, Watched } from '../contract.ts';
import type { AutoAnswer, MergingPoller } from './merging.ts';
import type { Shipped } from './ship.ts';

/**
 * How long between reads of a watched pull request, in milliseconds: 2 minutes while Lo is on
 * screen, in front or behind another window, and 5 while it's off screen.
 */
export const EVERY = { front: 2 * 60_000, back: 5 * 60_000 } as const;

const METHODS: readonly string[] = ['MERGE', 'SQUASH', 'REBASE'];

function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && METHODS.includes(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Auto-merge approve and ship turned on, as `merge_shipped` keeps it. */
export interface ShippedRow extends Shipped {
  /** Who turned it on, as GitHub spells the account once it answered. */
  readonly enabledBy: string;
  /** When, in milliseconds since the Unix epoch. */
  readonly at: number;
}

/** `merge_shipped`: what the watch keeps, for a Lo started again. */
export class ShippedStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Every row, oldest first. */
  list(): ShippedRow[] {
    return this.#database
      .prepare(
        'SELECT login, owner, repo, number, head, enabled_by, method, base, shipped_at FROM merge_shipped ORDER BY shipped_at',
      )
      .all()
      .flatMap((row): ShippedRow[] => {
        const { login, owner, repo, number, head, enabled_by, method, base, shipped_at } = row;
        if (
          typeof login !== 'string' ||
          typeof owner !== 'string' ||
          typeof repo !== 'string' ||
          typeof number !== 'number' ||
          typeof head !== 'string' ||
          typeof enabled_by !== 'string' ||
          typeof base !== 'string' ||
          typeof shipped_at !== 'number'
        ) {
          return [];
        }
        return [
          {
            login,
            pull: new PullRef(owner, repo, number),
            head,
            enabledBy: enabled_by,
            method: isMethod(method) ? method : null,
            base,
            at: shipped_at,
          },
        ];
      });
  }

  /** Keeps `row`, in place of the one for its account and pull request. */
  put(row: ShippedRow): void {
    const { pull } = row;
    this.#database
      .prepare(
        `INSERT INTO merge_shipped (login, owner, repo, number, head, enabled_by, method, base, shipped_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (login, owner, repo, number) DO UPDATE SET
           head = excluded.head, enabled_by = excluded.enabled_by, method = excluded.method,
           base = excluded.base, shipped_at = excluded.shipped_at`,
      )
      .run(
        row.login,
        pull.repo.owner,
        pull.repo.name,
        pull.number,
        row.head,
        row.enabledBy,
        row.method,
        row.base,
        Math.round(row.at),
      );
  }

  /** Forgets the row for `login` on `pull`. */
  remove(login: string, pull: PullRef): void {
    this.#database
      .prepare(
        'DELETE FROM merge_shipped WHERE login = ? AND owner = ? AND repo = ? AND number = ?',
      )
      .run(login, pull.repo.owner, pull.repo.name, pull.number);
  }
}

/** What the watch uses of an account's poller: what merging does, and where Lo is. */
export type WatchPoller = MergingPoller & Pick<Poller, 'presence'>;

export interface WatchOptions {
  readonly store: ShippedStore;
  /** An account's poller. Throws for an account Lo doesn't have. */
  readonly poller: (login: string) => Promise<WatchPoller>;
  /** Turns auto-merge off for `pull` as `login`, by itself, as `Merging.turnOffWatched` does. */
  readonly turnOff: (
    pull: PullRef,
    login: string,
    poller: WatchPoller,
    heard: (answer: AutoAnswer) => void,
  ) => Exclude<Confirmed, { kind: 'again' }>;
  /** Says what the watch did about a push. */
  readonly publish: (watched: Watched) => void;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  readonly newKey?: () => string;
  /** How long between reads, in milliseconds, on screen and off it. */
  readonly every?: { readonly front: number; readonly back: number };
}

/** A pull request the watch follows. */
interface Watching {
  row: ShippedRow;
  poller: WatchPoller | undefined;
  /** What a read must come after to be decided on: the one made once auto-merge went on. */
  mark: ReadMark | undefined;
  /** Whether GitHub's answer to turning it on came, or was lost: until then, nothing is read. */
  answered: boolean;
  /** When the read last decided on was confirmed, so each is decided once. */
  decided: number | undefined;
  /** The push Lo turned auto-merge off for, while it waits to hear that it's off. */
  turning: string | undefined;
  /** The push Lo last said it can't tell about, or couldn't turn auto-merge off for. */
  told: string | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  unlisten: (() => void) | undefined;
  gone: boolean;
}

/** What names a row: its account and pull request, ignoring case. */
function keyOf(login: string, pull: PullRef): string {
  return `${login.toLowerCase()}|${pull.key}`;
}

export class ShipWatch {
  readonly #options: WatchOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  readonly #watching = new Map<string, Watching>();
  #stopped = false;

  constructor(options: WatchOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
  }

  /** Watches every row kept, as after a restart: each read from now on came after it went on. */
  start(): void {
    for (const row of this.#options.store.list()) this.#follow(row, true);
  }

  /**
   * Keeps `shipped`, auto-merge approve and ship is about to turn on after your approval, and
   * returns what hears GitHub's answer: on, and the watch starts, with the method GitHub reports,
   * unless another account turned it on, and the row goes; refused, and the row goes; lost, and
   * the watch starts, for its reads to settle it.
   */
  keep(shipped: Shipped): (answer: AutoAnswer) => void {
    const row: ShippedRow = { ...shipped, enabledBy: shipped.login, at: this.#now() };
    this.#options.store.put(row);
    const watching = this.#follow(row, false);
    return (answer) => {
      if (watching.gone || this.#stopped) return;
      if (answer === 'lost') {
        this.#answered(watching);
        return;
      }
      if ('refused' in answer) {
        this.#end(watching);
        return;
      }
      const on = answer.autoMerge;
      if (on) {
        // Another account's auto-merge isn't the one approve and ship turned on.
        if (
          on.enabledBy !== undefined &&
          on.enabledBy.toLowerCase() !== watching.row.login.toLowerCase()
        ) {
          this.#end(watching);
          return;
        }
        // As GitHub reports it, but on a branch with a merge queue, where it reports a merge
        // commit whatever was asked.
        watching.row = {
          ...watching.row,
          enabledBy: on.enabledBy ?? watching.row.enabledBy,
          method:
            watching.row.method === null || !isMethod(on.method) ? watching.row.method : on.method,
        };
        this.#options.store.put(watching.row);
      }
      this.#answered(watching);
    };
  }

  /** Reads nothing more and sends nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const watching of this.#watching.values()) this.#quiet(watching);
    this.#watching.clear();
  }

  /** Follows `row`, reading it once GitHub's answer to turning it on came (`answered`). */
  #follow(row: ShippedRow, answered: boolean): Watching {
    const key = keyOf(row.login, row.pull);
    const before = this.#watching.get(key);
    if (before) {
      before.gone = true;
      this.#quiet(before);
    }
    const watching: Watching = {
      row,
      poller: undefined,
      mark: undefined,
      answered,
      decided: undefined,
      turning: undefined,
      told: undefined,
      timer: undefined,
      unlisten: undefined,
      gone: false,
    };
    this.#watching.set(key, watching);
    this.#options
      .poller(row.login)
      .then((poller) => {
        if (watching.gone || this.#stopped) return;
        watching.poller = poller;
        watching.unlisten = poller.onEvent((event) => {
          if (event.kind !== 'read' && event.kind !== 'confirmed') return;
          if (event.pull.equals(row.pull) && event.name === MERGE_FACTS.name)
            this.#decide(watching);
        });
        if (watching.answered) void this.#read(watching);
      })
      .catch((error: unknown) => {
        // The account is gone, or not yet back: the row stays for a Lo that has it.
        this.#options.log(`watching ${row.pull.toString()}: ${describe(error)}`);
      });
    return watching;
  }

  /** GitHub's answer to turning it on came, or was lost: what's read from now on is decided on. */
  #answered(watching: Watching): void {
    watching.answered = true;
    if (watching.poller) void this.#read(watching);
  }

  /** Reads `watching`'s pull request afresh now, then again in a while. */
  async #read(watching: Watching): Promise<void> {
    const { poller, row } = watching;
    if (!poller || watching.gone || this.#stopped) return;
    clearTimeout(watching.timer);
    const every = this.#options.every ?? EVERY;
    watching.timer = setTimeout(
      () => void this.#read(watching),
      isOnScreen(poller.presence) ? every.front : every.back,
    );
    try {
      let mark = poller.readAfresh(row.pull, MERGE_FACTS);
      if (!mark) {
        // Not kept, as with no tab on it: kept from now, and read.
        await poller.mergeFacts(row.pull);
        mark = poller.readAfresh(row.pull, MERGE_FACTS);
      }
      // Any mark taken once it was answered will do: what's read after it came after that.
      watching.mark = mark;
    } catch (error) {
      this.#options.log(`watching ${row.pull.toString()}: ${describe(error)}`);
    }
  }

  /** Decides on the last read of `watching`'s pull request, once, if it came after the mark. */
  #decide(watching: Watching): void {
    const { poller, mark, row } = watching;
    if (!poller || !mark || !watching.answered || watching.gone || this.#stopped) return;
    const since = poller.readSince(row.pull, MERGE_FACTS, mark);
    if (since.kind === 'stale') {
      // Let go of, as when a tab on it closed: the next read keeps it again.
      watching.mark = undefined;
      return;
    }
    if (since.kind !== 'read') return;
    const read = since.read;
    if (watching.decided === read.fetchedAt) return;
    watching.decided = read.fetchedAt;
    this.#decideOn(watching, poller, read.value);
  }

  #decideOn(watching: Watching, poller: WatchPoller, facts: MergeFacts): void {
    const { row } = watching;
    const snapshot = mergeSnapshot(facts, {
      headOnScreen: row.head,
      preferredMethod: undefined,
      headContainsBase: undefined,
    });
    const shipped: ShippedAutoMerge = {
      head: row.head,
      enabledBy: row.enabledBy,
      // Not compared on a branch with a merge queue: GitHub reports a merge commit whatever.
      method: row.method ?? snapshot.autoMerge?.method ?? 'MERGE',
    };
    const after = afterPush(snapshot, shipped);
    switch (after.kind) {
      case 'watch':
        return;
      case 'incomplete':
        poller.readMergeFactsAgain(row.pull);
        return;
      case 'cantTell':
        if (watching.told !== after.head) {
          watching.told = after.head;
          this.#say(watching, 'cantTell', after.head, null);
        }
        poller.readMergeFactsAgain(row.pull);
        return;
      case 'youApproved':
        watching.row = { ...row, head: after.head };
        watching.told = undefined;
        this.#options.store.put(watching.row);
        return;
      case 'ended':
        // Off since Lo turned it off for a push: say so.
        if (after.ended.kind === 'autoMergeOff' && watching.turning !== undefined) {
          this.#say(watching, 'turnedOff', watching.turning, null);
        }
        this.#end(watching);
        return;
      case 'turnOffAutoMerge':
        this.#turnOff(watching, poller, after.head);
        return;
      default:
        after satisfies never;
    }
  }

  /** Turns auto-merge off for the push `head`, unless that's under way already. */
  #turnOff(watching: Watching, poller: WatchPoller, head: string): void {
    if (watching.turning !== undefined) return;
    const { row } = watching;
    watching.turning = head;
    const sent = this.#options.turnOff(row.pull, row.login, poller, (answer) => {
      if (watching.gone || this.#stopped) return;
      if (answer === 'lost') return;
      if ('refused' in answer) {
        watching.turning = undefined;
        // Said once a push: the next read tries again.
        if (watching.told === head) return;
        watching.told = head;
        this.#say(
          watching,
          'notTurnedOff',
          head,
          answer.refused ? `${describeMergeRefusal(answer.refused)}.` : null,
        );
        return;
      }
      if (answer.autoMerge === undefined) {
        this.#say(watching, 'turnedOff', head, null);
        this.#end(watching);
        return;
      }
      // Still on, as GitHub answered: the next read decides again.
      watching.turning = undefined;
    });
    if (sent.kind === 'sent') return;
    watching.turning = undefined;
    // Another merge write to it, or one unsettled, or GitHub out of reach: the next read tries again.
    const waits = ['busy', 'unsettled', 'offline', 'paused', 'unread', 'stopped'];
    if (waits.includes(sent.refusal.kind)) return;
    if (watching.told === head) return;
    watching.told = head;
    this.#say(watching, 'notTurnedOff', head, sent.refusal.text);
  }

  /** Says what the watch did about `head`, a push after the approval it watches. */
  #say(watching: Watching, kind: Watched['kind'], head: string, why: string | null): void {
    const { row } = watching;
    try {
      this.#options.publish({
        key: this.#newKey(),
        owner: row.pull.repo.owner,
        repo: row.pull.repo.name,
        number: row.pull.number,
        login: row.login,
        kind,
        approved: row.head.toLowerCase(),
        head: head.toLowerCase(),
        why,
      });
    } catch (error) {
      this.#options.log(`watching ${row.pull.toString()}: ${describe(error)}`);
    }
  }

  /** Watches `watching` no more, and forgets its row. */
  #end(watching: Watching): void {
    if (watching.gone) return;
    watching.gone = true;
    this.#quiet(watching);
    const key = keyOf(watching.row.login, watching.row.pull);
    if (this.#watching.get(key) === watching) this.#watching.delete(key);
    this.#options.store.remove(watching.row.login, watching.row.pull);
  }

  #quiet(watching: Watching): void {
    clearTimeout(watching.timer);
    watching.timer = undefined;
    watching.unlisten?.();
    watching.unlisten = undefined;
  }
}

// The window's tabs as main keeps them: opened, closed, shown and moved, in the strip's order. Each
// change is written to `tab_tabs` before anyone hears of it, so the tabs come back as they were
// after Lo restarts. Nothing here calls Electron.

import { randomUUID } from 'node:crypto';

import type { Database, Row } from '../../../main/database.ts';
import { login as accountLogin } from '../../accounts/contract.ts';
import {
  opening as openingSchema,
  tab as tabSchema,
  type Choice,
  type Moved,
  type Opening,
  type PullState,
  type Tab,
  type Tabs,
} from '../contract.ts';
import { findTab, shows, tabKey, type TabKey } from './pulls.ts';

/** Recent pull requests: the tab that stands in for an empty strip. */
export const RECENT: Tab = { id: 'recent', kind: 'recent' };

/**
 * A tab main keeps: a pull request's or Settings'. A pull request's also keeps the account it acts
 * as and its repository's name as GitHub last gave it, which the window isn't sent.
 */
type Kept =
  | (Extract<Tab, { kind: 'pull' }> & {
      login?: string | undefined;
      repository?: string | undefined;
    })
  | Extract<Tab, { kind: 'settings' }>;
type PullTab = Extract<Kept, { kind: 'pull' }>;

/** What's kept with a pull request's tab beyond what the strip shows. */
export interface PullKept {
  readonly login?: string | undefined;
  readonly repository?: string | undefined;
}

/** The tabs main keeps, in order, and the one on screen: one of them, or none when there are none. */
interface State {
  readonly kept: readonly Kept[];
  readonly active: string | undefined;
}

export interface TabList {
  /** The tabs in the strip's order, and the one on screen: Recent alone while nothing is open. */
  list(): Tabs;
  /**
   * Opens a tab at the end of the strip and shows it, and returns its id. A pull request already
   * open, by any name it's known by, or Settings when it's open, shows the tab it's in. A new pull
   * request's tab keeps `as.login` as its account, when given.
   */
  open(opening: Opening, as?: { login: string }): string;
  /**
   * Closes `id`, or the tab on screen. Closing the tab on screen shows the one after it, or the
   * one before it at the end of the strip, or Recent once nothing is open. Recent stays.
   */
  close(id?: string): void;
  /** Shows a tab. A choice of no tab, such as a place past the last, changes nothing. */
  select(choice: Choice): void;
  /**
   * Moves a tab to place `to`, from 0, counted without it, or to the end when `to` is past it, and
   * says where it is now. Nothing for a tab that isn't open.
   */
  move(id: string, to: number): Moved | undefined;
  /**
   * Moves `id`, or the tab on screen, one place along the strip, but not round its ends, and says
   * where it is now. Nothing while only Recent is open.
   */
  step(id: string | undefined, by: 1 | -1): Moved | undefined;
  /** Keeps what GitHub said of a pull request's tab, so the strip shows it from then on. */
  describe(id: string, details: { title: string; state: PullState }): void;
  /** What's kept with a pull request's tab: its account and repository, if known. */
  kept(id: string): PullKept;
  /**
   * Keeps a pull request's tab's account, or forgets it with `null`, and its repository's name.
   * The window hears nothing of it.
   */
  remember(
    id: string,
    kept: { login?: string | null | undefined; repository?: string | undefined },
  ): void;
}

export interface TabListOptions {
  readonly database: Database;
  /** Hears the tabs each time they change, once the change is written. */
  readonly changed: (tabs: Tabs) => void;
  /** Makes a new tab's id. */
  readonly newId?: () => string;
  /** Hears of a kept tab that can't be read back, which is left out. */
  readonly log?: (message: string) => void;
}

/** The tabs `tab_tabs` holds, read now, with every change written back as it's made. */
export function createTabs(options: TabListOptions): TabList {
  const { database, changed, newId = randomUUID } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  let state = load(database, log);

  const list = (): Tabs => {
    const [first] = state.kept;
    if (!first) return { tabs: [RECENT], active: RECENT.id };
    return { tabs: state.kept.map(shown), active: state.active ?? first.id };
  };

  /** Writes `next`, then makes it the tabs and says so. A write that fails changes nothing. */
  const commit = (next: State): void => {
    save(database, next);
    state = next;
    changed(list());
  };

  /** Writes `next` and makes it the tabs, without a word to the window, which sees no change. */
  const quietly = (next: State): void => {
    save(database, next);
    state = next;
  };

  /** Shows `id`, a kept tab, unless it's on screen already. */
  const show = (id: string): void => {
    if (state.active !== id) commit({ ...state, active: id });
  };

  /** Adds `tab` at the end of the strip and shows it. */
  const add = (tab: Kept): string => {
    commit({ kept: [...state.kept, tab], active: tab.id });
    return tab.id;
  };

  const moveTo = (id: string, to: number): Moved | undefined => {
    const from = state.kept.findIndex((tab) => tab.id === id);
    const moved = state.kept[from];
    if (!moved) return undefined;
    const place = Math.min(to, state.kept.length - 1);
    if (place !== from) {
      commit({ ...state, kept: state.kept.toSpliced(from, 1).toSpliced(place, 0, moved) });
    }
    return { id, place };
  };

  return {
    list,

    open(opening, as) {
      switch (opening.kind) {
        case 'pull': {
          const link = { owner: opening.owner, repo: opening.repo, number: opening.number };
          const pulls = state.kept.filter((tab): tab is PullTab => tab.kind === 'pull');
          const at = findTab(pulls.map(keyOf), link);
          const found = at === undefined ? undefined : pulls[at];
          if (found) {
            show(found.id);
            return found.id;
          }
          return add({ id: newId(), kind: 'pull', ...link, login: as?.login });
        }
        case 'settings': {
          const found = state.kept.find((tab) => tab.kind === 'settings');
          if (found) {
            show(found.id);
            return found.id;
          }
          return add({ id: newId(), kind: 'settings' });
        }
        default:
          opening satisfies never;
          throw new Error(`There's no kind of tab for ${JSON.stringify(opening)}.`);
      }
    },

    close(id) {
      const closing = id ?? state.active;
      const index = state.kept.findIndex((tab) => tab.id === closing);
      if (index < 0) return;
      const kept = state.kept.toSpliced(index, 1);
      const active = closing === state.active ? (kept[index] ?? kept[index - 1])?.id : state.active;
      commit({ kept, active });
    },

    select(choice) {
      const { tabs, active } = list();
      let chosen: Tab | undefined;
      if ('id' in choice) chosen = tabs.find((tab) => tab.id === choice.id);
      else if ('position' in choice) chosen = tabs[choice.position - 1];
      else if ('last' in choice) chosen = tabs.at(-1);
      else {
        const at = tabs.findIndex((tab) => tab.id === active);
        chosen = tabs[(at + choice.step + tabs.length) % tabs.length];
      }
      // Recent is on screen only while it's the only tab.
      if (chosen && chosen.kind !== 'recent') show(chosen.id);
    },

    move: moveTo,

    step(id, by) {
      const moving = id ?? list().active;
      const from = state.kept.findIndex((tab) => tab.id === moving);
      if (from < 0) return undefined;
      return moveTo(moving, Math.max(0, from + by));
    },

    describe(id, { title, state: pullState }) {
      const index = state.kept.findIndex((tab) => tab.id === id);
      const tab = state.kept[index];
      if (tab?.kind !== 'pull' || (tab.title === title && tab.state === pullState)) return;
      commit({ ...state, kept: state.kept.with(index, { ...tab, title, state: pullState }) });
    },

    kept(id) {
      const tab = state.kept.find((each) => each.id === id);
      if (tab?.kind !== 'pull') return {};
      return { login: tab.login, repository: tab.repository };
    },

    remember(id, { login, repository }) {
      const index = state.kept.findIndex((tab) => tab.id === id);
      const tab = state.kept[index];
      if (tab?.kind !== 'pull') return;
      const next: PullTab = {
        ...tab,
        login: login === undefined ? tab.login : (login ?? undefined),
        repository: repository ?? tab.repository,
      };
      if (next.login === tab.login && next.repository === tab.repository) return;
      quietly({ ...state, kept: state.kept.with(index, next) });
    },
  };
}

/** A kept tab as the strip shows it: without what main keeps for itself. */
function shown(tab: Kept): Tab {
  if (tab.kind !== 'pull') return tab;
  const { login: _login, repository: _repository, ...rest } = tab;
  return rest;
}

/**
 * The kept tabs, in order, and the one on screen. A row that can't be read is left out, and so is
 * one for a tab already read, Settings or the same pull request, since each opens in one tab: the
 * first stays, on screen if either was.
 */
function load(database: Database, log: (message: string) => void): State {
  const rows = database
    .prepare(
      'SELECT id, kind, owner, repo, number, title, state, active, login, repository FROM tab_tabs ORDER BY position, id',
    )
    .all();
  const kept: Kept[] = [];
  let active: string | undefined;
  for (const row of rows) {
    const tab = readRow(row);
    if (!tab) {
      log(`Lo left out a tab it couldn't read back (${String(row.id)}).`);
      continue;
    }
    const same = kept.find((other) => isSameTab(other, tab));
    if (same) log(`Lo left out a second tab for what ${same.id} shows (${tab.id}).`);
    else kept.push(tab);
    if (row.active === 1) active = (same ?? tab).id;
  }
  return { kept, active: active ?? kept[0]?.id };
}

/**
 * A pull request's tab's key: the link it was opened by, and its repository's name as GitHub last
 * gave it, so a link by either name finds it after a rename or a transfer.
 */
function keyOf({ owner, repo, number, repository }: PullTab): TabKey {
  const key = tabKey({ owner, repo, number });
  const [canonicalOwner, canonicalRepo] = repository?.split('/') ?? [];
  if (canonicalOwner === undefined || canonicalRepo === undefined) return key;
  return { ...key, canonical: { owner: canonicalOwner, repo: canonicalRepo } };
}

/** Whether `a` and `b` hold the same thing: both Settings, or the same pull request. */
function isSameTab(a: Kept, b: Kept): boolean {
  if (a.kind !== 'pull' || b.kind !== 'pull') return a.kind === b.kind;
  const { owner, repo, number } = a;
  return shows(tabKey({ owner, repo, number }), b);
}

/** A row as a kept tab, if it's one: what Lo saved is read as carefully as any outside value. */
function readRow(row: Row): Kept | undefined {
  const { id, kind, owner, repo, number, title, state, login, repository } = row;
  if (kind === 'pull' && !openingSchema.safeParse({ kind, owner, repo, number }).success) {
    return undefined;
  }
  const read = tabSchema.safeParse(
    kind === 'pull'
      ? {
          id,
          kind,
          owner,
          repo,
          number,
          ...(title === null ? {} : { title }),
          ...(state === null ? {} : { state }),
        }
      : { id, kind },
  );
  if (!read.success || read.data.kind === 'recent') return undefined;
  if (read.data.kind !== 'pull') return read.data;
  return {
    ...read.data,
    login: typeof login === 'string' && accountLogin.safeParse(login).success ? login : undefined,
    repository:
      typeof repository === 'string' && /^[^/\s]+\/[^/\s]+$/.test(repository)
        ? repository
        : undefined,
  };
}

/** Writes `state` over what `tab_tabs` held, in one transaction. */
function save(database: Database, { kept, active }: State): void {
  database.transaction(() => {
    database.prepare('DELETE FROM tab_tabs').run();
    const insert = database.prepare(
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, title, state, active, login, repository) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    kept.forEach((tab, position) => {
      const onScreen = tab.id === active ? 1 : 0;
      if (tab.kind === 'pull') {
        const { id, owner, repo, number, title, state, login, repository } = tab;
        insert.run(
          id,
          position,
          'pull',
          owner,
          repo,
          number,
          title ?? null,
          state ?? null,
          onScreen,
          login ?? null,
          repository ?? null,
        );
      } else {
        insert.run(tab.id, position, tab.kind, null, null, null, null, null, onScreen, null, null);
      }
    });
  });
}

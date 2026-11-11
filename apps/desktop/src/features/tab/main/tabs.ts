// The window's tabs as main keeps them: opened, closed, shown and moved, in the strip's order. Each
// change is written to `tab_tabs` before anyone hears of it, so the tabs come back as they were
// after Lo restarts. Nothing here calls Electron.

import { randomUUID } from 'node:crypto';

import type { Database, Row } from '../../../main/database.ts';
import {
  opening as openingSchema,
  tab as tabSchema,
  type Choice,
  type Opening,
  type PullState,
  type Tab,
  type Tabs,
} from '../contract.ts';
import { findTab, tabKey } from './pulls.ts';

/** Recent pull requests: the tab that stands in for an empty strip. */
export const RECENT: Tab = { id: 'recent', kind: 'recent' };

/** A tab main keeps: a pull request's or Settings'. */
type Kept = Exclude<Tab, { kind: 'recent' }>;
type PullTab = Extract<Tab, { kind: 'pull' }>;

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
   * open, by any name it's known by, or Settings when it's open, shows the tab it's in.
   */
  open(opening: Opening): string;
  /**
   * Closes `id`, or the tab on screen. Closing the tab on screen shows the one after it, or the
   * one before it at the end of the strip, or Recent once nothing is open. Recent stays.
   */
  close(id?: string): void;
  /** Shows a tab. A choice of no tab, such as a place past the last, changes nothing. */
  select(choice: Choice): void;
  /** Moves a tab to place `to`, from 0, or to the end when `to` is past it. */
  move(id: string, to: number): void;
  /** Keeps what GitHub said of a pull request's tab, so the strip shows it from then on. */
  describe(id: string, details: { title: string; state: PullState }): void;
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
    return { tabs: [...state.kept], active: state.active ?? first.id };
  };

  /** Writes `next`, then makes it the tabs and says so. A write that fails changes nothing. */
  const commit = (next: State): void => {
    save(database, next);
    state = next;
    changed(list());
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

  return {
    list,

    open(opening) {
      switch (opening.kind) {
        case 'pull': {
          const link = { owner: opening.owner, repo: opening.repo, number: opening.number };
          const pulls = state.kept.filter((tab): tab is PullTab => tab.kind === 'pull');
          const at = findTab(
            pulls.map(({ owner, repo, number }) => tabKey({ owner, repo, number })),
            link,
          );
          const found = at === undefined ? undefined : pulls[at];
          if (found) {
            show(found.id);
            return found.id;
          }
          return add({ id: newId(), kind: 'pull', ...link });
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
          throw new Error(`There's no kind of tab called ${String(opening)}.`);
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

    move(id, to) {
      const from = state.kept.findIndex((tab) => tab.id === id);
      const moved = state.kept[from];
      if (!moved) return;
      const place = Math.min(to, state.kept.length - 1);
      if (place === from) return;
      commit({ ...state, kept: state.kept.toSpliced(from, 1).toSpliced(place, 0, moved) });
    },

    describe(id, { title, state: pullState }) {
      const index = state.kept.findIndex((tab) => tab.id === id);
      const tab = state.kept[index];
      if (tab?.kind !== 'pull' || (tab.title === title && tab.state === pullState)) return;
      commit({ ...state, kept: state.kept.with(index, { ...tab, title, state: pullState }) });
    },
  };
}

/** The kept tabs, in order, and the one on screen. A row that can't be read is left out. */
function load(database: Database, log: (message: string) => void): State {
  const rows = database
    .prepare(
      'SELECT id, kind, owner, repo, number, title, state, active FROM tab_tabs ORDER BY position, id',
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
    kept.push(tab);
    if (row.active === 1) active = tab.id;
  }
  return { kept, active: active ?? kept[0]?.id };
}

/** A row as a kept tab, if it's one: what Lo saved is read as carefully as any outside value. */
function readRow(row: Row): Kept | undefined {
  const { id, kind, owner, repo, number, title, state } = row;
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
  return read.success && read.data.kind !== 'recent' ? read.data : undefined;
}

/** Writes `state` over what `tab_tabs` held, in one transaction. */
function save(database: Database, { kept, active }: State): void {
  database.transaction(() => {
    database.prepare('DELETE FROM tab_tabs').run();
    const insert = database.prepare(
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, title, state, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    kept.forEach((tab, position) => {
      const shown = tab.id === active ? 1 : 0;
      if (tab.kind === 'pull') {
        const { id, owner, repo, number, title, state } = tab;
        insert.run(id, position, 'pull', owner, repo, number, title ?? null, state ?? null, shown);
      } else {
        insert.run(tab.id, position, tab.kind, null, null, null, null, null, shown);
      }
    });
  });
}

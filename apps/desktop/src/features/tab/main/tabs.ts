// The window's tabs as main keeps them: opened, closed, shown and moved, in the strip's order, the
// layers each pull request's tab has views of, and the run of layers it shows as one diff, if any.
// Each change is written to `tab_tabs` before anyone hears of it, so the tabs come back as they were
// after Lo restarts, each at the layer it showed: a run isn't kept, so a tab that showed one comes
// back at the layer it was chosen from. Nothing here calls Electron.

import { randomUUID } from 'node:crypto';

import type { Database, Row } from '../../../main/database.ts';
import { login as accountLogin } from '../../accounts/contract.ts';
import {
  layerOf,
  layersOf,
  opening as openingSchema,
  pullNumber,
  runViewId,
  tab as tabSchema,
  viewId,
  viewIds,
  type Choice,
  type Moved,
  type Opening,
  type PullState,
  type Run,
  type Stack,
  type Tab,
  type Tabs,
} from '../contract.ts';
import { findLayer, findTab, shows, tabKey, type TabKey } from './pulls.ts';

/** Recent pull requests: the tab that stands in for an empty strip. */
export const RECENT: Tab = { id: 'recent', kind: 'recent' };

/**
 * A tab main keeps: a pull request's or Settings'. A pull request's also keeps the account it acts
 * as and its repository's name as GitHub last gave it, which the window isn't sent. Of its layers,
 * only the one on screen is written: its views of the others, and its stack, last while Lo runs.
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

/** What GitHub last said of a view's pull request. */
interface Described {
  readonly title: string;
  readonly state: PullState;
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
   * Opens a tab at the end of the strip and shows it, and returns the id of the view that shows
   * what was opened. A pull request already open, by any name it's known by, shows the tab it
   * opened in, at its layer; else one a tab's stack holds shows the first such tab, at that layer.
   * Settings when it's open shows its tab. A new pull request's tab keeps `as.login` as its
   * account, when given.
   */
  open(opening: Opening, as?: { login: string }): string;
  /**
   * Closes `id`, or the tab on screen, with every view it has. Closing the tab on screen shows the
   * one after it, or the one before it at the end of the strip, or Recent once nothing is open.
   * Recent stays.
   */
  close(id?: string): void;
  /** Shows a tab. A choice of no tab, such as a place past the last, changes nothing. */
  select(choice: Choice): void;
  /**
   * Shows pull request's tab `id`, or the tab of view `id`, at layer `number`, and returns the id
   * of its view of it, which is made the first time and lives until the tab closes. Nothing for a
   * tab that isn't a pull request's.
   */
  layer(id: string, number: number): string | undefined;
  /**
   * Shows a run of `run.layers` as one diff in pull request's tab `id`, or the tab of view `id`, in
   * place of the layer on screen, chosen from the layer view `id` shows: its view of that layer is
   * made if it has none, and showing any layer leaves the run. Returns the run's view's id. Nothing
   * for a tab that isn't a pull request's. The run isn't written, so the tab comes back at the
   * layer after a restart.
   */
  openRun(id: string, run: { layers: readonly number[]; start: string }): string | undefined;
  /**
   * Keeps the stack pull request's tab `id`, or the tab of view `id`, holds, or that it holds none:
   * a link to any of its layers shows the tab, and the window's title says where in it the layer on
   * screen is. It isn't written, since the stack is found again once Lo starts.
   */
  setLayers(id: string, stack: Stack | undefined): void;
  /**
   * Moves a tab to place `to`, from 0, counted without it, or to the end when `to` is past it, and
   * says where it is now. Nothing for a tab that isn't open.
   */
  move(id: string, to: number): Moved | undefined;
  /**
   * Moves `id`, or the tab on screen, one place along the strip, but not past its ends, nor past
   * the first `within` tabs, those the strip shows, and says where it is now. Nothing while only
   * Recent is open.
   */
  step(id: string | undefined, by: 1 | -1, within?: number): Moved | undefined;
  /**
   * Keeps what GitHub said of view `id`'s pull request, so the strip shows it while that layer is
   * on screen.
   */
  describe(id: string, details: { title: string; state: PullState }): void;
  /** What's kept with a pull request's tab, or a view's: its account and repository, if known. */
  kept(id: string): PullKept;
  /**
   * Keeps a pull request's tab's account, or forgets it with `null`, and its repository's name,
   * from the tab or any of its views, which share them. The window hears nothing of it.
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
  /** What GitHub said of each view's pull request, by the view's id, while its tab is open. */
  const described = new Map<string, Described>();
  for (const tab of state.kept) {
    if (tab.kind !== 'pull' || tab.title === undefined || tab.state === undefined) continue;
    described.set(viewId(tab, layerOf(tab)), { title: tab.title, state: tab.state });
  }

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

  /** Makes `next` the tabs and says so, without writing them: it changed nothing that's kept. */
  const tell = (next: State): void => {
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

  /**
   * The pull request's tab `id` names, by its own id or a view's, and that view's layer: for its view
   * of a run of layers, `run`, and the layer the run was chosen from.
   */
  const viewOf = (
    id: string,
  ): { index: number; tab: PullTab; layer: number; run: boolean } | undefined => {
    for (const [index, tab] of state.kept.entries()) {
      if (tab.kind !== 'pull') continue;
      if (tab.run && runViewId(tab, tab.run.layers) === id) {
        return { index, tab, layer: tab.run.from, run: true };
      }
      const layer = layersOf(tab).find((each) => viewId(tab, each) === id);
      if (layer !== undefined || tab.id === id) {
        return { index, tab, layer: layer ?? tab.number, run: false };
      }
    }
    return undefined;
  };

  /** The id of the tab `id` names: itself, or the pull request's tab one of whose views it is. */
  const tabOf = (id: string): string => viewOf(id)?.tab.id ?? id;

  /**
   * Shows `tab`, the kept pull request's tab at `index`, at `layer`, making its view of it if it
   * has none, and leaving the run of layers it shows, if any, and returns that view's id.
   */
  const showAt = (index: number, tab: PullTab, layer: number): string => {
    const id = viewId(tab, layer);
    const same = layerOf(tab) === layer;
    if (same && tab.run === undefined) {
      show(tab.id);
      return id;
    }
    // Leaving a run for the layer it was chosen from, the strip shows what it showed.
    const kept =
      same && tab.title !== undefined && tab.state !== undefined
        ? { title: tab.title, state: tab.state }
        : undefined;
    commit({
      kept: state.kept.with(index, atLayer(tab, layer, described.get(id) ?? kept)),
      active: tab.id,
    });
    return id;
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
          const pulls = state.kept.flatMap((tab, index) =>
            tab.kind === 'pull' ? [{ tab, index }] : [],
          );
          const keys = pulls.map(({ tab }) => keyOf(tab));
          // The tab opened on it, else the first whose stack holds it.
          const at = findTab(keys, link) ?? findLayer(keys, link);
          const found = at === undefined ? undefined : pulls[at];
          if (found) return showAt(found.index, found.tab, link.number);
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
      const closing = id === undefined ? state.active : tabOf(id);
      const index = state.kept.findIndex((tab) => tab.id === closing);
      const tab = state.kept[index];
      if (!tab) return;
      const kept = state.kept.toSpliced(index, 1);
      const active = closing === state.active ? (kept[index] ?? kept[index - 1])?.id : state.active;
      commit({ kept, active });
      for (const view of viewIds([tab])) described.delete(view);
    },

    select(choice) {
      const { tabs, active } = list();
      let chosen: Tab | undefined;
      if ('id' in choice) {
        const id = tabOf(choice.id);
        chosen = tabs.find((tab) => tab.id === id);
      } else if ('position' in choice) chosen = tabs[choice.position - 1];
      else if ('last' in choice) chosen = tabs.at(-1);
      else {
        // Round the ends of the tabs the strip shows.
        const strip = tabs.slice(0, choice.within ?? tabs.length);
        const at = strip.findIndex((tab) => tab.id === active);
        chosen =
          at < 0
            ? strip.at(choice.step > 0 ? 0 : -1)
            : strip[(at + choice.step + strip.length) % strip.length];
      }
      // Recent is on screen only while it's the only tab.
      if (chosen && chosen.kind !== 'recent') show(chosen.id);
    },

    layer(id, number) {
      const found = viewOf(id);
      return found && showAt(found.index, found.tab, number);
    },

    openRun(id, { layers, start }) {
      const found = viewOf(id);
      if (!found) return undefined;
      const { index, tab, layer } = found;
      const view = runViewId(tab, layers);
      const run = { layers: [...layers], start, from: layer };
      if (sameRun(tab.run, run)) {
        show(tab.id);
        return view;
      }
      const at =
        layerOf(tab) === layer ? tab : atLayer(tab, layer, described.get(viewId(tab, layer)));
      commit({ kept: state.kept.with(index, { ...at, run }), active: tab.id });
      return view;
    },

    setLayers(id, stack) {
      const found = viewOf(id);
      if (!found || sameStack(found.tab.stack, stack)) return;
      const { stack: _held, ...rest } = found.tab;
      const next: PullTab =
        stack === undefined
          ? rest
          : { ...rest, stack: { layers: [...stack.layers], root: stack.root } };
      tell({ ...state, kept: state.kept.with(found.index, next) });
    },

    move: (id, to) => moveTo(tabOf(id), to),

    step(id, by, within = state.kept.length) {
      const moving = id === undefined ? list().active : tabOf(id);
      const from = state.kept.findIndex((tab) => tab.id === moving);
      if (from < 0) return undefined;
      const last = Math.max(from, within - 1);
      return moveTo(moving, Math.min(Math.max(0, from + by), last));
    },

    describe(id, { title, state: pullState }) {
      const found = viewOf(id);
      // A run of layers is a view of its top layer, which the strip doesn't show.
      if (!found || found.run) return;
      const { index, tab, layer } = found;
      described.set(viewId(tab, layer), { title, state: pullState });
      // The strip shows the layer on screen's.
      if (layer !== layerOf(tab) || (tab.title === title && tab.state === pullState)) return;
      commit({ ...state, kept: state.kept.with(index, { ...tab, title, state: pullState }) });
    },

    kept(id) {
      const tab = viewOf(id)?.tab;
      if (!tab) return {};
      return { login: tab.login, repository: tab.repository };
    },

    remember(id, { login, repository }) {
      const found = viewOf(id);
      if (!found) return;
      const { index, tab } = found;
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

/**
 * `tab` at `layer`, which isn't the layer on screen, or with a run of layers on screen: with a view
 * of it, and the title and state GitHub gave it, `said`, until GitHub says them again, and no run.
 */
function atLayer(tab: PullTab, layer: number, said: Described | undefined): PullTab {
  const { layer: _shown, layers: _views, title: _title, state: _state, run: _run, ...rest } = tab;
  const views = layersOf(tab);
  return {
    ...rest,
    ...said,
    ...(layer === tab.number ? {} : { layer }),
    layers: views.includes(layer) ? [...views] : [...views, layer],
  };
}

/** Whether `a` and `b` are the same run, from the same start, or both none. */
function sameRun(a: Run | undefined, b: Run | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start === b.start &&
    a.from === b.from &&
    a.layers.length === b.layers.length &&
    a.layers.every((layer, at) => layer === b.layers[at])
  );
}

/** Whether `a` and `b` are the same stack, or both none. */
function sameStack(a: Stack | undefined, b: Stack | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.root === b.root &&
    a.layers.length === b.layers.length &&
    a.layers.every((layer, at) => layer === b.layers[at])
  );
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
      'SELECT id, kind, owner, repo, number, title, state, active, login, repository, layer FROM tab_tabs ORDER BY position, id',
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
 * gave it, so a link by either name finds it after a rename or a transfer; and its layers, those of
 * its stack and those it has views of, so a link to any of them finds it too.
 */
function keyOf(tab: PullTab): TabKey {
  const { owner, repo, number, repository } = tab;
  const key = {
    ...tabKey({ owner, repo, number }),
    layers: [...(tab.stack?.layers ?? []), ...layersOf(tab)],
  };
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

/**
 * A row as a kept tab, if it's one: what Lo saved is read as carefully as any outside value. A
 * layer that can't be read back leaves the tab at its own. Only the view of the layer on screen is
 * made at first.
 */
function readRow(row: Row): Kept | undefined {
  const { id, kind, owner, repo, number, title, state, login, repository, layer } = row;
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
  const shownLayer = pullNumber.safeParse(layer);
  const restored =
    shownLayer.success && shownLayer.data !== read.data.number
      ? { layer: shownLayer.data, layers: [shownLayer.data] }
      : {};
  return {
    ...read.data,
    ...restored,
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
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, title, state, active, login, repository, layer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    kept.forEach((tab, position) => {
      const onScreen = tab.id === active ? 1 : 0;
      if (tab.kind === 'pull') {
        const { id, owner, repo, number, title, state, login, repository, layer } = tab;
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
          layer ?? null,
        );
      } else {
        insert.run(
          tab.id,
          position,
          tab.kind,
          null,
          null,
          null,
          null,
          null,
          onScreen,
          null,
          null,
          null,
        );
      }
    });
  });
}

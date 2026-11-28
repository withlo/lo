// The stacks feature's offers in main: the finder offers each only once Settings says it's on, works
// the tabs out again as a switch turns, and `stacks.dismiss` keeps what's dismissed, the tree's
// offer by which it is, or the plain one where the tree makes none, for each of the stack's layers,
// and the start for its layer. The finder is a stand-in that hands back the options main gave it.

import { describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { openDatabase, type Database } from '../../../main/database.ts';
import type { Caller, FeatureContext } from '../../../main/features.ts';
import { migrate } from '../../../main/migrations.ts';
import type { Service } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { overviews } from '../../overview/service.ts';
import { settings } from '../../settings/service.ts';
import { tabs } from '../../tab/service.ts';
import type { Row, StackState, StackView } from '../contract.ts';
import type * as Finder from './finder.ts';
import type { FinderOptions } from './finder.ts';
import feature from './index.ts';

/** Each finder main made, with the options it was given, the states and callouts a test sets. */
const made = vi.hoisted(() => ({
  finders: [] as {
    readonly options: FinderOptions;
    readonly states: Map<string, StackState>;
    readonly callouts: Map<string, 'convert' | 'add'>;
    changed: number;
  }[],
}));

vi.mock('./finder.ts', async (original) => {
  const real = await original<typeof Finder>();
  class StackFinder {
    readonly options: FinderOptions;
    readonly states = new Map<string, StackState>();
    readonly callouts = new Map<string, 'convert' | 'add'>();
    changed = 0;
    constructor(options: FinderOptions) {
      this.options = options;
      made.finders.push(this);
    }
    follow(): void {}
    state(id: string): StackState | undefined {
      return this.states.get(id);
    }
    callout(id: string): 'convert' | 'add' | undefined {
      return this.callouts.get(id);
    }
    noticesChanged(): void {
      this.changed += 1;
    }
    overviewsChanged(): void {}
    forgetAccount(): void {}
    stop(): void {}
  }
  return { ...real, StackFinder };
});

const REPO = 'rozed-dev/e2e';
const NO_WINDOW: Caller = { windowId: undefined };
const nothing = () => undefined;

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/stacks/'), sql]),
);

/** Layer `number`'s row in the tree. */
function row(number: number): Row {
  return {
    number,
    title: `#${String(number)}`,
    author: 'rozed-bot',
    head: `stack/${String(number)}`,
    state: 'open',
    current: number === 84,
    branch: false,
    on: null,
    path: [],
    review: null,
    checks: null,
    queue: null,
    needsRebase: false,
    overview: null,
    viewed: null,
    threads: null,
  };
}

/** Tab `t1`'s stack, #82 to #85, on #84, with the offer to convert it over its tree. */
const STACKED: Extract<StackView, { kind: 'stack' }> = {
  kind: 'stack',
  root: 'stack/root',
  start: null,
  githubStack: false,
  rows: [82, 83, 84, 85].map(row),
  notes: [],
  offered: true,
  callout: 'This branch stack merges one layer at a time.',
};
const STACK: StackState = { id: 't1', stack: STACKED, offer: null };

/**
 * Starts the feature on `database`, with tab `t1` on #84 of rozed-dev/e2e, as rozed-bot, and
 * Settings, which calls each setting's watcher once it's read. Returns the context, the watchers by
 * setting, and the finder main made.
 */
function started(database: Database) {
  const watchers = new Map<string, (value: boolean) => void>();
  const services = new Map<Service<unknown>, unknown>([
    [
      tabs,
      {
        list: () => ({
          tabs: [{ id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 84 }],
          active: 't1',
        }),
        pull: () => ({
          repository: { owner: 'rozed-dev', name: 'e2e' },
          acting: { kind: 'account', login: 'rozed-bot' },
          local: { kind: 'pending' },
        }),
        onTabs: () => nothing,
        onPull: () => nothing,
      },
    ],
    [github, { onEvent: () => nothing }],
    [overviews, { on: () => false, onChange: () => nothing }],
    [
      settings,
      {
        watch: (setting: { key: string }, listener: (value: boolean) => void) => {
          watchers.set(setting.key, listener);
          return nothing;
        },
      },
    ],
  ]);
  const parts: Partial<FeatureContext<typeof feature.contract>> = {
    database,
    publish: nothing,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each stand-in is its service's.
    use: <T>(service: Service<T>) => services.get(service) as T,
  };
  const context: FeatureContext<typeof feature.contract> = Object.assign(
    Object.create(null),
    parts,
  );
  feature.start?.(context);
  const finder = made.finders.at(-1);
  if (!finder) throw new Error('Main made no finder.');
  return { context, watchers, finder };
}

/** A database with the feature's tables and nothing else. */
function migrated(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

describe('stacks in main', () => {
  it('offers nothing until Settings is read, then what each switch says, and works the tabs out again as one turns', async () => {
    const { context, watchers, finder } = started(migrated());
    const offers = finder.options.offers!;
    for (const notice of ['convert', 'add', 'start'] as const) {
      expect(offers(notice, REPO, [84])).toBe(false);
    }
    watchers.get('stacks.offerConvert')?.(true);
    expect(finder.changed).toBe(1);
    // The tree's two offers are both the offer of GitHub stacks.
    expect([offers('convert', REPO, [84]), offers('add', REPO, [84])]).toEqual([true, true]);
    expect(offers('start', REPO, [84])).toBe(false);
    watchers.get('stacks.offerStart')?.(true);
    expect(offers('start', REPO, [84])).toBe(true);
    watchers.get('stacks.offerConvert')?.(false);
    expect([offers('convert', REPO, [84]), offers('add', REPO, [84])]).toEqual([false, false]);
    expect(finder.changed).toBe(3);
    await feature.stop?.(context);
  });

  it('keeps the tree’s offer dismissed by which it is, for each of the stack’s layers, and the start for its layer, through a restart', async () => {
    const opened = migrated();
    const { context, watchers, finder } = started(opened);
    watchers.get('stacks.offerConvert')?.(true);
    watchers.get('stacks.offerStart')?.(true);
    finder.states.set('t1', STACK);
    finder.callouts.set('t1', 'convert');
    const changed = finder.changed;
    feature.handlers['dismiss']?.({ id: 't1', notice: 'convert' }, context, NO_WINDOW);
    expect(finder.changed).toBe(changed + 1);
    const offers = finder.options.offers!;
    expect(offers('convert', REPO, [85])).toBe(false);
    // The offer to add layers to a GitHub stack, made later, is another.
    expect(offers('add', REPO, [85])).toBe(true);
    finder.callouts.set('t1', 'add');
    feature.handlers['dismiss']?.({ id: 't1', notice: 'convert' }, context, NO_WINDOW);
    feature.handlers['dismiss']?.({ id: 't1', notice: 'start' }, context, NO_WINDOW);
    expect(
      opened.prepare('SELECT notice, repo, number FROM stacks_dismissed ORDER BY rowid').all(),
    ).toEqual([
      ...[82, 83, 84, 85].map((number) => ({ notice: 'convert', repo: REPO, number })),
      ...[82, 83, 84, 85].map((number) => ({ notice: 'add', repo: REPO, number })),
      { notice: 'start', repo: REPO, number: 84 },
    ]);
    await feature.stop?.(context);
    const again = started(opened);
    again.watchers.get('stacks.offerConvert')?.(true);
    again.watchers.get('stacks.offerStart')?.(true);
    for (const notice of ['convert', 'add', 'start'] as const) {
      expect(again.finder.options.offers!(notice, REPO, [84])).toBe(false);
    }
    expect(again.finder.options.offers!('start', REPO, [85])).toBe(true);
    await feature.stop?.(again.context);
  });

  it('says why it can’t dismiss: no pull request in that tab, no offer there now, or Lo quitting', async () => {
    const { context, finder } = started(migrated());
    /** What dismissing `notice` in tab `id` throws, by its code and message. */
    const refusal = (id: string, notice: 'convert' | 'start') => {
      try {
        feature.handlers['dismiss']?.({ id, notice }, context, NO_WINDOW);
      } catch (error) {
        return error instanceof IpcError ? [error.code, error.message] : error;
      }
      return undefined;
    };
    expect(refusal('t9', 'start')).toEqual(['notFound', 'There’s no pull request in that tab.']);
    finder.states.set('t1', { id: 't1', stack: { kind: 'none' }, offer: null });
    expect(refusal('t1', 'convert')).toEqual(['missing', 'That offer is no longer there.']);
    // Dismissed or turned off since its menu opened: nothing more is kept.
    finder.states.set('t1', { ...STACK, stack: { ...STACKED, offered: false, callout: null } });
    expect(refusal('t1', 'convert')).toEqual(['missing', 'That offer is no longer there.']);
    await feature.stop?.(context);
    expect(refusal('t1', 'start')).toEqual(['stopped', 'Lo is quitting.']);
  });

  it('dismisses the merge panel’s offer of a GitHub stack, where the tree makes none, as the plain one', async () => {
    const opened = migrated();
    const { context, watchers, finder } = started(opened);
    watchers.get('stacks.offerConvert')?.(true);
    finder.states.set('t1', STACK);
    feature.handlers['dismiss']?.({ id: 't1', notice: 'convert' }, context, NO_WINDOW);
    expect(
      opened.prepare('SELECT notice, number FROM stacks_dismissed ORDER BY rowid').all(),
    ).toEqual([82, 83, 84, 85].map((number) => ({ notice: 'convert', number })));
    expect(finder.options.offers!('convert', REPO, [84])).toBe(false);
    await feature.stop?.(context);
  });
});

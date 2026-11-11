import { describe, expect, it } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { Tab, Tabs } from '../contract.ts';
import { createTabs, RECENT, type TabList } from './tabs.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/tab/'), sql]),
);

/** A database with the tab feature's tables. */
function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

/** The tabs on `database`, with ids `t1`, `t2`… and what they said each time they changed. */
function tabsOn(on: Database) {
  const heard: Tabs[] = [];
  let made = 0;
  const tabs = createTabs({
    database: on,
    changed: (value) => heard.push(value),
    newId: () => `t${++made}`,
    log: () => {},
  });
  return { tabs, heard };
}

const fd = { kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 } as const;
const bat = { kind: 'pull', owner: 'sharkdp', repo: 'bat', number: 7 } as const;
const lo = { kind: 'pull', owner: 'withlo', repo: 'lo', number: 1 } as const;

/** A tab as a short name: `fd#2212`, `settings` or `recent`. */
function nameOf(tab: Tab): string {
  return tab.kind === 'pull' ? `${tab.repo}#${tab.number}` : tab.kind;
}

/** Each tab's short name, the one on screen starred. */
function names({ tabs, active }: Tabs): string[] {
  return tabs.map((tab) => (tab.id === active ? `*${nameOf(tab)}` : nameOf(tab)));
}

/** A list with `fd`, `bat` and `lo` open, in that order, and `lo` on screen. */
function three(): { tabs: TabList; heard: Tabs[] } {
  const made = tabsOn(database());
  for (const opening of [fd, bat, lo]) made.tabs.open(opening);
  made.heard.length = 0;
  return made;
}

describe('the tabs', () => {
  it('are Recent pull requests alone while nothing is open', () => {
    const { tabs } = tabsOn(database());
    expect(tabs.list()).toEqual({ tabs: [RECENT], active: 'recent' });
  });

  it('open a pull request at the end of the strip and show it, in Recent’s place', () => {
    const { tabs, heard } = tabsOn(database());
    expect(tabs.open(fd)).toBe('t1');
    expect(tabs.list()).toEqual({
      tabs: [{ id: 't1', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 }],
      active: 't1',
    });
    expect(tabs.open(bat)).toBe('t2');
    expect(names(tabs.list())).toEqual(['fd#2212', '*bat#7']);
    // Each change was heard once, as it was written.
    expect(heard.map(names)).toEqual([['*fd#2212'], ['fd#2212', '*bat#7']]);
  });

  it('show the tab a pull request is open in, by any case of its name, rather than open another', () => {
    const { tabs, heard } = tabsOn(database());
    tabs.open(fd);
    tabs.open(bat);
    expect(tabs.open({ ...fd, owner: 'SharkDP', repo: 'FD' })).toBe('t1');
    expect(names(tabs.list())).toEqual(['*fd#2212', 'bat#7']);
    // Asked for the tab on screen, nothing changes, and nothing is said.
    heard.length = 0;
    expect(tabs.open(fd)).toBe('t1');
    expect(heard).toEqual([]);
  });

  it('open Settings once', () => {
    const { tabs } = tabsOn(database());
    expect(tabs.open({ kind: 'settings' })).toBe('t1');
    tabs.open(fd);
    expect(tabs.open({ kind: 'settings' })).toBe('t1');
    expect(names(tabs.list())).toEqual(['*settings', 'fd#2212']);
  });
});

describe('closing a tab', () => {
  it('shows the one after the tab on screen, or before it at the end', () => {
    const { tabs } = three();
    tabs.select({ position: 2 });
    tabs.close();
    expect(names(tabs.list())).toEqual(['fd#2212', '*lo#1']);
    tabs.close();
    expect(names(tabs.list())).toEqual(['*fd#2212']);
  });

  it('keeps the tab on screen when another closes', () => {
    const { tabs } = three();
    tabs.close('t1');
    expect(names(tabs.list())).toEqual(['bat#7', '*lo#1']);
  });

  it('brings Recent back once nothing is open, and leaves it there', () => {
    const { tabs, heard } = tabsOn(database());
    tabs.open(fd);
    tabs.close();
    expect(tabs.list()).toEqual({ tabs: [RECENT], active: 'recent' });
    heard.length = 0;
    tabs.close();
    tabs.close('recent');
    expect(tabs.list()).toEqual({ tabs: [RECENT], active: 'recent' });
    expect(heard).toEqual([]);
  });

  it('of a tab that isn’t open changes nothing', () => {
    const { tabs, heard } = three();
    tabs.close('gone');
    expect(heard).toEqual([]);
  });
});

describe('showing a tab', () => {
  it('by its id, its place from 1, or the last', () => {
    const { tabs } = three();
    tabs.select({ id: 't2' });
    expect(names(tabs.list())).toEqual(['fd#2212', '*bat#7', 'lo#1']);
    tabs.select({ position: 1 });
    expect(names(tabs.list())).toEqual(['*fd#2212', 'bat#7', 'lo#1']);
    tabs.select({ last: true });
    expect(names(tabs.list())).toEqual(['fd#2212', 'bat#7', '*lo#1']);
  });

  it('steps to the next and previous, round the ends', () => {
    const { tabs } = three();
    tabs.select({ step: 1 });
    expect(tabs.list().active).toBe('t1');
    tabs.select({ step: -1 });
    expect(tabs.list().active).toBe('t3');
    tabs.select({ step: -1 });
    expect(tabs.list().active).toBe('t2');
  });

  it('of no tab, or the one on screen, changes nothing', () => {
    const { tabs, heard } = three();
    tabs.select({ position: 4 });
    tabs.select({ id: 'gone' });
    tabs.select({ id: 't3' });
    tabs.select({ last: true });
    expect(heard).toEqual([]);
    // Recent alone stays on screen whatever's asked.
    const alone = tabsOn(database());
    alone.tabs.select({ step: 1 });
    alone.tabs.select({ position: 1 });
    expect(alone.tabs.list().active).toBe('recent');
    expect(alone.heard).toEqual([]);
  });
});

describe('moving a tab', () => {
  it('puts it at its new place, or at the end past it', () => {
    const { tabs } = three();
    tabs.move('t3', 0);
    expect(names(tabs.list())).toEqual(['*lo#1', 'fd#2212', 'bat#7']);
    tabs.move('t3', 99);
    expect(names(tabs.list())).toEqual(['fd#2212', 'bat#7', '*lo#1']);
    tabs.move('t1', 1);
    expect(names(tabs.list())).toEqual(['bat#7', 'fd#2212', '*lo#1']);
  });

  it('changes nothing for a tab that isn’t open, or one already there', () => {
    const { tabs, heard } = three();
    tabs.move('gone', 0);
    tabs.move('t2', 1);
    expect(heard).toEqual([]);
  });
});

describe('what GitHub says of a pull request', () => {
  it('shows in its tab, and changes nothing when it’s the same', () => {
    const { tabs, heard } = three();
    tabs.describe('t1', { title: 'Honor explicit use-jemalloc requests', state: 'open' });
    expect(tabs.list().tabs[0]).toEqual({
      id: 't1',
      kind: 'pull',
      owner: 'sharkdp',
      repo: 'fd',
      number: 2212,
      title: 'Honor explicit use-jemalloc requests',
      state: 'open',
    });
    tabs.describe('t1', { title: 'Honor explicit use-jemalloc requests', state: 'open' });
    tabs.describe('gone', { title: 'x', state: 'open' });
    expect(heard).toHaveLength(1);
  });
});

describe('what a pull request’s tab keeps for main', () => {
  it('is its account and its repository’s name, kept quietly, and never sent to the window', () => {
    const on = database();
    const { tabs, heard } = tabsOn(on);
    tabs.open(fd);
    heard.length = 0;
    expect(tabs.kept('t1')).toEqual({ login: undefined, repository: undefined });

    tabs.remember('t1', { login: 'rozed-bot', repository: 'sharkdp/fd' });

    expect(tabs.kept('t1')).toEqual({ login: 'rozed-bot', repository: 'sharkdp/fd' });
    expect(heard).toEqual([]);
    expect(JSON.stringify(tabs.list())).not.toContain('rozed-bot');
    // It comes back with the tab, and goes with `null`.
    const after = tabsOn(on).tabs;
    expect(after.kept('t1')).toEqual({ login: 'rozed-bot', repository: 'sharkdp/fd' });
    expect(JSON.stringify(after.list())).not.toContain('rozed-bot');
    after.remember('t1', { login: null });
    expect(tabsOn(on).tabs.kept('t1')).toEqual({ login: undefined, repository: 'sharkdp/fd' });
    // A tab that isn't a pull request's keeps nothing.
    const settings = tabsOn(database()).tabs;
    settings.open({ kind: 'settings' });
    settings.remember('t1', { login: 'rozed-bot' });
    expect(settings.kept('t1')).toEqual({});
  });

  it('is the account a pull request’s tab opened as, when it was given, and only for a new tab', () => {
    const on = database();
    const { tabs, heard } = tabsOn(on);
    expect(tabs.open(fd, { login: 'rozed-bot' })).toBe('t1');
    expect(tabs.kept('t1')).toEqual({ login: 'rozed-bot', repository: undefined });
    expect(JSON.stringify(heard)).not.toContain('rozed-bot');
    expect(tabsOn(on).tabs.kept('t1')).toEqual({ login: 'rozed-bot', repository: undefined });
    // A tab already open keeps the account it has.
    expect(tabs.open(fd, { login: 'someone-else' })).toBe('t1');
    expect(tabs.kept('t1')).toEqual({ login: 'rozed-bot', repository: undefined });
    tabs.open(bat);
    expect(tabs.kept('t2')).toEqual({ login: undefined, repository: undefined });
  });

  it('finds the tab by its repository’s name now, after a rename, as well as by its link', () => {
    const { tabs } = tabsOn(database());
    const id = tabs.open({ kind: 'pull', owner: 'sharkdp', repo: 'fd-old', number: 2212 });
    tabs.remember(id, { repository: 'sharkdp/fd' });
    expect(tabs.open(fd)).toBe(id);
    expect(tabs.open({ ...fd, owner: 'SharkDP', repo: 'FD' })).toBe(id);
    expect(tabs.open({ ...fd, repo: 'fd-old' })).toBe(id);
    expect(tabs.list().tabs).toHaveLength(1);
  });

  it('is read back as carefully as any outside value', () => {
    const on = database();
    on.prepare(
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, active, login, repository) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run('fd', 0, 'pull', 'sharkdp', 'fd', 2212, 'not a login!', '../../etc');
    const tabs = createTabs({ database: on, changed: () => {}, log: () => {} });
    expect(tabs.kept('fd')).toEqual({ login: undefined, repository: undefined });
    expect(names(tabs.list())).toEqual(['*fd#2212']);
  });
});

describe('restoring the tabs', () => {
  it('brings back every tab in its order, with what GitHub said, and the one on screen', () => {
    const on = database();
    const before = tabsOn(on).tabs;
    for (const opening of [fd, { kind: 'settings' } as const, bat, lo]) before.open(opening);
    before.move('t4', 0);
    before.describe('t1', { title: 'Honor explicit use-jemalloc requests', state: 'merged' });
    before.select({ position: 3 });
    before.close('t3');

    const after = tabsOn(on).tabs;
    expect(after.list()).toEqual(before.list());
    expect(names(after.list())).toEqual(['lo#1', 'fd#2212', '*settings']);
    // Opening again finds what came back.
    expect(after.open({ kind: 'settings' })).toBe('t2');
  });

  it('leaves out a row it can’t read, and shows the first tab when none was on screen', () => {
    const on = database();
    const insert = on.prepare(
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, active) VALUES (?, ?, ?, ?, ?, ?, 0)',
    );
    // A repository GitHub can't have, which names no folder Lo would make.
    insert.run('bad', 0, 'pull', 'sharkdp', '..', 1);
    insert.run('good', 1, 'pull', 'sharkdp', 'fd', 2212);
    const logged: string[] = [];
    const tabs = createTabs({ database: on, changed: () => {}, log: (line) => logged.push(line) });
    expect(names(tabs.list())).toEqual(['*fd#2212']);
    expect(logged).toEqual(["Lo left out a tab it couldn't read back (bad)."]);
  });

  it('keeps one tab for Settings and for each pull request, on screen if any of them was', () => {
    const on = database();
    const insert = on.prepare(
      'INSERT INTO tab_tabs (id, position, kind, owner, repo, number, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('s1', 0, 'settings', null, null, null, 0);
    insert.run('fd', 1, 'pull', 'sharkdp', 'fd', 2212, 0);
    insert.run('s2', 2, 'settings', null, null, null, 0);
    insert.run('FD', 3, 'pull', 'SharkDP', 'FD', 2212, 1);
    insert.run('bat', 4, 'pull', 'sharkdp', 'bat', 7, 0);
    const logged: string[] = [];
    const tabs = createTabs({ database: on, changed: () => {}, log: (line) => logged.push(line) });
    expect(tabs.list().tabs.map(({ id }) => id)).toEqual(['s1', 'fd', 'bat']);
    expect(tabs.list().active).toBe('fd');
    expect(logged).toEqual([
      'Lo left out a second tab for what s1 shows (s2).',
      'Lo left out a second tab for what fd shows (FD).',
    ]);
  });

  it('changes nothing when the change can’t be written', () => {
    const on = database();
    const { tabs, heard } = tabsOn(on);
    tabs.open(fd);
    heard.length = 0;
    on.exec('DROP TABLE tab_tabs');
    expect(() => tabs.open(bat)).toThrow('no such table: tab_tabs');
    expect(names(tabs.list())).toEqual(['*fd#2212']);
    expect(heard).toEqual([]);
  });
});

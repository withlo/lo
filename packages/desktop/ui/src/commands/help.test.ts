import { describe, expect, it } from 'vitest';

import { defineCommands, handlers, type Command } from './declare.ts';
import {
  areaOfCommand,
  filterHelp,
  filterPalette,
  helpAll,
  helpAreas,
  helpHere,
  paletteItems,
  plainLabel,
  type HelpGroup,
  type HelpOptions,
} from './help.ts';
import { Registry } from './registry.ts';
import { NO_TARGET, type Target } from './targets.ts';

const run = { run() {} };

const declared = defineCommands(
  'diff',
  {
    down: { label: 'Line down', group: 'Go', keys: ['j'], vim: 'own' },
    markViewed: {
      label: 'Mark viewed',
      group: 'Review',
      keys: ['e'],
      targets: ['file'],
      overVim: true,
      when: { scope: ['diff', 'tree'], mode: 'normal' },
    },
    nextFile: { label: 'Next file', group: 'Go', keys: ['] f'] },
    palette: { label: 'Command palette', group: 'Go', keys: ['cmd+shift+p'] },
    open: { label: 'Open a PR', group: 'Go', keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }] },
    quit: {
      label: 'Quit Lo',
      group: 'Tabs',
      keys: ['cmd+q'],
      when: { system: 'linux' },
    },
    escape: {
      label: 'Back to the middle view',
      group: 'Tabs',
      keys: ['esc'],
      when: { except: ['menu', 'box'] },
    },
    merge: {
      label: 'Merge',
      description: 'Merges the whole pull request.',
      group: 'Review',
      keys: ['m'],
    },
  },
  { scopes: ['tree'] },
);

function registry(
  system: 'mac' | 'linux' = 'mac',
  disabled: readonly string[] = [],
  queued?: number,
) {
  return new Registry({
    system,
    commands: handlers(declared, {
      markViewed: run,
      nextFile: run,
      palette: run,
      open: run,
      quit: run,
      escape: run,
      merge: {
        run() {},
        enabled: () => (disabled.includes('merge') ? 'Nothing to merge.' : true),
        detail: () => (queued === undefined ? undefined : `${queued} queued`),
      },
    }),
  });
}

const vim = { vim: true };

/** The row keyboard shortcuts lists for `id` with `options`. */
const rowOf = (options: HelpOptions, id: string) =>
  helpAll(registry(), options)
    .flatMap((group) => group.rows)
    .find((each) => each.id === id);

/** Whether `command` is one only Vim has: here, `diff.down`. */
const vimOnly = (command: Command) => command.id === 'diff.down';

/** The ids of what "Here" lists in `scope`, on `target`, with the commands `disabled` disabled. */
const hereOf = (scope: string, disabled: readonly string[] = [], target: Target = NO_TARGET) =>
  helpHere(registry('mac', disabled), scope, target, vim).flatMap((group) =>
    group.rows.map((row) => row.id),
  );

/** The keys keyboard shortcuts shows for `id`, on `system`. */
function keysOf(system: 'mac' | 'linux', id: string) {
  return helpAll(registry(system), vim)
    .flatMap((group) => group.rows)
    .find((row) => row.id === id)?.keys;
}

/** The ids of the rows in `groups`, in order. */
const idsOf = (groups: readonly HelpGroup[]) =>
  groups.flatMap((group) => group.rows.map((row) => row.id));

describe('keyboard shortcuts', () => {
  it('lists the groups in their fixed order, with each command on this system', () => {
    const groups = helpAll(registry(), vim);
    expect(groups.map((group) => group.group)).toEqual(['Go', 'Review', 'Tabs']);
    expect(groups.find((group) => group.group === 'Tabs')?.rows.map((row) => row.id)).toEqual([
      'diff.escape',
    ]);
    expect(
      helpAll(registry('linux'), vim)
        .find((group) => group.group === 'Tabs')
        ?.rows.map((row) => row.id),
    ).toEqual(['diff.quit', 'diff.escape']);
  });

  it('shows keys in this system’s form, every key a command has', () => {
    expect(keysOf('mac', 'diff.palette')).toEqual([['⌘⇧P']]);
    expect(keysOf('linux', 'diff.palette')).toEqual([['Ctrl+Shift+P']]);
    expect(keysOf('mac', 'diff.open')).toEqual([['⌘L'], ['⌘O']]);
    expect(keysOf('linux', 'diff.open')).toEqual([['Ctrl+L']]);
    expect(keysOf('mac', 'diff.nextFile')).toEqual([[']', 'f']]);
  });

  it('follows the keymap file live, and leaves out a command with no key unless asked', () => {
    const live = registry();
    const nextFile = (all?: boolean) =>
      helpAll(live, { vim: true, all })
        .flatMap((group) => group.rows)
        .find((row) => row.id === 'diff.nextFile')?.keys;
    live.setKeymap('bind g n diff.nextFile');
    expect(nextFile()).toEqual([
      ['g', 'n'],
      [']', 'f'],
    ]);
    live.setKeymap('bind g n diff.nextFile\nunbind ] f');
    expect(nextFile()).toEqual([['g', 'n']]);
    live.setKeymap('unbind ] f');
    expect(nextFile()).toBeUndefined();
    expect(nextFile(true)).toEqual([]);
  });

  it('tags Vim’s own keys and those that replace Vim’s only with Vim keys on', () => {
    expect(rowOf(vim, 'diff.down')).toMatchObject({ vim: true, overVim: false });
    expect(rowOf(vim, 'diff.markViewed')).toMatchObject({ vim: false, overVim: true });
    expect(rowOf({ vim: false }, 'diff.down')).toMatchObject({ vim: false, overVim: false });
    expect(rowOf({ vim: false }, 'diff.markViewed')).toMatchObject({ vim: false, overVim: false });
    // A key only Vim has is gone with Vim keys off.
    expect(rowOf({ vim: false, vimOnly }, 'diff.down')).toBeUndefined();
    expect(rowOf({ vim: true, vimOnly }, 'diff.down')).toBeDefined();
  });

  it('opens on the keys that work where focus is and can run on its target', () => {
    // Vim's own keys are listed wherever they apply: nothing checks them against a target.
    expect(hereOf('window')).toEqual([
      'diff.down',
      'diff.nextFile',
      'diff.palette',
      'diff.open',
      'diff.merge',
      'diff.escape',
    ]);
    expect(hereOf('window', ['merge'])).not.toContain('diff.merge');
    expect(hereOf('box')).not.toContain('diff.escape');
    expect(hereOf('diff', [], { kind: 'file', file: 'a.ts' })).toContain('diff.markViewed');
  });

  it('gives each area a tab of the keys that work there, in the areas’ order', () => {
    const areas = helpAreas(registry(), vim);
    expect(areas.map(({ scope, name }) => [scope, name])).toEqual([
      ['window', 'Anywhere'],
      ['diff', 'Diff'],
      ['tree', 'Files'],
    ]);
    expect(idsOf(areas.find((area) => area.scope === 'tree')?.groups ?? [])).toEqual([
      'diff.markViewed',
    ]);
    expect(areaOfCommand(registry(), 'diff.markViewed')).toBe('diff');
    expect(areaOfCommand(registry(), 'diff.open')).toBe('window');
  });

  it('makes one row of the commands in a group with one label, with all their keys', () => {
    const twins = new Registry({
      system: 'mac',
      commands: handlers(
        defineCommands('diff', {
          next: { label: 'Next', group: 'Go', keys: ['n'], when: { scope: 'diff' } },
          nextRow: { label: 'Next', group: 'Go', keys: ['j', 'n'], when: { scope: 'tree' } },
        }),
        { next: run, nextRow: run },
      ),
    });
    const [merged] = helpAll(twins, vim).flatMap((group) => group.rows);
    expect(merged).toMatchObject({ id: 'diff.next', ids: ['diff.next', 'diff.nextRow'] });
    expect(merged?.keys).toEqual([['n'], ['j']]);
  });

  it('makes one row of a series, its keys a range, there whole in "Here" while any of it runs', () => {
    const shown = new Set(['tab.show2']);
    const [all] = helpAll(tabs(shown), vim).flatMap((group) => group.rows);
    expect(all).toMatchObject({
      label: 'Tab 1–3',
      ids: ['tab.show1', 'tab.show2', 'tab.show3'],
      keys: [['⌘1'], ['⌘2'], ['⌘3']],
      range: true,
    });
    const here = helpHere(tabs(shown), 'window', NO_TARGET, vim).flatMap((group) => group.rows);
    expect(here.map((row) => row.ids)).toEqual([['tab.show1', 'tab.show2', 'tab.show3']]);
    expect(helpHere(tabs(new Set()), 'window', NO_TARGET, vim)).toEqual([]);
    // The palette lists each by its own label.
    expect(paletteItems(tabs(shown), 'window', NO_TARGET).map((item) => item.label)).toEqual([
      'Tab 2',
    ]);
  });

  it('keeps commands with one label apart where their descriptions say they do different things', () => {
    const apart = new Registry({
      system: 'mac',
      commands: handlers(
        defineCommands('tab', {
          page: {
            label: 'Open',
            description: 'The page.',
            group: 'Tabs',
            keys: ['g x'],
            when: { scope: 'diff' },
          },
          row: {
            label: 'Open',
            description: 'The row.',
            group: 'Tabs',
            keys: ['g x'],
            when: { scope: 'tree' },
          },
        }),
        { page: run, row: run },
      ),
    });
    const rows = helpAll(apart, vim).flatMap((group) => group.rows);
    expect(rows.map((row) => [row.ids, row.description])).toEqual([
      [['tab.page'], 'The page.'],
      [['tab.row'], 'The row.'],
    ]);
  });

  it('narrows to the commands, descriptions, groups, ids or keys typed', () => {
    const groups = helpAll(registry(), vim);
    const ids = (query: string) => idsOf(filterHelp(groups, query));
    expect(ids('')).toHaveLength(7);
    expect(ids('mark')).toEqual(['diff.markViewed']);
    expect(ids('tabs')).toEqual(['diff.escape']);
    expect(ids('⌘o')).toEqual(['diff.open']);
    expect(ids('] f')).toEqual(['diff.nextFile']);
    expect(ids('next file')).toEqual(['diff.nextFile']);
    expect(ids('whole pull request')).toEqual(['diff.merge']);
    expect(ids('nothing like it')).toEqual([]);
  });

  it('reads a label without its backticks', () => {
    expect(plainLabel('Install `lo` command')).toBe('Install lo command');
  });
});

/** The aria-keyshortcuts of a command in the palette, on `system`. */
function shortcutOf(system: 'mac' | 'linux', id: string) {
  return paletteItems(registry(system), 'window', NO_TARGET).find((item) => item.id === id)
    ?.shortcut;
}

describe('the palette', () => {
  it('lists every command that applies where focus was and can run on its target', () => {
    const ids = (scope: string, disabled: readonly string[] = []) =>
      paletteItems(registry('mac', disabled), scope, NO_TARGET).map((item) => item.id);
    // Not Vim's own, not one that needs a file, and in the groups' order.
    expect(ids('window')).toEqual([
      'diff.nextFile',
      'diff.palette',
      'diff.open',
      'diff.merge',
      'diff.escape',
    ]);
    expect(ids('box')).not.toContain('diff.escape');
    expect(ids('window', ['merge'])).not.toContain('diff.merge');
    expect(
      paletteItems(registry(), 'diff', { kind: 'file', file: 'a.ts' }).map((item) => item.id),
    ).toContain('diff.markViewed');
    expect(paletteItems(registry('linux'), 'window', NO_TARGET).map((item) => item.id)).toContain(
      'diff.quit',
    );
  });

  it('lists one of Lo’s motions on a file’s header, as its key goes from one as from a line', () => {
    const steps = new Registry({
      system: 'mac',
      commands: handlers(
        defineCommands('diff', {
          nextThread: {
            label: 'Next thread',
            group: 'Go',
            keys: ['] t'],
            targets: ['line'],
            vim: 'motion',
            when: { scope: 'diff' },
          },
          reply: {
            label: 'Reply',
            group: 'Comments',
            keys: ['r'],
            targets: ['line'],
            when: { scope: 'diff' },
          },
        }),
        { nextThread: run, reply: run },
      ),
    });
    const header: Target = { kind: 'header', file: 'a.ts', side: 'new' };
    // A command that isn't a motion still needs the line it's declared for.
    expect(paletteItems(steps, 'diff', header).map((item) => item.id)).toEqual(['diff.nextThread']);
    expect(idsOf(helpHere(steps, 'diff', header, vim))).toEqual(['diff.nextThread']);
  });

  it('shows each command’s first key in this system’s form', () => {
    const items = paletteItems(registry('linux'), 'window', NO_TARGET);
    expect(items.find((item) => item.id === 'diff.palette')).toEqual({
      id: 'diff.palette',
      label: 'Command palette',
      group: 'Go',
      keys: ['Ctrl+Shift+P'],
      shortcut: 'Control+Shift+P',
    });
  });

  it('says after a label what its handler says of it now, which the query matches too', () => {
    const label = (queued?: number) =>
      paletteItems(registry('mac', [], queued), 'window', NO_TARGET).find(
        (item) => item.id === 'diff.merge',
      )?.label;
    expect(label()).toBe('Merge');
    expect(label(3)).toBe('Merge · 3 queued');
    const items = paletteItems(registry('mac', [], 3), 'window', NO_TARGET);
    expect(filterPalette(items, 'queued').map(({ item }) => item.id)).toEqual(['diff.merge']);
  });

  it('says whether a switch is on, and nothing of a command that isn’t one', () => {
    const switches = defineCommands('code', {
      wrap: { label: 'Wrap lines', group: 'View', keys: [], toggle: 'switch' },
      fold: { label: 'Fold all', group: 'View', keys: [] },
    });
    const checked = (on: boolean) =>
      paletteItems(
        new Registry({
          system: 'mac',
          commands: handlers(switches, { wrap: { run() {}, checked: () => on }, fold: run }),
        }),
        'window',
        NO_TARGET,
      ).map((item) => [item.label, item.checked]);
    expect(checked(true)).toEqual([
      ['Wrap lines', true],
      ['Fold all', undefined],
    ]);
    expect(checked(false)).toEqual([
      ['Wrap lines', false],
      ['Fold all', undefined],
    ]);
  });

  it('names a command by what it would do now, where its handler says', () => {
    const named = new Registry({
      system: 'mac',
      commands: handlers(declared, {
        markViewed: run,
        nextFile: run,
        palette: run,
        open: run,
        quit: run,
        escape: run,
        merge: { run() {}, labelled: () => 'Merge again', detail: () => '3 queued' },
      }),
    });
    const item = paletteItems(named, 'window', NO_TARGET).find(({ id }) => id === 'diff.merge');
    expect(item?.label).toBe('Merge again · 3 queued');
  });

  it('gives each command’s key as aria-keyshortcuts too, for one key or a chord only', () => {
    expect(shortcutOf('mac', 'diff.palette')).toBe('Meta+Shift+P');
    expect(shortcutOf('mac', 'diff.escape')).toBe('Escape');
    // A sequence can't be said in the attribute, whose spaces separate alternatives.
    expect(shortcutOf('mac', 'diff.nextFile')).toBeUndefined();
    expect(shortcutOf('linux', 'diff.open')).toBe('Control+L');
  });

  it('narrows to labels with the letters typed in order, the best first, marking them', () => {
    const items = paletteItems(registry(), 'window', NO_TARGET);
    const found = (query: string) =>
      filterPalette(items, query).map(({ item, marks }) => [item.label, marks.join(',')]);
    expect(found('')).toHaveLength(items.length);
    expect(found('opr')).toEqual([['Open a PR', '0,1,8']]);
    // Starts of words beat letters in the middle of one.
    expect(found('cp')[0]).toEqual(['Command palette', '0,8']);
    // A run of letters beats the same letters spread out.
    expect(found('back')).toEqual([['Back to the middle view', '0,1,2,3']]);
    expect(found('nf')).toEqual([['Next file', '0,5']]);
    // The description, group or id, when the label has none of it.
    expect(found('review')).toEqual([['Merge', '']]);
    expect(found('whole')).toEqual([['Merge', '']]);
    expect(found('zzz')).toEqual([]);
  });

  it('matches and marks a label as it reads, without its backticks, and leaves out its own', () => {
    const own = new Registry({
      system: 'mac',
      commands: handlers(
        defineCommands('keys', {
          install: { label: 'Install `lo` command', group: 'App', keys: ['i'] },
          palette: { label: 'Command palette', group: 'App', keys: ['cmd+shift+p'] },
        }),
        { install: run, palette: run },
      ),
    });
    const items = paletteItems(own, 'window', NO_TARGET);
    expect(items.map((item) => item.id)).toEqual(['keys.install']);
    expect(filterPalette(items, 'lo c')[0]?.marks).toEqual([8, 9, 11]);
  });
});

/** Tabs 1 to 3 by their places, a series, each running only while `on` holds it. */
function tabs(on: ReadonlySet<string>): Registry {
  return new Registry({
    system: 'mac',
    commands: handlers(
      defineCommands('tab', { show1: place(1), show2: place(2), show3: place(3) }),
      {
        show1: runsWhile(on, 'tab.show1'),
        show2: runsWhile(on, 'tab.show2'),
        show3: runsWhile(on, 'tab.show3'),
      },
    ),
  });
}

/** Tab `position`, by its place, one of a series. */
function place(position: number) {
  return {
    label: `Tab ${position}`,
    series: 'Tab 1–3',
    group: 'Tabs' as const,
    keys: [`cmd+${position}`],
  };
}

/** A handler that runs only while `on` holds its command, `id`, and refuses silently otherwise. */
function runsWhile(on: ReadonlySet<string>, id: string) {
  return { run() {}, enabled: () => on.has(id) || '' };
}

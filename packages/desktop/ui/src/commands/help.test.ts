import { describe, expect, it } from 'vitest';

import { commandsOf, defineCommands, handlers } from './declare.ts';
import { filterHelp, filterPalette, helpGroups, paletteItems, whereText } from './help.ts';
import { Registry } from './registry.ts';
import { NO_TARGET } from './targets.ts';

const run = { run() {} };

const declared = defineCommands(
  'diff',
  {
    down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
    markViewed: {
      label: 'Mark viewed',
      group: 'Act',
      keys: ['e'],
      targets: ['file'],
      overVim: true,
      when: { scope: ['diff', 'tree'], mode: 'normal' },
    },
    nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'] },
    palette: { label: 'Command palette', group: 'Find', keys: ['cmd+shift+p'] },
    open: { label: 'Open a PR', group: 'Find', keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }] },
    quit: {
      label: 'Quit Lo',
      group: 'Tabs and window',
      keys: ['cmd+q'],
      when: { system: 'linux' },
    },
    escape: {
      label: 'Back to the middle view',
      group: 'Tabs and window',
      keys: ['esc'],
      when: { except: ['menu', 'box'] },
    },
    merge: {
      label: 'Merge',
      group: 'Review',
      keys: ['m'],
    },
  },
  { scopes: ['tree'] },
);

function registry(system: 'mac' | 'linux' = 'mac', disabled: readonly string[] = []) {
  return new Registry({
    system,
    commands: handlers(declared, {
      markViewed: run,
      nextFile: run,
      palette: run,
      open: run,
      quit: run,
      escape: run,
      merge: { run() {}, enabled: () => (disabled.includes('merge') ? 'Nothing to merge.' : true) },
    }),
  });
}

/** The keys key help shows for `id`, on `system`. */
function keysOf(system: 'mac' | 'linux', id: string) {
  return helpGroups(registry(system))
    .flatMap((group) => group.rows)
    .find((row) => row.id === id)?.keys;
}

describe('key help', () => {
  it('lists the key table’s groups in order, with each command on this system', () => {
    const groups = helpGroups(registry());
    expect(groups.map((group) => group.group)).toEqual([
      'Move',
      'Jump',
      'Act',
      'Review',
      'Find',
      'Tabs and window',
    ]);
    expect(
      groups.find((group) => group.group === 'Tabs and window')?.rows.map((row) => row.id),
    ).toEqual(['diff.escape']);
    expect(
      helpGroups(registry('linux'))
        .find((group) => group.group === 'Tabs and window')
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

  it('follows the keymap file live', () => {
    const live = registry();
    const nextFile = () =>
      helpGroups(live)
        .flatMap((group) => group.rows)
        .find((row) => row.id === 'diff.nextFile')?.keys;
    live.setKeymap('bind g n diff.nextFile');
    expect(nextFile()).toEqual([
      ['g', 'n'],
      [']', 'f'],
    ]);
    live.setKeymap('bind g n diff.nextFile\nunbind ] f');
    expect(nextFile()).toEqual([['g', 'n']]);
    live.setKeymap('');
    expect(nextFile()).toEqual([[']', 'f']]);
  });

  it('marks Vim’s own keys and those that replace Vim’s, and says where each applies', () => {
    const rows = helpGroups(registry()).flatMap((group) => group.rows);
    const row = (id: string) => rows.find((each) => each.id === id);
    expect(row('diff.down')).toMatchObject({ vim: true, overVim: false, where: undefined });
    expect(row('diff.markViewed')).toMatchObject({
      vim: false,
      overVim: true,
      where: "In the diff and tree, in Vim's normal mode",
    });
    expect(row('diff.escape')?.where).toBe('Not in menus or comment boxes');
    const [both] = commandsOf(
      defineCommands('diff', {
        x: { label: 'X', group: 'Act', keys: ['x'], when: { scope: 'window', except: ['box'] } },
      }),
    );
    expect(whereText(both!)).toBe('In the window, not in comment boxes');
  });

  it('narrows to the actions, groups, ids or keys typed', () => {
    const groups = helpGroups(registry());
    const ids = (query: string) =>
      filterHelp(groups, query).flatMap((group) => group.rows.map((row) => row.id));
    expect(ids('')).toHaveLength(7);
    expect(ids('mark')).toEqual(['diff.markViewed']);
    expect(ids('find')).toEqual(['diff.palette', 'diff.open']);
    expect(ids('⌘o')).toEqual(['diff.open']);
    expect(ids('] f')).toEqual(['diff.nextFile']);
    expect(ids('next file')).toEqual(['diff.nextFile']);
    expect(ids('nothing like it')).toEqual([]);
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
    // Not Vim's own, not one that needs a file, and in the key table's order.
    expect(ids('window')).toEqual([
      'diff.nextFile',
      'diff.merge',
      'diff.palette',
      'diff.open',
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

  it('shows each command’s first key in this system’s form', () => {
    const items = paletteItems(registry('linux'), 'window', NO_TARGET);
    expect(items.find((item) => item.id === 'diff.palette')).toEqual({
      id: 'diff.palette',
      label: 'Command palette',
      group: 'Find',
      keys: ['Ctrl+Shift+P'],
      shortcut: 'Control+Shift+P',
    });
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
    // The group or the id, when the label has none of it.
    expect(found('review')).toEqual([['Merge', '']]);
    expect(found('zzz')).toEqual([]);
  });
});

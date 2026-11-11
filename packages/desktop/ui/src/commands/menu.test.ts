import { describe, expect, it } from 'vitest';

import { defineCommands, handlers } from './declare.ts';
import { menuSections } from './menu.ts';
import { Registry } from './registry.ts';
import type { Target } from './targets.ts';

const run = { run() {} };

const file: Target = { kind: 'file', file: 'plugins/rate-limit.ts' };
const line: Target = { kind: 'line', at: { file: 'rate-limit.ts', side: 'new', line: 41 } };

const declared = defineCommands('diff', {
  // Out of order on purpose: a menu follows `order`, not the order commands are declared in.
  copyPath: {
    label: 'Copy the path',
    group: 'Copy and open',
    keys: ['y p'],
    targets: ['file'],
    menu: { on: 'file', order: 60 },
  },
  show: {
    label: 'Show in the diff',
    group: 'Files',
    keys: ['enter'],
    targets: ['file'],
    menu: { on: 'file', order: 10 },
  },
  markViewed: {
    label: 'Mark viewed',
    group: 'Files',
    keys: ['e'],
    targets: ['file'],
    menu: { on: 'file', order: 20 },
  },
  comment: {
    label: 'Comment on the file',
    group: 'Act',
    keys: ['c'],
    targets: ['file'],
    menu: { on: 'file', order: 30 },
  },
  openGithub: {
    label: 'Open on GitHub',
    group: 'Copy and open',
    keys: ['g x'],
    targets: ['file'],
    menu: { on: 'file', order: 70 },
  },
  // A line's, not a file's, and one with a second key.
  suggest: {
    label: 'Suggest a change',
    group: 'Act',
    keys: ['s', 'cmd+shift+s'],
    targets: ['line'],
    menu: { on: 'line', order: 10 },
  },
  // For one system.
  quit: {
    label: 'Quit Lo',
    group: 'Tabs and window',
    keys: ['cmd+q'],
    when: { system: 'linux' },
    menu: { on: 'file', order: 80 },
  },
  open: {
    label: 'Open a PR',
    group: 'Find',
    keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }],
    menu: { on: 'file', order: 40 },
  },
  // Has keys, but isn't in a menu.
  next: { label: 'Next file', group: 'Jump', keys: ['] f'], targets: ['file'] },
  // Vim's own, which nothing runs.
  down: {
    label: 'Line down',
    group: 'Move',
    keys: ['j'],
    vim: 'own',
    menu: { on: 'file', order: 1 },
  },
});

function registry(
  system: 'mac' | 'linux' = 'mac',
  enabled: Readonly<Record<string, true | string>> = {},
): Registry {
  const gate = (id: string) => ({ run() {}, enabled: () => enabled[id] ?? true });
  return new Registry({
    system,
    commands: handlers(declared, {
      copyPath: run,
      show: gate('show'),
      markViewed: gate('markViewed'),
      comment: run,
      openGithub: run,
      suggest: run,
      quit: run,
      open: run,
      next: run,
    }),
  });
}

/** The labels of a menu's items, a separator between sections. */
function labels(target: Target, ...rest: Parameters<typeof registry>): string[] {
  return menuSections(registry(...rest), target).flatMap((section, index) => [
    ...(index > 0 ? ['—'] : []),
    ...section.map((item) => item.label),
  ]);
}

/** The keys of each item in the menu of `target`, by label. */
function keysOf(system: 'mac' | 'linux', target: Target = file) {
  return Object.fromEntries(
    menuSections(registry(system), target)
      .flat()
      .map((item) => [item.label, item.keys]),
  );
}

describe('a right-click menu', () => {
  it('lists the commands that declare a menu on the kind of target clicked', () => {
    expect(labels(file)).toContain('Show in the diff');
    expect(labels(file)).not.toContain('Suggest a change');
    expect(labels(line)).toEqual(['Suggest a change']);
    // Nothing declares a menu on a thread, so there's no menu to open.
    expect(menuSections(registry(), { kind: 'thread', thread: 't1' })).toEqual([]);
    // A command with keys but no menu isn't in one, nor are Vim's own keys.
    expect(labels(file)).not.toContain('Next file');
    expect(labels(file)).not.toContain('Line down');
  });

  it('follows each command’s order, whatever order they were declared in', () => {
    expect(labels(file).filter((label) => label !== '—')).toEqual([
      'Show in the diff',
      'Mark viewed',
      'Comment on the file',
      'Open a PR',
      'Copy the path',
      'Open on GitHub',
    ]);
  });

  it('puts a separator wherever the key table’s group changes', () => {
    expect(labels(file)).toEqual([
      'Show in the diff',
      'Mark viewed',
      '—',
      'Comment on the file',
      '—',
      'Open a PR',
      '—',
      'Copy the path',
      'Open on GitHub',
    ]);
  });

  it('lists the commands for the system it is on only', () => {
    expect(labels(file, 'mac')).not.toContain('Quit Lo');
    expect(labels(file, 'linux')).toContain('Quit Lo');
    expect(labels(file, 'linux').at(-1)).toBe('Quit Lo');
  });

  it('shows each item’s first key as its system shows it', () => {
    expect(keysOf('mac')).toMatchObject({
      'Show in the diff': ['⏎'],
      'Mark viewed': ['e'],
      'Copy the path': ['y', 'p'],
      'Open on GitHub': ['g', 'x'],
      'Open a PR': ['⌘L'],
    });
    expect(keysOf('linux')).toMatchObject({
      'Show in the diff': ['Enter'],
      'Copy the path': ['y', 'p'],
      'Open a PR': ['Ctrl+L'],
      'Quit Lo': ['Ctrl+Q'],
    });
    // The first of two keys; the other is in key help.
    expect(keysOf('mac', line)['Suggest a change']).toEqual(['s']);
  });

  it('shows the keys as they are now, a remap included', () => {
    const live = registry();
    live.setKeymap('bind cmd+shift+e diff.markViewed\nunbind e diff.markViewed');
    const viewed = menuSections(live, file)
      .flat()
      .find((item) => item.id === 'diff.markViewed');
    expect(viewed?.keys).toEqual(['⌘⇧E']);
    live.setKeymap('unbind e diff.markViewed');
    const none = menuSections(live, file)
      .flat()
      .find((item) => item.id === 'diff.markViewed');
    expect(none?.keys).toBeUndefined();
  });

  it('enables what can run on the target', () => {
    const items = menuSections(registry(), file).flat();
    expect(items.every((item) => item.disabled === undefined)).toBe(true);
  });

  it('greys what can’t run on the target, with the command’s reason, and keeps its place', () => {
    const items = menuSections(
      registry('mac', { markViewed: 'The file is outside the PR.', show: 'Nothing to show.' }),
      file,
    ).flat();
    const byId = Object.fromEntries(items.map((item) => [item.id, item.disabled]));
    expect(byId).toMatchObject({
      'diff.show': 'Nothing to show.',
      'diff.markViewed': 'The file is outside the PR.',
      'diff.comment': undefined,
    });
    expect(items.map((item) => item.id).slice(0, 3)).toEqual([
      'diff.show',
      'diff.markViewed',
      'diff.comment',
    ]);
    // A greyed item still shows its key.
    expect(items.find((item) => item.id === 'diff.show')?.keys).toEqual(['⏎']);
  });

  it('asks each handler about the target clicked', () => {
    const asked: Target[] = [];
    const checked = new Registry({
      system: 'mac',
      commands: handlers(declared, {
        copyPath: run,
        show: {
          run() {},
          enabled(target) {
            asked.push(target);
            return true;
          },
        },
        markViewed: run,
        comment: run,
        openGithub: run,
        suggest: run,
        quit: run,
        open: run,
        next: run,
      }),
    });
    menuSections(checked, file);
    expect(asked).toEqual([file]);
  });
});

// The keys an editor handles itself (`editor`), such as the comment box's: declared, so key help
// and the docs list them and the clash and Vim checks cover them, but never run, offered or
// changed by the registry.

import { describe, expect, test } from 'vitest';

import { checkClashes, checkHandlers, checkKeys, checkVim } from './checks.ts';
import {
  commandsOf,
  defineCommands,
  handlers,
  isOwned,
  type Command,
  type Declaration,
  type Declarations,
} from './declare.ts';
import { helpGroups, paletteItems, whereText } from './help.ts';
import { applyKeymap, parseKeymap } from './keymap.ts';
import { declaredBindings } from './match.ts';
import { menuSections } from './menu.ts';
import { keyLabels, parseKeys, systemStrokes, writeStrokes } from './notation.ts';
import { Registry, type KeyPlace } from './registry.ts';
import { NO_TARGET } from './targets.ts';

const inBox = { scope: 'box' } as const;

/** The box's own keys, as the comments feature declares them. */
const box = defineCommands('comments', {
  add: {
    label: 'Add to review',
    group: 'Comment box',
    keys: ['cmd+enter'],
    editor: true,
    when: inBox,
  },
  attach: {
    label: 'Attach files',
    group: 'Comment box',
    keys: ['cmd+shift+a'],
    editor: true,
    when: inBox,
  },
  leave: {
    label: 'Leave insert mode',
    group: 'Comment box',
    keys: ['esc'],
    vim: 'own',
    when: { scope: 'box', mode: 'insert' },
  },
  close: {
    label: 'Close the box and keep the draft',
    group: 'Comment box',
    keys: ['esc'],
    editor: true,
    when: { scope: 'box', mode: 'normal' },
  },
});

/** Commands that leave the box's keys alone. */
const elsewhere = defineCommands('review', {
  submit: {
    label: 'Submit review',
    group: 'Review',
    keys: ['cmd+enter'],
    when: { except: ['box'] },
  },
  more: {
    label: 'Tabs that don’t fit',
    group: 'Tabs and window',
    keys: ['cmd+shift+a'],
    when: { except: ['box'] },
  },
});

/** One feature declaring `commands`. */
const feature = (commands: Record<string, Declaration>, name = 'diff') =>
  defineCommands(name, commands);

/** A command whose declaration is `declaration`, as a call that declares it. */
const declare = (declaration: Declaration) => () => feature({ add: declaration });

describe('a key the editor handles itself', () => {
  test('is declared with the scope of its editor, and nothing that would run it', () => {
    const base = { label: 'Add', group: 'Comment box', keys: ['cmd+enter'], editor: true } as const;
    expect(declare({ ...base, when: inBox })).not.toThrow();
    expect(declare(base)).toThrow('names no scope for the editor');
    expect(declare({ ...base, when: { except: ['box'] } })).toThrow('names no scope');
    expect(declare({ ...base, when: inBox, vim: 'motion' })).toThrow('has no vim');
    expect(declare({ ...base, when: inBox, menu: { on: 'box', order: 1 } })).toThrow('has no menu');
    expect(declare({ ...base, when: inBox, repeat: true })).toThrow('has no repeat');
  });

  test('is one the registry never runs, like Vim’s own, and has no handler', () => {
    const [add, , leave] = commandsOf(box);
    expect(isOwned(add!)).toBe(true);
    expect(isOwned(leave!)).toBe(true);
    expect(isOwned({})).toBe(false);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the types refuse it, as they should.
    expect(() => handlers(box, { add: { run() {} } } as never)).toThrow(
      "is handled by its scope's editor, which nothing here runs, so it has no handler",
    );
    const given = handlers(box, {});
    expect(checkHandlers([box], given)).toEqual([]);
    const withHandler: Command[] = given.map((command) =>
      command.name === 'add' ? { ...command, handler: { run() {} } } : command,
    );
    expect(checkHandlers([box], withHandler)).toEqual([
      "comments.add is its scope's editor's own key, which nothing runs, but has a handler.",
    ]);
  });

  test('has its default keys checked like any other’s', () => {
    expect(checkKeys([box])).toEqual([]);
    const none = feature({
      none: { label: 'None', group: 'Act', keys: [], editor: true, when: inBox },
    });
    expect(checkKeys([none])).toEqual([
      'diff.none has no key on macOS.',
      'diff.none has no key on Linux.',
    ]);
  });
});

describe('the clash check', () => {
  test('covers it: a command for anywhere on its keys, where the box is, takes them from the editor', () => {
    const anywhere = feature(
      { submit: { label: 'Submit review', group: 'Review', keys: ['cmd+enter'] } },
      'review',
    );
    expect(checkClashes([box, anywhere])).toEqual([
      '`cmd+enter` runs both comments.add and review.submit, in box (normal), box (visual) and box (insert), on macOS.',
      '`ctrl+enter` runs both comments.add and review.submit, in box (normal), box (visual) and box (insert), on Linux.',
    ]);
  });

  test('passes a command for anywhere that leaves the box out, and one for other scopes', () => {
    expect(checkClashes([box, elsewhere])).toEqual([]);
    const diff = feature({
      more: { label: 'More', group: 'Act', keys: ['cmd+shift+a'], when: { scope: 'diff' } },
    });
    expect(checkClashes([box, diff])).toEqual([]);
  });

  test('covers a command of the box’s own scope on the same keys, and one starting with them', () => {
    const same = feature({
      more: { label: 'More', group: 'Act', keys: ['cmd+shift+a'], when: inBox },
      go: { label: 'Go', group: 'Act', keys: ['cmd+enter x'], when: inBox },
    });
    expect(checkClashes([box, same]).filter((line) => line.includes('on macOS'))).toEqual([
      '`cmd+enter` (comments.add) starts `cmd+enter x` (diff.go), in box (normal), box (visual) and box (insert), on macOS.',
      '`cmd+shift+a` runs both comments.attach and diff.more, in box (normal), box (visual) and box (insert), on macOS.',
    ]);
  });
});

describe('the Vim check', () => {
  test('covers it, as declared: its keys take none of Vim’s, and can’t say they do', () => {
    expect(checkVim([box])).toEqual([]);
    const takes = feature({
      move: { label: 'Move', group: 'Comment box', keys: ['x'], editor: true, when: inBox },
    });
    expect(checkVim([takes])).toEqual([
      "`x` (diff.move) meets Vim's `x` without overVim, in box (normal) and box (visual), on macOS and Linux.",
    ]);
  });
});

/** The box's editor in `mode`, as the registry sees where a key is pressed. */
const view = (mode: 'normal' | 'insert' | 'visual'): KeyPlace => ({
  scope: {
    name: 'box',
    element: undefined,
    source: {
      keyState: () => ({ mode, pending: false, target: NO_TARGET }),
      passKeys() {},
      clearPending() {},
      setVimKeys() {},
    },
  },
  text: undefined,
});

/** The keymap file `text` applied over the default keys of `declared`, on macOS. */
const apply = (text: string, declared: readonly Declarations[] = [box, elsewhere]) => {
  const all = declared.flatMap(commandsOf);
  const byId = new Map(all.map((command) => [command.id, command]));
  return applyKeymap(
    declaredBindings(all, 'mac'),
    parseKeymap(text, (id) => byId.has(id)).lines,
    byId,
    'mac',
  );
};

/** The keys left once `text` is applied to the default ones, each with its command. */
const keysOf = (text: string) =>
  apply(text).bindings.map(
    (binding) => `${binding.command.id} ${writeStrokes(binding.strokes, 'mac')}`,
  );

/** What the keymap file says of a line that names one of the editor's commands. */
const message = (id: string) =>
  `${id} is handled by the editor in \`box\`, so the keymap file can't change its keys.`;

/** What it says of a command that would take `keys`, which start with one of the editor's keys. */
const taking = (keys: string) =>
  `${keys} would take ${keys.split(' ')[0]} (comments.add) from the editor that handles it itself.`;

describe('the registry', () => {
  const given = handlers(box, {});
  const registry = new Registry({ system: 'mac', commands: given });
  const press = (keys: string, mode: 'normal' | 'insert' | 'visual', repeat = false) =>
    registry.handle(
      { strokes: systemStrokes(parseKeys(keys), 'mac'), repeat, composing: false },
      view(mode),
    ).kind;

  test('never runs, holds or swallows its keys, in any mode, held or not', () => {
    for (const mode of ['normal', 'insert', 'visual'] as const) {
      for (const keys of ['cmd+enter', 'cmd+shift+a']) {
        expect(press(keys, mode)).toBe('pass');
        expect(press(keys, mode, true)).toBe('pass');
      }
    }
    expect(press('esc', 'normal')).toBe('pass');
    expect(press('esc', 'insert')).toBe('pass');
    expect(registry.isPending()).toBe(false);
  });

  test('still has its keys, for key help, marked as fixed', () => {
    const [add] = registry.keysOf('comments.add');
    expect(keyLabels(add!, 'mac')).toEqual(['⌘⏎']);
    const row = helpGroups(registry)
      .flatMap((group) => group.rows)
      .find((each) => each.id === 'comments.close');
    expect(row).toMatchObject({ editor: true, vim: false, keys: [['Esc']] });
    expect(row?.where).toBe("In comment boxes, in Vim's normal mode");
  });

  test('refuses to run one, saying whose it is', () => {
    expect(registry.run('comments.add', NO_TARGET)).toBe("Add to review is its editor's own key.");
    expect(registry.run('comments.leave', NO_TARGET)).toBe("Leave insert mode is Vim's.");
  });

  test('doesn’t offer it in the palette or a menu', () => {
    expect(paletteItems(registry, 'box', NO_TARGET)).toEqual([]);
    expect(menuSections(registry, { kind: 'box', box: 'b' })).toEqual([]);
    expect(whereText(given[0]!)).toBe('In comment boxes');
  });
});

describe('the keymap file', () => {
  test('can’t bind keys to it', () => {
    expect(apply('bind x comments.add').errors).toEqual([
      { line: 1, message: message('comments.add') },
    ]);
    expect(keysOf('bind x comments.add')).toContain('comments.add cmd+enter');
    expect(keysOf('bind x comments.add')).not.toContain('comments.add x');
  });

  test('can’t bind a command that would take its keys where the box is', () => {
    const anywhere = feature({ every: { label: 'Every', group: 'Act', keys: ['y'] } }, 'view');
    expect(apply('bind cmd+enter view.every', [box, anywhere]).errors).toEqual([
      { line: 1, message: taking('cmd+enter') },
    ]);
    // Keys that start with its keys would hold them, so they're refused too.
    expect(apply('bind cmd+enter x view.every', [box, anywhere]).errors).toEqual([
      { line: 1, message: taking('cmd+enter x') },
    ]);
    // A command for another scope may have them there.
    const diff = feature({
      go: { label: 'Go', group: 'Act', keys: ['y'], when: { scope: 'diff' } },
    });
    expect(apply('bind cmd+enter diff.go', [box, diff]).errors).toEqual([]);
  });

  test('can’t unbind it by name', () => {
    expect(apply('unbind cmd+enter comments.add').errors).toEqual([
      { line: 1, message: message('comments.add') },
    ]);
  });

  test('leaves it alone when its keys go from every command, and says so if nothing else goes', () => {
    const alone = apply('unbind cmd+enter');
    expect(alone.errors).toEqual([]);
    expect(keysOf('unbind cmd+enter')).toEqual([
      'comments.add cmd+enter',
      'comments.attach cmd+shift+a',
      'comments.leave esc',
      'comments.close esc',
      'review.more cmd+shift+a',
    ]);
    expect(apply('unbind cmd+enter', [box]).errors).toEqual([
      { line: 1, message: message('comments.add') },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { testCommands, type Ran } from '../../test/commands.ts';
import type { Command } from './declare.ts';
import type { Entry } from './history.ts';
import { keyLabels, parseKeys, systemStrokes, type System } from './notation.ts';
import { Registry, type KeyPlace } from './registry.ts';
import type { FoundScope, KeySource, Mode, ScopeSource, TargetSource, VimKey } from './scopes.ts';
import type { LineTarget, Target } from './targets.ts';

const place = (line: number, side: 'old' | 'new' = 'new'): LineTarget => ({
  kind: 'line',
  at: { file: 'a.ts', side, line },
});

/** A code view as the registry sees it: Vim's state, and the keys handed to it. */
class FakeView implements KeySource {
  mode: Mode = 'normal';
  pending = false;
  target: Target = place(1);
  readonly passed: string[][] = [];
  vimKeys: readonly VimKey[] = [];
  keyState() {
    return { mode: this.mode, pending: this.pending, target: this.target };
  }
  passKeys(keys: readonly string[]) {
    this.passed.push([...keys]);
    // Vim now waits for the rest of the command.
    this.pending = true;
  }
  setVimKeys(keys: readonly VimKey[]) {
    this.vimKeys = keys;
  }
}

function scope(name: string, source?: ScopeSource): KeyPlace {
  const found: FoundScope = { name, element: undefined, source };
  return { scope: found, text: false };
}

function setup(
  options: { system?: System; here?: () => Entry | undefined; commands?: Command[] } = {},
) {
  const ran: Ran[] = [];
  const errors: [unknown, string][] = [];
  let time = 0;
  const registry = new Registry({
    system: options.system ?? 'mac',
    commands: options.commands ?? testCommands(ran),
    ...(options.here ? { here: options.here } : {}),
    now: () => time,
    onError: (error, command) => errors.push([error, command.id]),
  });
  /** Presses each key, written in Lo's notation, at `where`, 10 ms apart. */
  const press = (keys: readonly string[], where: KeyPlace, repeat = false) =>
    keys.map((text) => {
      time += 10;
      const [stroke] = systemStrokes(parseKeys(text), registry.system);
      return registry.handle({ stroke: stroke!, repeat, composing: false }, where).kind;
    });
  return { registry, ran, errors, press };
}

describe('running a command', () => {
  test('its handler gets the target as a kind it takes', () => {
    const { registry, ran } = setup();
    expect(registry.run('diff.markViewed', place(3))).toBe(true);
    expect(registry.run('diff.markViewed', { kind: 'file', file: 'b.ts' })).toBe(true);
    // A line gives its thread, and anything does for a command that takes nothing.
    expect(registry.run('diff.reply', { ...place(4), thread: 't1' })).toBe(true);
    expect(registry.run('keys.help', place(5))).toBe(true);
    expect(ran).toEqual([
      ['diff.markViewed', place(3)],
      ['diff.markViewed', { kind: 'file', file: 'b.ts' }],
      ['diff.reply', { kind: 'thread', thread: 't1' }],
      ['keys.help', { kind: 'none' }],
    ]);
  });

  test('says why it didn’t run', () => {
    const { registry, ran } = setup();
    expect(registry.run('diff.reply', place(4))).toBe("Reply doesn't apply here.");
    expect(registry.run('diff.comment', { kind: 'none' })).toBe("Comment doesn't apply here.");
    expect(registry.run('vim.down', place(1))).toBe("Line down is Vim's.");
    expect(registry.run('diff.nope', place(1))).toBe("There's no command called diff.nope.");
    expect(ran).toEqual([]);
  });

  test('asks its handler whether it can run, and doesn’t run when it can’t', () => {
    const ran: string[] = [];
    const [base] = testCommands();
    const merged: Command = {
      ...base!,
      handler: {
        run: () => {
          ran.push('ran');
        },
        enabled: (target) => (target.kind === 'file' ? 'Already viewed.' : true),
      },
    };
    const { registry } = setup({ commands: [merged] });
    expect(registry.enabled(merged.id, { kind: 'file', file: 'a.ts' })).toBe('Already viewed.');
    expect(registry.run(merged.id, { kind: 'file', file: 'a.ts' })).toBe('Already viewed.');
    expect(registry.enabled(merged.id, place(1))).toBe(true);
    expect(ran).toEqual([]);
  });

  test('reports a handler that throws or rejects, and never throws itself', async () => {
    const commands = testCommands().map((command): Command =>
      command.id === 'keys.help'
        ? { ...command, handler: { run: () => Promise.reject(new Error('rejected')) } }
        : command.id === 'keys.palette'
          ? {
              ...command,
              handler: {
                run: () => {
                  throw new Error('threw');
                },
              },
            }
          : command,
    );
    const { registry, errors } = setup({ commands });
    expect(registry.run('keys.palette', { kind: 'none' })).toBe(true);
    expect(registry.run('keys.help', { kind: 'none' })).toBe(true);
    await Promise.resolve();
    expect(
      errors.map(([error, id]) => [error instanceof Error ? error.message : error, id]),
    ).toEqual([
      ['threw', 'keys.palette'],
      ['rejected', 'keys.help'],
    ]);
  });

  test('a jump records where the tab is first, so ⌃o comes back', () => {
    let here: Entry = { view: 'diff', at: place(10, 'old') };
    const { registry, ran } = setup({ here: () => here });
    const shown: Target[] = [];
    registry.history.register('', 'diff', (at) => shown.push(at) > 0);
    expect(registry.run('diff.otherSide', place(10, 'old'))).toBe(true);
    expect(ran).toEqual([['diff.otherSide', place(10, 'old')]]);
    here = { view: 'diff', at: place(12, 'new') };
    expect(registry.history.back(here)).toEqual({ view: 'diff', at: place(10, 'old') });
    expect(shown).toEqual([place(10, 'old')]);
  });

  test('refuses two commands with one id', () => {
    const [first] = testCommands();
    expect(() => new Registry({ system: 'mac', commands: [first!, first!] })).toThrow(
      'Two commands are called diff.markViewed.',
    );
  });
});

describe('keys', () => {
  test('a key runs its command on the focused scope’s target', () => {
    const { ran, press } = setup();
    const view = new FakeView();
    view.target = { ...place(7), thread: 't2' };
    expect(press(['e', 'r'], scope('diff', view))).toEqual(['stop', 'stop']);
    expect(ran).toEqual([
      ['diff.markViewed', { ...place(7), thread: 't2' }],
      ['diff.reply', { kind: 'thread', thread: 't2' }],
    ]);
  });

  test('a key stays Lo’s when its scope can’t say what it acts on', () => {
    const { ran, errors, press } = setup();
    const broken: TargetSource = {
      target() {
        throw new Error('gone');
      },
    };
    expect(press(['e'], scope('tree', broken))).toEqual(['stop']);
    expect(ran).toEqual([]);
    expect(errors.map(([, id]) => id)).toEqual(['diff.markViewed']);
  });

  test('a held key goes back to the code view when the next doesn’t complete a sequence', () => {
    const { ran, press } = setup();
    const view = new FakeView();
    expect(press(['y', 'w'], scope('diff', view))).toEqual(['stop', 'pass']);
    expect(view.passed).toEqual([['y']]);
    expect(ran).toEqual([]);
  });

  describe('after the timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test('the held key goes to the code view, as Vim’s timeoutlen does', () => {
      const { registry, press } = setup();
      const view = new FakeView();
      press(['y'], scope('diff', view));
      vi.advanceTimersByTime(999);
      expect(view.passed).toEqual([]);
      expect(registry.isPending()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(view.passed).toEqual([['y']]);
      expect(registry.isPending()).toBe(false);
    });

    test('a key held anywhere else is dropped', () => {
      const { registry, ran, press } = setup();
      press(['z'], scope('tree'));
      vi.advanceTimersByTime(1000);
      expect(registry.isPending()).toBe(false);
      expect(press(['R'], scope('tree'))).toEqual(['pass']);
      expect(ran).toEqual([]);
    });
  });

  test('a tab switch drops the held key and switches history', () => {
    const { registry, ran, press } = setup();
    const view = new FakeView();
    registry.history.record({ view: 'diff', at: place(1) });
    press(['y'], scope('diff', view));
    registry.tab('two');
    expect(registry.isPending()).toBe(false);
    expect(registry.history.entries()).toEqual([]);
    expect(press(['l'], scope('diff', view))).toEqual(['pass']);
    expect(view.passed).toEqual([]);
    expect(ran).toEqual([]);
  });
});

describe('the keymap file', () => {
  test('binds and unbinds keys over the defaults, live', () => {
    const { registry, ran, press } = setup();
    let changes = 0;
    registry.subscribe(() => changes++);
    const errors = registry.setKeymap('# x instead of e\nbind x diff.markViewed\nunbind e\n');
    expect(errors).toEqual([]);
    expect(changes).toBe(1);
    const view = new FakeView();
    expect(press(['e'], scope('diff', view))).toEqual(['pass']);
    expect(press(['x'], scope('diff', view))).toEqual(['stop']);
    expect(ran.map(([id]) => id)).toEqual(['diff.markViewed']);
    expect(registry.keysOf('diff.markViewed').map((keys) => keyLabels(keys, 'mac'))).toEqual([
      ['x'],
    ]);
  });

  test('a later line beats an earlier one, and unbinding one command leaves the others', () => {
    const { registry, ran, press } = setup();
    registry.setKeymap(
      ['bind ? keys.palette', 'bind ? keys.tree', 'unbind ? keys.help'].join('\n'),
    );
    press(['?'], scope('window'));
    expect(ran.map(([id]) => id)).toEqual(['keys.tree']);
    expect(registry.keysOf('keys.help')).toEqual([]);
    expect(registry.keysOf('keys.palette').map((keys) => keyLabels(keys, 'mac'))).toEqual([
      ['?'],
      ['⌘⇧P'],
    ]);
  });

  test('applies the lines it can read and reports the others by line', () => {
    const { registry, ran, press } = setup({ system: 'linux' });
    const errors = registry.setKeymap('bind cmd+k keys.palette\nbind x diff.nope\nunbind\n');
    expect(errors).toEqual([
      { line: 2, message: "There's no command called diff.nope." },
      { line: 3, message: 'unbind takes keys, and a command if only its keys go: unbind e.' },
    ]);
    expect(registry.keymapErrors()).toBe(errors);
    press(['ctrl+k'], scope('window'));
    expect(ran.map(([id]) => id)).toEqual(['keys.palette']);
    // A new file replaces the last one.
    expect(registry.setKeymap('')).toEqual([]);
    expect(press(['ctrl+k'], scope('window'))).toEqual(['pass']);
  });

  test('hands code views Lo’s motions under their current keys, and the vim lines', () => {
    const { registry } = setup();
    expect(registry.vimKeys()).toEqual([{ kind: 'motion', command: 'diff.nextFile', keys: ']f' }]);
    registry.setKeymap('bind g n diff.nextFile\nvim normal Y y$\nvim visual <C-c> "+y');
    expect(registry.vimKeys()).toEqual([
      { kind: 'motion', command: 'diff.nextFile', keys: 'gn' },
      { kind: 'motion', command: 'diff.nextFile', keys: ']f' },
      { kind: 'map', mode: 'normal', keys: 'Y', to: 'y$' },
      { kind: 'map', mode: 'visual', keys: '<C-c>', to: '"+y' },
    ]);
  });

  test('drops a held key, whose sequence may be gone', () => {
    const { registry, press } = setup();
    press(['y'], scope('diff', new FakeView()));
    registry.setKeymap('unbind y l');
    expect(registry.isPending()).toBe(false);
  });
});

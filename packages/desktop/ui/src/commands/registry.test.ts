import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FakeView, testCommands, type Ran } from '../../test/commands.ts';
import { commandsOf, defineCommands, type Command } from './declare.ts';
import type { Entry } from './history.ts';
import { keyLabels, parseKeys, systemStrokes, type System } from './notation.ts';
import { Registry, type KeyPlace } from './registry.ts';
import type { FoundScope, ScopeSource, TargetSource, TextKind } from './scopes.ts';
import type { LineTarget, Target } from './targets.ts';

const place = (line: number, side: 'old' | 'new' = 'new'): LineTarget => ({
  kind: 'line',
  at: { file: 'a.ts', side, line },
});

function scope(name: string, source?: ScopeSource, text?: TextKind): KeyPlace {
  const found: FoundScope = { name, element: undefined, source };
  return { scope: found, text };
}

function setup(
  options: { system?: System; here?: () => Entry | undefined; commands?: Command[] } = {},
) {
  const ran: Ran[] = [];
  const errors: [unknown, string][] = [];
  const refused: [string, string][] = [];
  let time = 0;
  const registry = new Registry({
    system: options.system ?? 'mac',
    commands: options.commands ?? testCommands(ran),
    ...(options.here ? { here: options.here } : {}),
    now: () => time,
    onError: (error, command) => errors.push([error, command?.id ?? 'view']),
    onRefused: (reason, id) => refused.push([reason, id]),
  });
  /** Presses each key, written in Lo's notation, at `where`, 10 ms apart. */
  const press = (keys: readonly string[], where: KeyPlace, repeat = false) =>
    keys.map((text) => {
      time += 10;
      const strokes = systemStrokes(parseKeys(text), registry.system);
      return registry.handle({ strokes, repeat, composing: false }, where).kind;
    });
  /** Presses one key read as each of `strokes`, as `eventStrokes` reads a layout's keys. */
  const pressRead = (strokes: readonly string[], where: KeyPlace) => {
    time += 10;
    const read = strokes.map((text) => systemStrokes(parseKeys(text), registry.system)[0]!);
    return registry.handle({ strokes: read, repeat: false, composing: false }, where).kind;
  };
  return { registry, ran, errors, refused, press, pressRead };
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

  test('tells onRefused why a command asked for didn’t run, by key or any other way', () => {
    const [base] = testCommands();
    const never: Command = {
      ...base!,
      handler: { run() {}, enabled: () => 'Already viewed.' },
    };
    const { registry, refused, press } = setup({ commands: [never] });
    registry.run(never.id, place(1));
    expect(refused).toEqual([['Already viewed.', never.id]]);
    // Asking whether it can run isn't asking it to.
    registry.enabled(never.id, place(1));
    expect(refused).toHaveLength(1);
    // A key on a focused scope that gives it a target says so too.
    press(['e'], scope('diff', new FakeView()));
    expect(refused.at(-1)).toEqual(['Already viewed.', never.id]);
    expect(refused).toHaveLength(2);
  });

  test('says nothing to onRefused when a command runs', () => {
    const { registry, refused } = setup();
    expect(registry.run('keys.help', { kind: 'none' })).toBe(true);
    expect(refused).toEqual([]);
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
    expect(view.log).toEqual(['passKeys y']);
    expect(ran).toEqual([]);
  });

  test('a chord Lo runs drops a held key, so Vim isn’t left mid-command', () => {
    const { ran, press } = setup();
    const view = new FakeView();
    expect(press(['g', 'cmd+shift+p'], scope('diff', view))).toEqual(['stop', 'stop']);
    expect(press(['y', 'cmd+enter'], scope('diff', view))).toEqual(['stop', 'stop']);
    expect(view.log).toEqual([]);
    expect(ran.map(([id]) => id)).toEqual(['keys.palette', 'review.submit']);
    // A chord Lo doesn't take goes to Vim after the held key, as any other key does.
    expect(press(['y', 'ctrl+x'], scope('diff', view))).toEqual(['stop', 'pass']);
    expect(view.log).toEqual(['passKeys y']);
  });

  test('typing in a field inside a code view, such as Vim’s prompt, runs none of Lo’s keys', () => {
    const { ran, press } = setup({ system: 'linux' });
    const view = new FakeView();
    const prompt = scope('diff', view, 'field');
    expect(press(['e', 'y', 'l', 'enter', 'esc', 'tab'], prompt)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    // Ctrl+W deletes a word there, as in a box.
    expect(press(['cmd+w'], prompt)).toEqual(['pass']);
    expect(press(['cmd+shift+p'], prompt)).toEqual(['stop']);
    expect(ran.map(([id]) => id)).toEqual(['keys.palette']);
    expect(view.log).toEqual([]);
  });

  test('a key read more than one way runs the first reading Lo has a use for', () => {
    const { registry, ran, pressRead } = setup();
    const overview = scope('overview');
    // German types `]` with ⌥6, so `] b` works there.
    expect(pressRead([']', 'alt+6'], overview)).toBe('stop');
    expect(pressRead(['b'], overview)).toBe('stop');
    expect(ran.map(([id]) => id)).toEqual(['overview.nextBlock']);
    // ⌥A types å on a US Mac; a binding for ⌥A still runs.
    registry.setKeymap('bind alt+a keys.help');
    expect(pressRead(['å', 'alt+a'], scope('window'))).toBe('stop');
    expect(ran.map(([id]) => id)).toEqual(['overview.nextBlock', 'keys.help']);
    // Where text is typed, the character is typed.
    expect(pressRead(['å', 'alt+a'], scope('palette', undefined, 'field'))).toBe('pass');
    expect(
      pressRead(['å', 'alt+a'], scope('box', Object.assign(new FakeView(), { mode: 'insert' }))),
    ).toBe('pass');
    expect(ran).toHaveLength(2);
  });

  test('a code view that can’t say its state gets no keys, and Lo’s chords still run', () => {
    const { ran, errors, press } = setup();
    const view = new FakeView();
    view.keyState = () => {
      throw new Error('gone');
    };
    expect(press(['e', 'j', 'tab', 'cmd+shift+p'], scope('diff', view))).toEqual([
      'stop',
      'stop',
      'stop',
      'stop',
    ]);
    expect(ran.map(([id]) => id)).toEqual(['keys.palette']);
    expect(
      errors.map(([error, id]) => [error instanceof Error ? error.message : error, id]),
    ).toEqual([
      ['gone', 'view'],
      ['gone', 'view'],
      ['gone', 'view'],
      ['gone', 'view'],
    ]);
  });

  describe('waiting for the rest', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test('a key held in a code view waits for the next however long, as Vim’s own `y` does', () => {
      const { registry, press } = setup();
      const view = new FakeView();
      press(['y'], scope('diff', view));
      vi.advanceTimersByTime(60_000);
      expect(view.log).toEqual([]);
      expect(registry.isPending()).toBe(true);
      // The next key decides: here, Vim's `yw`.
      expect(press(['w'], scope('diff', view))).toEqual(['pass']);
      expect(view.log).toEqual(['passKeys y']);
      expect(registry.isPending()).toBe(false);
    });

    test('leaving the code view clears what Vim waits on, so no later key completes it', () => {
      const { registry, ran, press } = setup();
      const view = new FakeView();
      // `g` goes back to Vim with `q`, which Vim then waits on the rest of.
      press(['g', 'q'], scope('diff', view));
      expect(view.pending).toBe(true);
      registry.leave(view);
      expect(view.log).toEqual(['passKeys g', 'clearPending']);
      // Back in the view, `e` marks the file viewed: it isn't Vim's `ge`.
      expect(press(['e'], scope('diff', view))).toEqual(['stop']);
      expect(ran.map(([id]) => id)).toEqual(['diff.markViewed']);
    });

    test('a code view that throws taking the held key is reported, and nothing else breaks', () => {
      const { registry, errors, press } = setup();
      const view = new FakeView();
      view.passKeys = () => {
        throw new Error('broken');
      };
      expect(() => press(['g', 'q'], scope('diff', view))).not.toThrow();
      expect(registry.isPending()).toBe(false);
      expect(
        errors.map(([error, id]) => [error instanceof Error ? error.message : error, id]),
      ).toEqual([['broken', 'view']]);
    });

    test('a key held anywhere else is dropped after a second', () => {
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
    // The view keys last went to stops waiting, and was never handed the held key.
    expect(view.log).toEqual(['clearPending']);
    expect(ran).toEqual([]);
  });
});

/** The test commands, with `diff.markViewed` and a row move for the tree taking a count. */
function counting() {
  const counts: [string, number | undefined][] = [];
  const heard =
    (id: string) =>
    (_target: Target, count?: number): void => {
      counts.push([id, count]);
    };
  const down = commandsOf(
    defineCommands('rows', {
      down: {
        label: 'Next row',
        group: 'Files',
        keys: ['j'],
        count: 'rows',
        when: { scope: 'tree' },
      },
    }),
  ).map((command) => ({ ...command, handler: { run: heard(command.id) } }));
  const commands = testCommands().map((command) => {
    if (command.id === 'diff.markViewed') {
      return { ...command, count: 'files', handler: { run: heard(command.id) } };
    }
    return command.id === 'diff.copyLine'
      ? { ...command, count: 'lines', handler: { run: heard(command.id) } }
      : command;
  });
  return { counts, ...setup({ commands: [...commands, ...down] }) };
}

describe('counts', () => {
  test('a count Vim holds goes to a command that takes one, and Vim drops it', () => {
    const { counts, registry, press } = counting();
    const view = new FakeView();
    view.pending = true;
    view.count = 3;
    expect(press(['e'], scope('diff', view))).toEqual(['stop']);
    expect(view.log).toEqual(['clearPending']);
    // Without one, none, from a menu or the palette too; and `1` is a count of its own.
    expect(press(['e'], scope('diff', view))).toEqual(['stop']);
    registry.run('diff.markViewed', place(2));
    view.pending = true;
    view.count = 1;
    expect(press(['e'], scope('diff', view))).toEqual(['stop']);
    expect(counts).toEqual([
      ['diff.markViewed', 3],
      ['diff.markViewed', undefined],
      ['diff.markViewed', undefined],
      ['diff.markViewed', 1],
    ]);
  });

  test('elsewhere the digits typed before a key are its count', () => {
    const { counts, registry, press } = counting();
    expect(press(['1', '2', 'j'], scope('tree'))).toEqual(['stop', 'stop', 'stop']);
    expect(registry.isPending()).toBe(false);
    expect(press(['j'], scope('tree'))).toEqual(['stop']);
    expect(counts).toEqual([
      ['rows.down', 12],
      ['rows.down', undefined],
    ]);
  });
});

describe('the keys held', () => {
  test('are said as they’re held, after Vim’s count, and no longer once they run or go', () => {
    const { registry, press } = counting();
    const heard: string[] = [];
    registry.onHeldKeys(() => heard.push(registry.heldKeys()));
    const view = new FakeView();
    view.pending = true;
    view.count = 2;
    press(['y'], scope('diff', view));
    expect(registry.heldKeys()).toBe('2y');
    press(['y'], scope('diff', view));
    expect(registry.heldKeys()).toBe('');
    view.pending = false;
    view.count = undefined;
    press(['g'], scope('diff', view));
    expect(registry.heldKeys()).toBe('g');
    registry.leave(view);
    expect(heard).toEqual(['2y', '', 'g', '']);
  });

  test('elsewhere, a count held is said, and the keys after it', () => {
    const { registry, press } = counting();
    press(['3'], scope('tree'));
    expect(registry.heldKeys()).toBe('3');
    press(['z'], scope('tree'));
    expect(registry.heldKeys()).toBe('3z');
    press(['esc'], scope('tree'));
    expect(registry.heldKeys()).toBe('');
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

  test('reports binds that can’t apply, by line, and applies the rest', () => {
    const { registry, ran, press } = setup();
    const errors = registry.setKeymap(
      [
        'bind x vim.down',
        'bind e diff.markViewed',
        'bind y diff.comment',
        'bind g i x diff.comment',
        'bind q diff.comment',
        'bind q diff.comment',
        'unbind y y',
        'unbind y l',
        'bind y diff.comment',
      ].join('\n'),
    );
    expect(errors).toEqual([
      { line: 1, message: "vim.down is one of Vim's own keys: change Vim's keys with a vim line." },
      { line: 2, message: 'e already runs diff.markViewed.' },
      { line: 3, message: 'y would keep y y (diff.copyLine) from ever running.' },
      { line: 4, message: 'g i x would never run: g i (diff.inline) runs first.' },
      { line: 6, message: 'q already runs diff.comment.' },
    ]);
    // Once `y y` and `y l` are gone, `y` is free.
    press(['q', 'y'], scope('diff', new FakeView()));
    expect(ran.map(([id]) => id)).toEqual(['diff.comment', 'diff.comment']);
  });

  test('applies a long keymap in time linear in its lines', () => {
    const { registry } = setup();
    const lines: string[] = [];
    for (let index = 0; index < 20_000; index++) {
      lines.push(`bind ctrl+alt+f${(index % 20) + 1} keys.help`, 'unbind ctrl+alt+f1');
    }
    const start = performance.now();
    registry.setKeymap(lines.join('\n'));
    expect(performance.now() - start).toBeLessThan(1500);
    // Each bind of a key still bound to keys.help repeats it.
    expect(registry.keymapErrors()).toHaveLength(20_000 - 1_000 - 19);
  });

  test('drops a held key, whose sequence may be gone', () => {
    const { registry, press } = setup();
    press(['y'], scope('diff', new FakeView()));
    registry.setKeymap('unbind y l');
    expect(registry.isPending()).toBe(false);
  });
});

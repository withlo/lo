import { describe, expect, test } from 'vitest';

import { testCommands } from '../../test/commands.ts';
import {
  Bindings,
  declaredBindings,
  match,
  SEQUENCE_TIMEOUT,
  type Focus,
  type Outcome,
  type Pending,
} from './match.ts';
import { commandsOf, defineCommands } from './declare.ts';
import { parseKeys, systemStrokes, vimKeys, type System } from './notation.ts';
import type { Mode } from './scopes.ts';

const tables: Record<System, Bindings> = {
  mac: new Bindings('mac', declaredBindings(testCommands(), 'mac')),
  linux: new Bindings('linux', declaredBindings(testCommands(), 'linux')),
};

function view(scope: string, mode: Mode = 'normal', pending = false, count?: number): Focus {
  return { scope, text: false, view: { mode, pending, count } };
}
const diff = view('diff');
const tree: Focus = { scope: 'tree', text: false };
const anywhere: Focus = { scope: 'window', text: false };

function said(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'run':
      return `run ${outcome.command.id}${outcome.count === undefined ? '' : ` ×${outcome.count}`}`;
    case 'replay':
      return outcome.strokes.length === 0 ? 'replay' : `replay ${vimKeys(outcome.strokes)}`;
    case 'arrow':
      return outcome.key;
    case 'pass':
    case 'hold':
    case 'stop':
      return outcome.kind;
    default:
      throw new Error(`an outcome Lo doesn't know: ${JSON.stringify(outcome satisfies never)}`);
  }
}

interface Typing {
  readonly system?: System;
  /** The bindings to match with, in place of the test commands'. */
  readonly bindings?: Bindings;
  /** When each key is pressed, in ms; by default 10 ms apart. */
  readonly times?: readonly number[];
  readonly repeat?: readonly boolean[];
  readonly composing?: boolean;
  /** The focus to match a key in again after held keys went back to the view. */
  readonly afterReplay?: Focus;
  readonly pending?: Pending;
}

/**
 * Types `keys` (each written in Lo's notation) where `focus` is, as the registry does: after a
 * replay, the same key is matched again. Returns what became of each, and what's left pending.
 */
function type(
  keys: readonly string[],
  focus: Focus,
  typing: Typing = {},
): { said: string[]; pending: Pending | undefined } {
  const system = typing.system ?? 'mac';
  const bindings = typing.bindings ?? tables[system];
  let pending = typing.pending;
  const outcomes: string[] = [];
  keys.forEach((text, index) => {
    const [stroke] = systemStrokes(parseKeys(text), system);
    if (!stroke) throw new Error(`No key in ${text}`);
    const press = {
      stroke,
      repeat: typing.repeat?.[index] ?? false,
      composing: typing.composing ?? false,
      time: typing.times?.[index] ?? index * 10,
    };
    let step = match(bindings, pending, press, focus);
    outcomes.push(said(step.outcome));
    if (step.outcome.kind === 'replay') {
      step = match(bindings, undefined, press, typing.afterReplay ?? focus);
      outcomes.push(said(step.outcome));
    }
    pending = step.pending;
  });
  return { said: outcomes, pending };
}

describe('sequences', () => {
  test('the first key of a sequence is held, and the next completes it', () => {
    expect(type(['y', 'l'], diff)).toEqual({
      said: ['hold', 'run diff.copyLink'],
      pending: undefined,
    });
    expect(type(['z', 'R'], tree).said).toEqual(['hold', 'run tree.openAll']);
  });

  test('a key that doesn’t complete one sends the held key back, then is matched afresh', () => {
    // `y w` still yanks a word: Vim gets `y` back, and `w` goes on to it.
    expect(type(['y', 'w'], diff).said).toEqual(['hold', 'replay y', 'pass']);
    // Vim is in the middle of a command once it has `y`, so `e` is Vim's too.
    expect(type(['y', 'e'], diff, { afterReplay: view('diff', 'normal', true) }).said).toEqual([
      'hold',
      'replay y',
      'pass',
    ]);
    // A chord Lo doesn't take goes to Vim after the held key.
    expect(type(['y', 'ctrl+x'], diff).said).toEqual(['hold', 'replay y', 'pass']);
    // Vim's own `gg`.
    expect(type(['g', 'g'], diff, { afterReplay: view('diff', 'normal', true) }).said).toEqual([
      'hold',
      'replay g',
      'pass',
    ]);
  });

  test('a chord Lo runs drops the held keys, so Vim isn’t left mid-command', () => {
    expect(type(['y', 'cmd+shift+p'], diff)).toEqual({
      said: ['hold', 'run keys.palette'],
      pending: undefined,
    });
    expect(type(['g', 'ctrl+o'], diff).said).toEqual(['hold', 'run keys.back']);
    expect(type(['z', 'cmd+w'], tree).said).toEqual(['hold', 'run tab.close']);
  });

  test('Esc drops the held keys, sending nothing back', () => {
    expect(type(['y', 'esc'], diff)).toEqual({ said: ['hold', 'stop'], pending: undefined });
    expect(type(['z', 'esc', 'R'], tree).said).toEqual(['hold', 'stop', 'pass']);
  });

  test('Esc can still complete a sequence of its own', () => {
    expect(type(['esc', 'esc'], view('box')).said).toEqual(['hold', 'run review.close']);
  });

  test('in a code view the held key waits for the next however long, as Vim’s own `y` does', () => {
    expect(type(['y', 'l'], diff, { times: [0, SEQUENCE_TIMEOUT * 10] }).said).toEqual([
      'hold',
      'run diff.copyLink',
    ]);
    // What doesn't go on with it still goes to Vim after it.
    expect(type(['y', 'w'], diff, { times: [0, SEQUENCE_TIMEOUT * 10] }).said).toEqual([
      'hold',
      'replay y',
      'pass',
    ]);
  });

  test('anywhere else it waits a second', () => {
    expect(type(['z', 'R'], tree, { times: [0, SEQUENCE_TIMEOUT - 1] }).said).toEqual([
      'hold',
      'run tree.openAll',
    ]);
    // Measured from the last key held.
    expect(type(['z', 'R'], tree, { times: [0, SEQUENCE_TIMEOUT + 5] }).said).toEqual([
      'hold',
      'replay z',
      'pass',
    ]);
  });

  test('keys held in one scope are dropped in another', () => {
    const { pending } = type(['z'], tree);
    expect(pending).toBeDefined();
    expect(type(['R'], diff, { pending }).said).toEqual(['pass']);
  });
});

describe('precedence', () => {
  test('a command for the focused scope beats one for anywhere', () => {
    // ⌘⏎ adds to the review in a box, and submits it elsewhere.
    expect(type(['cmd+enter'], view('box')).said).toEqual(['run review.add']);
    expect(type(['cmd+enter'], diff).said).toEqual(['run review.submit']);
    expect(type(['cmd+enter'], anywhere).said).toEqual(['run review.submit']);
  });

  test('a scope’s command applies only in its scopes', () => {
    expect(type(['e'], diff).said).toEqual(['run diff.markViewed']);
    expect(type(['e'], tree).said).toEqual(['run diff.markViewed']);
    expect(type(['e'], anywhere).said).toEqual(['pass']);
    expect(type(['z', 'R'], diff).said).toEqual(['hold', 'replay z', 'pass']);
  });

  test('a scope can be left out', () => {
    expect(type(['ctrl+o'], diff).said).toEqual(['run keys.back']);
    expect(type(['ctrl+o'], view('box')).said).toEqual(['pass']);
  });

  test('a mode limits a command in a code view, and nowhere else', () => {
    expect(type(['e'], view('diff', 'visual')).said).toEqual(['pass']);
    expect(type(['e'], tree).said).toEqual(['run diff.markViewed']);
  });

  test('a binding for one system exists only there', () => {
    expect(type(['cmd+o'], diff, { system: 'mac' }).said).toEqual(['run tab.open']);
    expect(type(['cmd+o'], diff, { system: 'linux' }).said).toEqual(['run keys.back']);
    expect(type(['cmd+shift+i'], diff, { system: 'mac' }).said).toEqual(['run tab.install']);
    expect(type(['cmd+shift+i'], diff, { system: 'linux' }).said).toEqual(['pass']);
  });

  test('a keymap binding beats a default one at the same level, and a later one an earlier one', () => {
    const commands = testCommands();
    const byId = (id: string) => commands.find((command) => command.id === id)!;
    const strokes = systemStrokes(parseKeys('?'), 'mac');
    const bindings = new Bindings('mac', [
      { command: byId('keys.tree'), strokes },
      { command: byId('keys.palette'), strokes },
      ...declaredBindings(commands, 'mac'),
    ]);
    const [stroke] = strokes;
    const step = match(
      bindings,
      undefined,
      { stroke: stroke!, repeat: false, composing: false, time: 0 },
      anywhere,
    );
    expect(step.outcome).toEqual({ kind: 'run', command: byId('keys.tree') });
  });
});

describe('Vim', () => {
  test('in insert mode, only chords are Lo’s', () => {
    const box = view('box', 'insert');
    expect(type(['c'], box).said).toEqual(['pass']);
    expect(type(['?'], box).said).toEqual(['pass']);
    expect(type(['esc'], box).said).toEqual(['pass']);
    expect(type(['tab'], box).said).toEqual(['pass']);
    expect(type(['cmd+enter'], box).said).toEqual(['run review.add']);
    expect(type(['alt+enter'], box).said).toEqual(['run review.now']);
    expect(type(['cmd+shift+p'], box).said).toEqual(['run keys.palette']);
  });

  test('in the middle of a command, only chords are Lo’s', () => {
    // After a count or an operator, `e` is Vim's motion and `y` its operator.
    const counting = view('diff', 'normal', true);
    expect(type(['e'], counting).said).toEqual(['pass']);
    expect(type(['y'], counting).said).toEqual(['pass']);
    expect(type(['cmd+shift+p'], counting).said).toEqual(['run keys.palette']);
  });

  test('Vim’s own keys are never taken', () => {
    expect(type(['j'], diff).said).toEqual(['pass']);
    expect(type(['j'], tree).said).toEqual(['pass']);
    expect(type(['j'], anywhere).said).toEqual(['pass']);
  });

  test('Lo’s motions are Vim’s to run in a code view, and Lo’s elsewhere', () => {
    expect(type([']', 'f'], diff).said).toEqual(['pass', 'pass']);
    expect(type([']', 'f'], tree).said).toEqual(['hold', 'run diff.nextFile']);
  });
});

describe('the Linux box rule', () => {
  test('in a box in insert mode, Linux keeps Ctrl+C, X, V, A, Z and W for editing', () => {
    const box = view('box', 'insert');
    // ⌘W closes the tab: Ctrl+W on Linux, which deletes a word in a box.
    expect(type(['cmd+w'], box, { system: 'linux' }).said).toEqual(['pass']);
    expect(type(['ctrl+w'], box, { system: 'linux' }).said).toEqual(['pass']);
    // Ctrl+Shift+V, write or preview, isn't one of them.
    expect(type(['cmd+shift+v'], box, { system: 'linux' }).said).toEqual(['run review.preview']);
    expect(type(['cmd+enter'], box, { system: 'linux' }).said).toEqual(['run review.add']);
  });

  test('only in a box, only in insert mode, only on Linux', () => {
    expect(type(['cmd+w'], view('box', 'normal'), { system: 'linux' }).said).toEqual([
      'run tab.close',
    ]);
    expect(type(['cmd+w'], diff, { system: 'linux' }).said).toEqual(['run tab.close']);
    expect(type(['cmd+w'], view('box', 'insert'), { system: 'mac' }).said).toEqual([
      'run tab.close',
    ]);
  });
});

describe('text', () => {
  test('keys during IME composition go to the text', () => {
    expect(type(['e'], diff, { composing: true })).toEqual({ said: ['pass'], pending: undefined });
    expect(type(['cmd+shift+p'], anywhere, { composing: true }).said).toEqual(['pass']);
    // A pending sequence waits through it.
    const { pending } = type(['y'], diff);
    expect(type(['l'], diff, { composing: true, pending }).pending).toBe(pending);
  });

  test('a text field outside a code view keeps typing and moving through its text', () => {
    const field: Focus = { scope: 'palette', text: true };
    expect(type(['?'], field).said).toEqual(['pass']);
    expect(type(['-'], field).said).toEqual(['pass']);
    expect(type(['backspace'], field).said).toEqual(['pass']);
    expect(type(['enter'], field).said).toEqual(['run palette.run']);
    expect(type(['down'], field).said).toEqual(['run palette.next']);
    expect(type(['cmd+shift+p'], field).said).toEqual(['run keys.palette']);
    // The same keys outside a text field.
    expect(type(['?'], anywhere).said).toEqual(['run keys.help']);
    expect(type(['backspace'], anywhere).said).toEqual(['run keys.erase']);
  });

  test('in a menu, j and k move as ↓ and ↑', () => {
    const menu: Focus = { scope: 'menu', text: false };
    expect(type(['j', 'k'], menu).said).toEqual(['ArrowDown', 'ArrowUp']);
    expect(type(['j'], { scope: 'menu', text: true }).said).toEqual(['pass']);
  });

  test('in a menu, no command runs but the menu’s own', () => {
    const menu: Focus = { scope: 'menu', text: false };
    // Commands for anywhere stay out of it: key help or the palette over a menu would leave two
    // open, with each Esc going back into the menu.
    for (const key of ['?', 'cmd+shift+p', 'ctrl+o', 'ctrl+i', 'cmd+l', '-', 'esc']) {
      for (const system of ['mac', 'linux'] as const) {
        expect(type([key], menu, { system }), `${key} on ${system}`).toEqual({
          said: ['pass'],
          pending: undefined,
        });
      }
    }
    // Commands for other scopes do too, but not beyond it: the same keys run outside a menu.
    expect(type(['?'], anywhere).said).toEqual(['run keys.help']);
    expect(type(['cmd+shift+p'], anywhere).said).toEqual(['run keys.palette']);
    // A command that names the menu runs there.
    const own = defineCommands('menu', {
      pick: { label: 'Pick', group: 'Act', keys: ['p'], when: { scope: 'menu' } },
      both: { label: 'Both', group: 'Act', keys: ['b'], when: { scope: ['menu', 'tree'] } },
    });
    const bindings = new Bindings('mac', declaredBindings(commandsOf(own), 'mac'));
    const press = (key: string, focus: Focus) => {
      const [stroke] = systemStrokes(parseKeys(key), 'mac');
      return said(
        match(
          bindings,
          undefined,
          { stroke: stroke!, repeat: false, composing: false, time: 0 },
          focus,
        ).outcome,
      );
    };
    expect(press('p', menu)).toBe('run menu.pick');
    expect(press('b', menu)).toBe('run menu.both');
    expect(press('p', anywhere)).toBe('pass');
  });
});

describe('repeats', () => {
  test('a held key runs a command once, unless it repeats', () => {
    expect(type(['e', 'e', 'e'], diff, { repeat: [false, true, true] }).said).toEqual([
      'run diff.markViewed',
      'stop',
      'stop',
    ]);
    const field: Focus = { scope: 'palette', text: true };
    expect(type(['down', 'down'], field, { repeat: [false, true] }).said).toEqual([
      'run palette.next',
      'run palette.next',
    ]);
  });

  test('a held key that starts a sequence is held once', () => {
    const held = type(['y', 'y', 'y'], diff, { repeat: [false, true, true] });
    expect(held.said).toEqual(['hold', 'stop', 'stop']);
    expect(held.pending?.strokes.map((each) => each.id)).toEqual(['y']);
    // A repeat never starts one.
    expect(type(['y'], diff, { repeat: [true] })).toEqual({ said: ['stop'], pending: undefined });
  });

  test('holding a sequence’s last key runs it once, even a command that repeats', () => {
    expect(type(['y', 'l', 'l'], diff, { repeat: [false, false, true] }).said).toEqual([
      'hold',
      'run diff.copyLink',
      'pass',
    ]);
    expect(
      type([']', 'b', 'b'], { scope: 'overview', text: false }, { repeat: [false, false, true] })
        .said,
    ).toEqual(['hold', 'run overview.nextBlock', 'pass']);
  });
});

describe('counts', () => {
  const counting = defineCommands(
    'counted',
    {
      markViewed: {
        label: 'Mark viewed',
        group: 'Act',
        keys: ['e'],
        overVim: true,
        count: 'files',
        when: { scope: ['diff', 'tree'], mode: 'normal' },
      },
      copyLines: {
        label: 'Copy the lines',
        group: 'Copy and open',
        keys: ['y y'],
        overVim: true,
        count: 'lines',
        when: { scope: ['diff', 'file'], mode: ['normal', 'visual'] },
      },
      copyLink: {
        label: 'Copy the line’s link',
        group: 'Copy and open',
        keys: ['y l'],
        overVim: true,
        when: { scope: ['diff', 'file'], mode: 'normal' },
      },
      inline: {
        label: 'Inline or side by side',
        group: 'Diff view',
        keys: ['g i'],
        overVim: true,
        when: { scope: 'diff', mode: 'normal' },
      },
      nextLayer: {
        label: 'Next layer',
        group: 'Jump',
        keys: ['] s'],
        count: 'layers',
        when: { except: ['box'], mode: 'normal' },
      },
      down: {
        label: 'Next row of the tree',
        group: 'Files',
        keys: ['j'],
        repeat: true,
        count: 'rows',
        when: { scope: 'tree' },
      },
      mode: { label: 'Tree or review order', group: 'Files', keys: ['t'], when: { scope: 'tree' } },
      openAll: { label: 'Open all', group: 'Files', keys: ['z R'], when: { scope: 'tree' } },
      middle: { label: 'Back to the middle view', group: 'Panels', keys: ['esc'] },
      palette: { label: 'Every action', group: 'Find', keys: ['cmd+shift+p'] },
    },
    { scopes: ['tree'] },
  );
  const bindings = new Bindings('mac', declaredBindings(commandsOf(counting), 'mac'));
  /** The diff with `3` typed: Vim holds the count. */
  const three = view('diff', 'normal', true, 3);
  /** The diff once Vim has an operator too. */
  const operator = view('diff', 'normal', true);

  test('in a code view the count is Vim’s, and a command that takes one takes it', () => {
    expect(type(['e'], three, { bindings }).said).toEqual(['run counted.markViewed ×3']);
    expect(type(['y', 'y'], three, { bindings }).said).toEqual([
      'hold',
      'run counted.copyLines ×3',
    ]);
    expect(type([']', 's'], three, { bindings }).said).toEqual([
      'hold',
      'run counted.nextLayer ×3',
    ]);
    // Without one, they run once.
    expect(type(['e'], diff, { bindings }).said).toEqual(['run counted.markViewed']);
  });

  test('in a code view a count goes on to Vim with any other key', () => {
    // `3yl` is Vim's: the held `y` goes back, and `l` after it.
    expect(type(['y', 'l'], three, { bindings, afterReplay: operator }).said).toEqual([
      'hold',
      'replay y',
      'pass',
    ]);
    expect(type(['g'], three, { bindings }).said).toEqual(['pass']);
    // In visual mode a count is Vim's, to move the selection's end.
    expect(type(['e'], view('diff', 'visual', true, 3), { bindings }).said).toEqual(['pass']);
    // After an operator, the count isn't all Vim holds.
    expect(type(['e'], operator, { bindings }).said).toEqual(['pass']);
    // Chords are Lo's, and the count stays Vim's.
    expect(type(['cmd+shift+p'], three, { bindings }).said).toEqual(['run counted.palette']);
  });

  test('elsewhere digits are held as a count where the scope has a command that takes one', () => {
    expect(type(['3', 'j'], tree, { bindings })).toEqual({
      said: ['hold', 'run counted.down ×3'],
      pending: undefined,
    });
    expect(type(['1', '2', 'j'], tree, { bindings }).said).toEqual([
      'hold',
      'hold',
      'run counted.down ×12',
    ]);
    expect(type(['1', '0', 'e'], tree, { bindings }).said).toEqual([
      'hold',
      'hold',
      'run counted.markViewed ×10',
    ]);
    // A command for anywhere that takes one takes it there.
    expect(type(['2', ']', 's'], tree, { bindings }).said).toEqual([
      'hold',
      'hold',
      'run counted.nextLayer ×2',
    ]);
    // `0` starts none, as in Vim.
    expect(type(['0'], tree, { bindings }).said).toEqual(['pass']);
  });

  test('a count before a command that takes none is dropped, and the command runs once', () => {
    expect(type(['3', 't'], tree, { bindings }).said).toEqual(['hold', 'run counted.mode']);
    expect(type(['3', 'z', 'R'], tree, { bindings }).said).toEqual([
      'hold',
      'hold',
      'run counted.openAll',
    ]);
    // Esc drops it, and does nothing else: alone, it's a command of its own.
    expect(type(['3', 'esc', 'j'], tree, { bindings }).said).toEqual([
      'hold',
      'stop',
      'run counted.down',
    ]);
    expect(type(['esc'], tree, { bindings }).said).toEqual(['run counted.middle']);
    expect(type(['z', 'esc'], tree, { bindings }).said).toEqual(['hold', 'stop']);
  });

  test('a count waits as a held key does, and only where a command of the scope’s takes one', () => {
    expect(type(['3', 'j'], tree, { bindings, times: [0, SEQUENCE_TIMEOUT + 1] }).said).toEqual([
      'hold',
      'replay',
      'run counted.down',
    ]);
    // Nothing of its own takes one in the window: `]s` there is for anywhere.
    expect(type(['3'], anywhere, { bindings }).said).toEqual(['pass']);
    expect(type(['3'], { scope: 'tree', text: true }, { bindings }).said).toEqual(['pass']);
  });

  test('a held digit counts once', () => {
    expect(type(['3', '3', 'j'], tree, { bindings, repeat: [false, true, false] }).said).toEqual([
      'hold',
      'stop',
      'run counted.down ×3',
    ]);
  });
});

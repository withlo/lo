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
import { parseKeys, systemStrokes, vimKeys, type System } from './notation.ts';
import type { Mode } from './scopes.ts';

const tables: Record<System, Bindings> = {
  mac: new Bindings('mac', declaredBindings(testCommands(), 'mac')),
  linux: new Bindings('linux', declaredBindings(testCommands(), 'linux')),
};

function view(scope: string, mode: Mode = 'normal', pending = false): Focus {
  return { scope, text: false, view: { mode, pending } };
}
const diff = view('diff');
const tree: Focus = { scope: 'tree', text: false };
const anywhere: Focus = { scope: 'window', text: false };

function said(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'run':
      return `run ${outcome.command.id}`;
    case 'replay':
      return `replay ${vimKeys(outcome.strokes)}`;
    case 'arrow':
      return outcome.key;
    case 'pass':
    case 'hold':
    case 'stop':
      return outcome.kind;
    default:
      return outcome satisfies never;
  }
}

interface Typing {
  readonly system?: System;
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
  const bindings = tables[system];
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
    // A chord after a held key still runs.
    expect(
      type(['y', 'cmd+shift+p'], diff, { afterReplay: view('diff', 'normal', true) }).said,
    ).toEqual(['hold', 'replay y', 'run keys.palette']);
    // Vim's own `gg`.
    expect(type(['g', 'g'], diff, { afterReplay: view('diff', 'normal', true) }).said).toEqual([
      'hold',
      'replay g',
      'pass',
    ]);
  });

  test('Esc drops the held keys, sending nothing back', () => {
    expect(type(['y', 'esc'], diff)).toEqual({ said: ['hold', 'stop'], pending: undefined });
    expect(type(['z', 'esc', 'R'], tree).said).toEqual(['hold', 'stop', 'pass']);
  });

  test('Esc can still complete a sequence of its own', () => {
    expect(type(['esc', 'esc'], view('box')).said).toEqual(['hold', 'run review.close']);
  });

  test('after a second, the held key goes back to the view, as Vim’s timeoutlen does', () => {
    expect(type(['y', 'l'], diff, { times: [0, SEQUENCE_TIMEOUT - 1] }).said).toEqual([
      'hold',
      'run diff.copyLink',
    ]);
    expect(type(['y', 'l'], diff, { times: [0, SEQUENCE_TIMEOUT] }).said).toEqual([
      'hold',
      'replay y',
      'pass',
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

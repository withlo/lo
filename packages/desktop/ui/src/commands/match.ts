// Matching, as a pure function of the pending sequence, the key, the focused scope and a code
// view's state, so the listener is a thin adapter around it.
//
// - A command for the focused scope beats one for anywhere; at each level a keymap binding beats
//   a default one, and a later binding an earlier one.
// - A key that starts one of Lo's sequences is held, and the next completes it. If it doesn't, the
//   held keys go back to the code view they were typed in, and the key is matched afresh, so
//   `y w` still yanks a word. A chord Lo runs drops the held keys instead, so Vim isn't left in
//   the middle of a command it never sees finished. One sequence is pending for the window, never
//   one per editor.
// - In a code view in insert mode or in the middle of a command (a count, an operator), only
//   chords are Lo's: the rest go to Vim. Vim's own keys (`vim: 'own'`) are never taken, and Lo's
//   motions (`vim: 'motion'`) are Vim's to run in a code view.
// - A text field keeps typing and moving through its text. One inside a code view, such as Vim's
//   `/` and `:` prompt, is typed into as insert mode is: only chords are Lo's.
// - On Linux, in a box in insert mode or a code view's text field, Ctrl+C, X, V, A, Z and W are
//   never taken.
// - Keys during IME composition go to the text.

import { listOf, type Command } from './declare.ts';
import {
  isChord,
  isTyping,
  parseKeys,
  systemStrokes,
  type Stroke,
  type System,
} from './notation.ts';
import type { Mode } from './scopes.ts';

/** A key binding: a command and the strokes that run it. */
export interface Binding {
  readonly command: Command;
  readonly strokes: readonly Stroke[];
}

/** The keys held back, waiting for the rest of a sequence. */
export interface Pending {
  readonly strokes: readonly Stroke[];
  /** The scope they were typed in. */
  readonly scope: string;
  /** When the last of them was pressed, in ms. */
  readonly at: number;
}

/** A keydown, as matching sees it. */
export interface Press {
  readonly stroke: Stroke;
  /** The system's auto-repeat of a held key. */
  readonly repeat: boolean;
  /** Part of an IME composition. */
  readonly composing: boolean;
  /** When it was pressed, in ms. */
  readonly time: number;
}

/** Where the key was pressed. */
export interface Focus {
  readonly scope: string;
  /** A text field has focus: outside a code view, or a field inside one, such as Vim's prompt. */
  readonly text: boolean;
  /** A code view's state, when the scope is one. A field inside one is in insert mode. */
  readonly view?: { readonly mode: Mode; readonly pending: boolean };
}

/** What becomes of a key. */
export type Outcome =
  /** Not Lo's: the event goes on, to the widget or the code view. */
  | { readonly kind: 'pass' }
  /** The start of a sequence: the event is stopped, and the key waits for the rest. */
  | { readonly kind: 'hold' }
  /** The event is stopped and `command` runs. */
  | { readonly kind: 'run'; readonly command: Command }
  /** The event is stopped and nothing runs: a held key repeating, or `Esc` ending a sequence. */
  | { readonly kind: 'stop' }
  /**
   * The pending sequence ended without completing: `strokes` go back to the code view they were
   * typed in, then the key is matched again, with nothing pending.
   */
  | { readonly kind: 'replay'; readonly strokes: readonly Stroke[] }
  /** In a menu, `j` and `k` are `↓` and `↑`: the event is stopped and the arrow sent instead. */
  | { readonly kind: 'arrow'; readonly key: 'ArrowDown' | 'ArrowUp' };

export interface Step {
  readonly pending: Pending | undefined;
  readonly outcome: Outcome;
}

/** Vim's `timeoutlen`: how long a held key waits for the rest of its sequence. */
export const SEQUENCE_TIMEOUT = 1000;

/**
 * Keys Linux's text boxes keep for editing in insert mode, in Lo's notation: copy, cut, paste,
 * all, undo, a word back.
 */
export const linuxEditingKeys: readonly string[] = ['c', 'x', 'v', 'a', 'z', 'w'].map(
  (key) => `ctrl+${key}`,
);
const linuxEditing = new Set(linuxEditingKeys);

/**
 * The keys the engine takes in a menu, before any command: `j` and `k` move as `↓` and `↑` do, so a
 * command for menus can't start with them.
 */
export const menuArrows: Readonly<Record<string, 'ArrowDown' | 'ArrowUp' | undefined>> = {
  j: 'ArrowDown',
  k: 'ArrowUp',
};

/** The bindings `commands` declare for `system`, in their order: their default keys. */
export function declaredBindings(commands: readonly Command[], system: System): Binding[] {
  const bindings: Binding[] = [];
  for (const command of commands) {
    if (command.when?.system !== undefined && command.when.system !== system) continue;
    for (const spec of command.keys) {
      if (typeof spec !== 'string' && spec.on !== system) continue;
      const keys = parseKeys(typeof spec === 'string' ? spec : spec.keys);
      bindings.push({ command, strokes: systemStrokes(keys, system) });
    }
  }
  return bindings;
}

/** The bindings in effect on one system, in the order they take precedence. */
export class Bindings {
  readonly system: System;
  readonly timeout: number;
  /** Each binding, by its first stroke, in order of precedence. */
  private readonly byFirst = new Map<string, Binding[]>();

  constructor(system: System, bindings: readonly Binding[], timeout = SEQUENCE_TIMEOUT) {
    this.system = system;
    this.timeout = timeout;
    for (const binding of bindings) {
      const first = binding.strokes[0];
      if (first === undefined) continue;
      const list = this.byFirst.get(first.id);
      if (list) list.push(binding);
      else this.byFirst.set(first.id, [binding]);
    }
  }

  /**
   * What `strokes` run where `focus` is: the command bound to exactly them, if any, else whether
   * a longer sequence starts with them, looking at the focused scope's bindings before those for
   * anywhere.
   */
  find(strokes: readonly Stroke[], focus: Focus): { command?: Command; longer: boolean } {
    const first = strokes[0];
    const candidates = first === undefined ? undefined : this.byFirst.get(first.id);
    if (!candidates) return { longer: false };
    for (const scoped of [true, false]) {
      let longer = false;
      for (const binding of candidates) {
        if ((binding.command.when?.scope !== undefined) !== scoped) continue;
        if (!startsWith(binding.strokes, strokes) || !applies(binding, focus, this.system)) {
          continue;
        }
        if (binding.strokes.length === strokes.length)
          return { command: binding.command, longer: false };
        longer = true;
      }
      if (longer) return { longer: true };
    }
    return { longer: false };
  }
}

/** Whether `binding` can be matched where `focus` is, on `system`. */
function applies(binding: Binding, focus: Focus, system: System): boolean {
  const { vim } = binding.command;
  if (vim === 'own' || (vim === 'motion' && focus.view)) return false;
  return holds(binding, focus, system);
}

/**
 * Whether `binding` takes its keys where `focus` is, on `system`: its scope, mode and system
 * hold, and the rules for code views and text let it. It ignores `vim`: a motion holds in a code
 * view, where Vim runs it with the keys the registry hands it, so the clash check counts it there.
 */
export function holds(binding: Binding, focus: Focus, system: System): boolean {
  const { command, strokes } = binding;
  const { when } = command;
  const { view } = focus;
  if (when?.scope !== undefined && !listOf(when.scope).includes(focus.scope)) return false;
  // A menu is open over the window, and no other command runs under it: key help or the palette
  // would open over it, and each `Esc` would go back into the menu. Only a command that names the
  // menu, as a menu's own does, takes keys there.
  if (focus.scope === 'menu' && !listOf(when?.scope).includes('menu')) return false;
  if (when?.except?.includes(focus.scope)) return false;
  if (when?.system !== undefined && when.system !== system) return false;
  const first = strokes[0];
  if (first === undefined) return false;
  if (view) {
    if (when?.mode !== undefined && !listOf(when.mode).includes(view.mode)) return false;
    if ((view.mode === 'insert' || view.pending) && !isChord(first)) return false;
    if (
      system === 'linux' &&
      (focus.scope === 'box' || focus.text) &&
      view.mode === 'insert' &&
      strokes.some((each) => linuxEditing.has(each.id))
    ) {
      return false;
    }
  } else if (focus.text && isTyping(first)) {
    return false;
  }
  return true;
}

/** Whether `strokes` begin with `prefix`, or are the same keys. */
export function startsWith(strokes: readonly Stroke[], prefix: readonly Stroke[]): boolean {
  return (
    prefix.length <= strokes.length && prefix.every((each, index) => strokes[index]?.id === each.id)
  );
}

const PASS: Outcome = { kind: 'pass' };
const HOLD: Outcome = { kind: 'hold' };
const STOP: Outcome = { kind: 'stop' };

/** Matches one keydown: what becomes of it, and what's pending after it. */
export function match(
  bindings: Bindings,
  pending: Pending | undefined,
  press: Press,
  focus: Focus,
): Step {
  if (press.composing) return { pending, outcome: PASS };
  const { stroke } = press;
  // Keys held in another scope can't be completed here. Focus changes drop them before this.
  if (pending && pending.scope !== focus.scope) pending = undefined;
  if (pending) {
    if (press.time - pending.at >= bindings.timeout) {
      return { pending: undefined, outcome: { kind: 'replay', strokes: pending.strokes } };
    }
    // The held key repeating: it's still one press.
    if (press.repeat && pending.strokes.at(-1)?.id === stroke.id) return { pending, outcome: STOP };
    const strokes = [...pending.strokes, stroke];
    const found = bindings.find(strokes, focus);
    if (found.command) return { pending: undefined, outcome: run(found.command, press) };
    if (found.longer) {
      return { pending: { strokes, scope: focus.scope, at: press.time }, outcome: HOLD };
    }
    if (stroke.id === 'esc') return { pending: undefined, outcome: STOP };
    if (isChord(stroke)) {
      // A chord Lo takes drops the held keys: replayed, they'd leave Vim mid-command.
      const fresh = match(bindings, undefined, press, focus);
      if (fresh.outcome.kind !== 'pass') return fresh;
    }
    return { pending: undefined, outcome: { kind: 'replay', strokes: pending.strokes } };
  }
  const arrow =
    focus.scope === 'menu' && !focus.text && Object.hasOwn(menuArrows, stroke.id)
      ? menuArrows[stroke.id]
      : undefined;
  if (arrow !== undefined) return { pending: undefined, outcome: { kind: 'arrow', key: arrow } };
  const found = bindings.find([stroke], focus);
  if (found.command) return { pending: undefined, outcome: run(found.command, press) };
  if (found.longer) {
    // A held key never starts a sequence by repeating.
    if (press.repeat) return { pending: undefined, outcome: STOP };
    return { pending: { strokes: [stroke], scope: focus.scope, at: press.time }, outcome: HOLD };
  }
  return { pending: undefined, outcome: PASS };
}

/** Runs `command`, unless the press is a held key repeating and the command doesn't repeat. */
function run(command: Command, press: Press): Outcome {
  return press.repeat && !command.repeat ? STOP : { kind: 'run', command };
}

/** A keydown that can be read as more than one stroke, as `eventStrokes` reads layouts. */
export interface Presses extends Omit<Press, 'stroke'> {
  /** The readings, the likelier first. */
  readonly strokes: readonly Stroke[];
}

/**
 * Matches a keydown read more than one way: the first reading Lo has a use for wins, and if none
 * has, the first stands. Where text is typed, only the first counts, so typing a character never
 * runs a chord that the same keys could also mean.
 */
export function matchAny(
  bindings: Bindings,
  pending: Pending | undefined,
  press: Presses,
  focus: Focus,
): Step | undefined {
  const [first, ...others] = press.strokes;
  if (first === undefined) return undefined;
  const step = match(bindings, pending, { ...press, stroke: first }, focus);
  if (focus.text || focus.view?.mode === 'insert' || taken(step)) return step;
  for (const stroke of others) {
    const other = match(bindings, pending, { ...press, stroke }, focus);
    if (taken(other)) return other;
  }
  return step;
}

/** Whether Lo has a use for the key: it isn't passed on, nor does it end the pending keys. */
function taken(step: Step): boolean {
  return step.outcome.kind !== 'pass' && step.outcome.kind !== 'replay';
}

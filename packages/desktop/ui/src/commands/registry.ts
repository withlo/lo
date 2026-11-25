// The registry: the window's commands, the keys bound to them (the defaults, with the keymap file's
// lines over them), the pending sequence, and each tab's history. Keys reach it through the
// listener; the palette, menus and the app menu run commands through `run`. The keys it holds are
// shown in the status bar, as Vim shows a command it's waiting on the rest of.

import type { Command, Handler } from './declare.ts';
import { History, type Entry } from './history.ts';
import { applyKeymap, parseKeymap, type Keymap, type KeymapError } from './keymap.ts';
import {
  Bindings,
  declaredBindings,
  matchAny,
  SEQUENCE_TIMEOUT,
  type Binding,
  type Focus,
  type Pending,
} from './match.ts';
import { keyLabels, vimKey, vimKeys, type Stroke, type System } from './notation.ts';
import {
  isKeySource,
  scopeTarget,
  type FoundScope,
  type KeySource,
  type ScopeSource,
  type TextKind,
  type VimKey,
} from './scopes.ts';
import { fit, isOn, NO_TARGET, type Target, type TargetKind } from './targets.ts';

export interface RegistryOptions {
  readonly system: System;
  /** Every command, with its handler. */
  readonly commands: readonly Command[];
  /** Where the tab is now: the place a `jump` command records before it runs. */
  readonly here?: () => Entry | undefined;
  /** How long a held key waits for the rest of its sequence outside a code view, in ms. */
  readonly timeout?: number;
  /** A clock in ms, for timing sequences. */
  readonly now?: () => number;
  /**
   * A handler threw or rejected, or a code view did, with no command to blame. Without it, the
   * error is logged.
   */
  readonly onError?: (error: unknown, command: Command | undefined) => void;
  /**
   * `run` didn't run a command, and why: a key, a menu or the palette asked for one that can't run
   * on its target now. So the person who asked is told, rather than nothing happening.
   */
  readonly onRefused?: (reason: string, id: string) => void;
}

/** A keydown, as the listener reads it. */
export interface KeyPress {
  /** The strokes it can be, the likelier first, as `eventStrokes` reads it. */
  readonly strokes: readonly Stroke[];
  readonly repeat: boolean;
  readonly composing: boolean;
}

/** Where a key was pressed: its scope, and the kind of text the focused element takes. */
export interface KeyPlace {
  readonly scope: FoundScope;
  readonly text: TextKind | undefined;
  /**
   * Focus is nowhere in particular, as `isNowhere` says, so keys held there go on where Lo moves
   * focus. Unsaid, it's somewhere.
   */
  readonly nowhere?: boolean;
  /**
   * The focused element is an editable field, as `isEditable` says, which keeps the keys that edit
   * its text. Unsaid, it isn't.
   */
  readonly editable?: boolean;
}

/** What the listener does with the event. */
export type Handled =
  | { readonly kind: 'pass' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'arrow'; readonly key: 'ArrowDown' | 'ArrowUp' };

const PASS: Handled = { kind: 'pass' };
const STOP: Handled = { kind: 'stop' };

export class Registry {
  readonly system: System;
  /** Each tab's history, which `⌃o` and `⌃i` walk. */
  readonly history = new History();
  private readonly list: readonly Command[];
  /** The commands there now: every one but those {@link setOff} took out. */
  private shown: readonly Command[];
  /** The commands taken out of the app while their feature is off, by id. */
  private readonly off = new Set<string>();
  private readonly byId = new Map<string, Command>();
  private readonly here: (() => Entry | undefined) | undefined;
  private readonly timeout: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown, command: Command | undefined) => void;
  private readonly onRefused: ((reason: string, id: string) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly runs = new Set<(id: string) => void>();
  private keymap: Keymap = { lines: [], errors: [] };
  /** The keymap's errors: its lines that can't be read, then those that don't apply. */
  private errors: readonly KeymapError[] = [];
  /** Every binding in effect, in order of precedence. */
  private live: readonly Binding[] = [];
  private bindings: Bindings;
  private pending: Pending | undefined;
  /** The scope's source the pending keys were typed in. */
  private holder: ScopeSource | undefined;
  /** Whether the pending keys were typed with focus nowhere in particular. */
  private nowhere = false;
  /** Tells that the pending keys are the reader's input, should they be dropped before they end. */
  private unheard: (() => void) | undefined;
  /** The code view the last key was pressed in, whose Vim a tab switch leaves. */
  private active: KeySource | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The keys held, as the status bar shows them, and who's told when they change. */
  private held = '';
  private readonly heldListeners = new Set<() => void>();

  constructor(options: RegistryOptions) {
    this.system = options.system;
    this.list = options.commands;
    this.shown = options.commands;
    for (const command of options.commands) {
      if (this.byId.has(command.id)) throw new Error(`Two commands are called ${command.id}.`);
      this.byId.set(command.id, command);
    }
    this.here = options.here;
    this.timeout = options.timeout ?? SEQUENCE_TIMEOUT;
    this.now = options.now ?? (() => performance.now());
    this.onError =
      options.onError ??
      ((error, command) => {
        console.error(`${command ? command.id : 'A code view'} failed:`, error);
      });
    this.onRefused = options.onRefused;
    this.bindings = this.rebuild();
  }

  /**
   * Every command there now, in the order given: the palette, keyboard shortcuts, the menus and
   * the app menu list only these. One {@link setOff} took out is left out.
   */
  commands(): readonly Command[] {
    return this.shown;
  }

  /**
   * Takes commands `ids` out of the app, with `off`, or puts them back: as a setting turns their
   * feature off, every list leaves them out, their keys do nothing and pass on to what has focus,
   * and running one refuses with nothing to say. The keymap file's lines for them stay valid, and
   * apply again as they come back.
   */
  setOff(ids: Iterable<string>, off: boolean): void {
    let changed = false;
    for (const id of ids) {
      if (!this.byId.has(id)) throw new Error(`There’s no command called ${id}.`);
      if (this.off.has(id) === off) continue;
      if (off) this.off.add(id);
      else this.off.delete(id);
      changed = true;
    }
    if (!changed) return;
    this.shown = this.list.filter((command) => !this.off.has(command.id));
    this.drop();
    this.bindings = this.rebuild();
    for (const listener of this.listeners) listener();
  }

  command(id: string): Command | undefined {
    return this.byId.get(id);
  }

  /** The key sequences `id` has now, the keymap file's first. */
  keysOf(id: string): readonly (readonly Stroke[])[] {
    return this.live
      .filter((binding) => binding.command.id === id)
      .map((binding) => binding.strokes);
  }

  /** What code views' Vim takes: Lo's motions under their current keys, and the keymap's `vim` lines. */
  vimKeys(): readonly VimKey[] {
    const motions = this.live
      .filter((binding) => binding.command.vim === 'motion')
      .map((binding): VimKey => ({
        kind: 'motion',
        command: binding.command.id,
        keys: vimKeys(binding.strokes),
      }));
    const maps = this.keymap.lines.flatMap((line): VimKey[] =>
      line.kind === 'vim' ? [{ kind: 'map', mode: line.mode, keys: line.keys, to: line.to }] : [],
    );
    return [...motions, ...maps];
  }

  /** Applies a keymap file over the default keys, in place of the last one, and returns its errors. */
  setKeymap(text: string): readonly KeymapError[] {
    this.keymap = parseKeymap(text, (id) => this.byId.has(id));
    this.drop();
    this.bindings = this.rebuild();
    for (const listener of this.listeners) listener();
    return this.errors;
  }

  /** The current keymap file's errors, by line. */
  keymapErrors(): readonly KeymapError[] {
    return this.errors;
  }

  /** Calls `listener` when keys change. Returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Calls `listener` with a command's id each time one runs, however it was asked to: once its
   * handler has returned, and again once the promise it returned, if any, settles. Returns a
   * function that stops it.
   */
  onRun(listener: (id: string) => void): () => void {
    this.runs.add(listener);
    return () => {
      this.runs.delete(listener);
    };
  }

  /** Tells the run listeners that `id` ran, or finished running. */
  private ran(id: string): void {
    for (const listener of this.runs) {
      try {
        listener(id);
      } catch (error) {
        this.onError(error, this.byId.get(id));
      }
    }
  }

  /**
   * `true` if `id` can run on `target` now, or why not. `asKey` asks as `run`'s does: whether it
   * can run as its key would run it.
   */
  enabled(id: string, target: Target, asKey = false): true | string {
    const ready = this.prepare(id, target, asKey);
    return typeof ready === 'string' ? ready : true;
  }

  /** Whether a right-click menu on `target` lists `id`, as its handler's `listed` says. */
  listed(id: string, target: Target): boolean {
    const command = this.byId.get(id);
    const handler = command?.handler;
    if (this.off.has(id)) return false;
    if (!command || !handler?.listed) return command !== undefined;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return false;
    try {
      return handler.listed(fitted);
    } catch (error) {
      this.onError(error, command);
      return false;
    }
  }

  /**
   * Whether `id`, a toggle, is checked on `target` now, as its handler's `checked` says: `undefined`
   * for a command that isn't a toggle, or a target it can't take.
   */
  checked(id: string, target: Target): boolean | undefined {
    const command = this.byId.get(id);
    const handler = command?.handler;
    if (!command?.toggle || !handler?.checked) return undefined;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return undefined;
    try {
      return handler.checked(fitted);
    } catch (error) {
      this.onError(error, command);
      return undefined;
    }
  }

  /** What the palette says after `id`'s label on `target` now, as its handler's `detail` says. */
  detail(id: string, target: Target): string | undefined {
    const command = this.byId.get(id);
    const handler = command?.handler;
    if (!command || !handler?.detail) return undefined;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return undefined;
    try {
      return handler.detail(fitted);
    } catch (error) {
      this.onError(error, command);
      return undefined;
    }
  }

  /** What the palette calls `id` on `target` now, where its handler's `labelled` says. */
  labelled(id: string, target: Target): string | undefined {
    const command = this.byId.get(id);
    const handler = command?.handler;
    if (!command || !handler?.labelled) return undefined;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return undefined;
    try {
      return handler.labelled(fitted);
    } catch (error) {
      this.onError(error, command);
      return undefined;
    }
  }

  /** What a right-click menu calls `id` on `target` now, where its handler's `named` says. */
  named(id: string, target: Target): string | undefined {
    const command = this.byId.get(id);
    const handler = command?.handler;
    if (!command || !handler?.named) return undefined;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return undefined;
    try {
      return handler.named(fitted);
    } catch (error) {
      this.onError(error, command);
      return undefined;
    }
  }

  /**
   * Runs `id` on `target`, as a key, a menu or the palette asks, with the `count` typed before its
   * keys for a command that takes one: `true`, or why it didn't. A `jump` command records where the tab is in its
   * history first. A command that can't run is reported to `onRefused`, and a handler that throws
   * or rejects to `onError`, never thrown to the caller. `asKey` runs it as its key would, as the
   * key itself, the app menu and the palette ask: one of Lo's motions goes from the cursor, wherever
   * that is, a file's header as a line.
   */
  run(id: string, target: Target, count?: number, asKey = false): true | string {
    const ready = this.prepare(id, target, asKey);
    if (typeof ready === 'string') {
      this.onRefused?.(ready, id);
      return ready;
    }
    const { command, handler } = ready;
    if (command.jump) {
      const from = this.here?.();
      if (from) this.history.record(from);
    }
    try {
      const result = handler.run(ready.target, command.count === undefined ? undefined : count);
      if (result !== undefined) {
        result
          .catch((error: unknown) => {
            this.onError(error, command);
          })
          .finally(() => this.ran(id));
      }
    } catch (error) {
      this.onError(error, command);
    }
    this.ran(id);
    return true;
  }

  /**
   * What becomes of a keydown pressed at `place`. The listener stops the event unless it passes.
   * A code view that can't say its state is broken: Lo's chords still run there, and every other
   * key is dropped rather than handed to a Vim in a state nobody knows. `heard` is called once the
   * key is the reader's input, before any command it completes runs: at once for a key while no
   * sequence is pending, and otherwise only as the sequence ends, run, broken or dropped.
   */
  handle(press: KeyPress, place: KeyPlace, heard: () => void = () => {}): Handled {
    const time = this.now();
    const { source } = place.scope;
    this.active = isKeySource(source) ? source : undefined;
    let broken = false;
    const focus = (): Focus => {
      try {
        return this.focus(place);
      } catch (error) {
        if (!broken) this.onError(error, undefined);
        broken = true;
        return { scope: place.scope.name, text: true, view: { mode: 'insert', pending: true } };
      }
    };
    // This key tells for the pending sequence's keys, and its own, as the sequence ends. While one is
    // still pending after it, as after a key that starts or goes on with one, a held key repeating,
    // a modifier alone or a key the system's input method composes, it tells nothing yet.
    this.unheard = undefined;
    const tell = (): void => {
      if (this.pending) this.unheard = heard;
      else heard();
    };
    let seen = focus();
    let step = matchAny(this.bindings, this.pending, { ...press, time }, seen);
    if (step?.outcome.kind === 'replay') {
      this.replay(step.outcome.strokes, this.carriedTo(place, seen, time));
      // Vim has the held keys now, and may be in the middle of a command.
      seen = focus();
      step = matchAny(this.bindings, undefined, { ...press, time }, seen);
    }
    if (!step) {
      tell();
      return broken ? STOP : PASS;
    }
    this.pending = step.pending;
    this.tellHeld(seen.view?.count);
    const { outcome } = step;
    tell();
    switch (outcome.kind) {
      case 'hold':
        this.holder = place.scope.source;
        this.nowhere = place.nowhere === true;
        // In a code view held keys wait for the next however long it takes, as Vim's own do.
        if (isKeySource(source)) this.disarm();
        else this.arm();
        return STOP;
      case 'stop':
        this.settle();
        return STOP;
      case 'run': {
        this.settle();
        // The key is Lo's whatever happens next: it never falls through to the widget. A scope
        // that can't say what it acts on gives nothing, which a command that needs more refuses.
        let target: Target = NO_TARGET;
        if (!broken) {
          try {
            target = scopeTarget(place.scope);
          } catch (error) {
            this.onError(error, outcome.command);
          }
        }
        // A count Vim held is the command's now, and Vim drops it.
        if (outcome.count !== undefined && isKeySource(source)) this.clear(source);
        this.run(outcome.command.id, target, outcome.count, true);
        return STOP;
      }
      case 'arrow':
        this.settle();
        return outcome;
      case 'pass':
      case 'replay':
        // A second replay can't happen: nothing was pending the second time.
        this.settle();
        return broken ? STOP : PASS;
      default:
        outcome satisfies never;
        this.settle();
        return PASS;
    }
  }

  /**
   * Drops the pending sequence, as a press or a click does, and tells that its keys were the
   * reader's input.
   */
  drop(): void {
    const unheard = this.unheard;
    this.unheard = undefined;
    this.pending = undefined;
    this.holder = undefined;
    this.nowhere = false;
    this.disarm();
    this.tellHeld();
    unheard?.();
  }

  /**
   * Drops the pending sequence and whatever `left`, a code view focus is leaving, has Vim waiting
   * on, as the window's blur and a tab switch do.
   */
  leave(left: ScopeSource | undefined): void {
    this.drop();
    this.release(left);
  }

  /**
   * Focus moved to `place`, from `left` if that was a code view, whose Vim stops waiting. The
   * pending sequence is dropped, unless it was typed with focus nowhere in particular and goes on
   * in `place`: then it waits there. Keys are held across a focus move only when Lo makes it, as a
   * view that has drawn takes focus that was nowhere in particular, since the reader's click, key
   * or command from the app menu ends them first. So keys typed as a tab finishes loading count.
   * Keys typed on a control were typed there, and are dropped as focus leaves it.
   */
  focusMoved(place: KeyPlace, left: ScopeSource | undefined): void {
    if (!this.goesOn(place)) this.drop();
    this.release(left);
  }

  /** Whether the pending keys were typed with focus nowhere in particular, and go on at `place`. */
  private goesOn(place: KeyPlace): boolean {
    const { pending } = this;
    if (pending?.scope !== 'window' || !this.nowhere) return false;
    try {
      return this.bindings.find(pending.strokes, this.focus(place)).longer;
    } catch (error) {
      this.onError(error, undefined);
      return false;
    }
  }

  /** Drops whatever `left`, a code view focus is leaving, has Vim waiting on. */
  private release(left: ScopeSource | undefined): void {
    if (!isKeySource(left)) return;
    if (left === this.active) this.active = undefined;
    this.clear(left);
  }

  /** Drops whatever `view` has Vim waiting on. */
  private clear(view: KeySource): void {
    try {
      view.clearPending();
    } catch (error) {
      this.onError(error, undefined);
    }
  }

  /**
   * Switches to tab `id`: the pending sequence is dropped, the code view keys last went to stops
   * waiting, and `⌃o` walks the tab's history.
   */
  tab(id: string): void {
    this.leave(this.active);
    this.history.tab(id);
  }

  /** Whether a sequence is pending, for tests and the status bar. */
  isPending(): boolean {
    return this.pending !== undefined;
  }

  /**
   * The keys held for a command still to come, as the status bar shows them, after the count typed
   * before them, Vim's in a code view: `g`, `2y`, `3`. Empty while none are.
   */
  heldKeys(): string {
    return this.held;
  }

  /** Calls `listener` each time {@link heldKeys} changes. Returns a function that stops it. */
  onHeldKeys(listener: () => void): () => void {
    this.heldListeners.add(listener);
    return () => {
      this.heldListeners.delete(listener);
    };
  }

  /** Says the keys held now, after `count`, Vim's, if the pending keys have none of their own. */
  private tellHeld(count?: number): void {
    const { pending } = this;
    const held = pending
      ? `${pending.count ?? count ?? ''}${keyLabels(pending.strokes, this.system).join('')}`
      : '';
    if (held === this.held) return;
    this.held = held;
    for (const listener of this.heldListeners) listener();
  }

  private focus(place: KeyPlace): Focus {
    const { source, name } = place.scope;
    const editable = place.editable === true;
    if (isKeySource(source)) {
      // A field inside a code view, such as Vim's prompt, is typed into as insert mode is.
      if (place.text === 'field')
        return { scope: name, text: true, view: { mode: 'insert', pending: false }, editable };
      const { mode, pending, count, plain, target } = source.keyState();
      const on = (kind: TargetKind) => isOn(target, kind);
      return { scope: name, text: false, view: { mode, pending, count, plain }, on, editable };
    }
    // Asked only of a command that names what it acts on.
    const on = (kind: TargetKind) => isOn(scopeTarget(place.scope), kind);
    return { scope: name, text: place.text !== undefined, on, editable };
  }

  /**
   * Hands held keys back to the code view they were typed in, or to `carried`, the one keys typed
   * with focus nowhere in particular went on in, and forgets them.
   */
  private replay(strokes: readonly Stroke[], carried?: KeySource): void {
    const view = isKeySource(this.holder) ? this.holder : carried;
    this.drop();
    if (!view) return;
    try {
      view.passKeys(strokes.map(vimKey));
    } catch (error) {
      this.onError(error, undefined);
    }
  }

  /**
   * The code view at `place` that keys typed with focus nowhere in particular go to when the key
   * pressed there at `time` doesn't go on with them, as if they'd been typed there: typed there,
   * they'd have been held, and gone to its Vim as the sequence broke. Only where Vim takes keys as
   * commands, so never as text in insert mode, and not once their wait has run out, which drops
   * them wherever they are.
   */
  private carriedTo(place: KeyPlace, seen: Focus, time: number): KeySource | undefined {
    const { pending } = this;
    const { source } = place.scope;
    if (!this.nowhere || !pending || !isKeySource(source)) return undefined;
    if (seen.view === undefined || seen.view.mode === 'insert') return undefined;
    // Keys held outside a code view wait a second wherever they go on, as `match` has it.
    return time - pending.at < this.timeout ? source : undefined;
  }

  /** After the timeout, held keys outside a code view are dropped. */
  private arm(): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.pending) this.replay(this.pending.strokes);
    }, this.timeout);
  }

  private disarm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Forgets the holder and the timer once nothing is pending. */
  private settle(): void {
    if (this.pending) return;
    this.holder = undefined;
    this.nowhere = false;
    this.disarm();
  }

  private prepare(
    id: string,
    target: Target,
    asKey = false,
  ): { command: Command; handler: Handler; target: Target } | string {
    const command = this.byId.get(id);
    if (!command) return `There’s no command called ${id}.`;
    // Out of the app, it has nothing to say: no toast says why nothing happened.
    if (this.off.has(id)) return '';
    const { handler } = command;
    if (!handler) {
      return command.editor
        ? `${command.label} is its editor’s own key.`
        : `${command.label} is Vim’s.`;
    }
    // A motion's key moves the cursor from a header as from a line, as Vim runs it, and so does
    // what stands in for its key: what it's declared to act on is where a right-click menu offers it.
    const fromHeader = asKey && command.vim === 'motion' && target.kind === 'header';
    const fitted = fit(command.targets ?? ['none'], target) ?? (fromHeader ? target : undefined);
    if (!fitted) return `${command.label} doesn’t apply here.`;
    let enabled: true | string;
    try {
      enabled = handler.enabled?.(fitted) ?? true;
    } catch (error) {
      this.onError(error, command);
      return `${command.label} failed.`;
    }
    return enabled === true ? { command, handler, target: fitted } : enabled;
  }

  /** The bindings in effect: the defaults for this system, then each keymap line in order. */
  private rebuild(): Bindings {
    const defaults = declaredBindings(this.list, this.system);
    const applied = applyKeymap(defaults, this.keymap.lines, this.byId, this.system);
    this.live = applied.bindings.filter((binding) => !this.off.has(binding.command.id));
    this.errors = [...this.keymap.errors, ...applied.errors].toSorted((a, b) => a.line - b.line);
    return new Bindings(this.system, this.live, this.timeout);
  }
}

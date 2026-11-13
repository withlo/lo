// The registry: the window's commands, the keys bound to them (the defaults, with the keymap file's
// lines over them), the pending sequence, and each tab's history. Keys reach it through the
// listener; the palette, menus and the app menu run commands through `run`.

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
import { vimKey, vimKeys, type Stroke, type System } from './notation.ts';
import {
  isKeySource,
  scopeTarget,
  type FoundScope,
  type KeySource,
  type ScopeSource,
  type TextKind,
  type VimKey,
} from './scopes.ts';
import { fit, NO_TARGET, type Target } from './targets.ts';

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
  private readonly byId = new Map<string, Command>();
  private readonly here: (() => Entry | undefined) | undefined;
  private readonly timeout: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown, command: Command | undefined) => void;
  private readonly onRefused: ((reason: string, id: string) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private keymap: Keymap = { lines: [], errors: [] };
  /** The keymap's errors: its lines that can't be read, then those that don't apply. */
  private errors: readonly KeymapError[] = [];
  /** Every binding in effect, in order of precedence. */
  private live: readonly Binding[] = [];
  private bindings: Bindings;
  private pending: Pending | undefined;
  /** The scope's source the pending keys were typed in. */
  private holder: ScopeSource | undefined;
  /** The code view the last key was pressed in, whose Vim a tab switch leaves. */
  private active: KeySource | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RegistryOptions) {
    this.system = options.system;
    this.list = options.commands;
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

  /** Every command, in the order given. */
  commands(): readonly Command[] {
    return this.list;
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

  /** `true` if `id` can run on `target` now, or why not. */
  enabled(id: string, target: Target): true | string {
    const ready = this.prepare(id, target);
    return typeof ready === 'string' ? ready : true;
  }

  /** Whether a right-click menu on `target` lists `id`, as its handler's `listed` says. */
  listed(id: string, target: Target): boolean {
    const command = this.byId.get(id);
    const handler = command?.handler;
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
   * Runs `id` on `target`, as a key, a menu or the palette asks, `count` times for a command that
   * takes a count: `true`, or why it didn't. A `jump` command records where the tab is in its
   * history first. A command that can't run is reported to `onRefused`, and a handler that throws
   * or rejects to `onError`, never thrown to the caller.
   */
  run(id: string, target: Target, count = 1): true | string {
    const ready = this.prepare(id, target);
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
      const result = handler.run(ready.target, command.count === undefined ? 1 : count);
      if (result !== undefined) {
        result.catch((error: unknown) => {
          this.onError(error, command);
        });
      }
    } catch (error) {
      this.onError(error, command);
    }
    return true;
  }

  /**
   * What becomes of a keydown pressed at `place`. The listener stops the event unless it passes.
   * A code view that can't say its state is broken: Lo's chords still run there, and every other
   * key is dropped rather than handed to a Vim in a state nobody knows.
   */
  handle(press: KeyPress, place: KeyPlace): Handled {
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
    let step = matchAny(this.bindings, this.pending, { ...press, time }, focus());
    if (step?.outcome.kind === 'replay') {
      this.replay(step.outcome.strokes);
      // Vim has the held keys now, and may be in the middle of a command.
      step = matchAny(this.bindings, undefined, { ...press, time }, focus());
    }
    if (!step) return broken ? STOP : PASS;
    this.pending = step.pending;
    const { outcome } = step;
    switch (outcome.kind) {
      case 'hold':
        this.holder = place.scope.source;
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
        this.run(outcome.command.id, target, outcome.count);
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

  /** Drops the pending sequence, as a pointer down does. */
  drop(): void {
    this.pending = undefined;
    this.holder = undefined;
    this.disarm();
  }

  /**
   * Drops the pending sequence and whatever `left`, a code view focus is leaving, has Vim waiting
   * on, as a focus change and the window's blur do.
   */
  leave(left: ScopeSource | undefined): void {
    this.drop();
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

  private focus(place: KeyPlace): Focus {
    const { source, name } = place.scope;
    if (isKeySource(source)) {
      // A field inside a code view, such as Vim's prompt, is typed into as insert mode is.
      if (place.text === 'field')
        return { scope: name, text: true, view: { mode: 'insert', pending: false } };
      const { mode, pending, count } = source.keyState();
      return { scope: name, text: false, view: { mode, pending, count } };
    }
    return { scope: name, text: place.text !== undefined };
  }

  /** Hands held keys back to the code view they were typed in, and forgets them. */
  private replay(strokes: readonly Stroke[]): void {
    const holder = this.holder;
    this.drop();
    if (!isKeySource(holder)) return;
    try {
      holder.passKeys(strokes.map(vimKey));
    } catch (error) {
      this.onError(error, undefined);
    }
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
    this.disarm();
  }

  private prepare(
    id: string,
    target: Target,
  ): { command: Command; handler: Handler; target: Target } | string {
    const command = this.byId.get(id);
    if (!command) return `There's no command called ${id}.`;
    const { handler } = command;
    if (!handler) return `${command.label} is Vim's.`;
    const fitted = fit(command.targets ?? ['none'], target);
    if (!fitted) return `${command.label} doesn't apply here.`;
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
    this.live = applied.bindings;
    this.errors = [...this.keymap.errors, ...applied.errors].toSorted((a, b) => a.line - b.line);
    return new Bindings(this.system, applied.bindings, this.timeout);
  }
}

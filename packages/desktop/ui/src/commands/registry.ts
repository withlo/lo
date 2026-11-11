// The registry: the window's commands, the keys bound to them (the defaults, with the keymap file's
// lines over them), the pending sequence, and each tab's history. Keys reach it through the
// listener; the palette, menus and the app menu run commands through `run`.

import type { Command, Handler } from './declare.ts';
import { History, type Entry } from './history.ts';
import { parseKeymap, type Keymap, type KeymapError } from './keymap.ts';
import {
  Bindings,
  declaredBindings,
  match,
  SEQUENCE_TIMEOUT,
  type Binding,
  type Focus,
  type Pending,
} from './match.ts';
import { systemStrokes, vimKey, vimKeys, type Stroke, type System } from './notation.ts';
import {
  isKeySource,
  scopeTarget,
  type FoundScope,
  type ScopeSource,
  type VimKey,
} from './scopes.ts';
import { fit, type Target } from './targets.ts';

export interface RegistryOptions {
  readonly system: System;
  /** Every command, with its handler. */
  readonly commands: readonly Command[];
  /** Where the tab is now: the place a `jump` command records before it runs. */
  readonly here?: () => Entry | undefined;
  /** How long a held key waits for the rest of its sequence, in ms. */
  readonly timeout?: number;
  /** A clock in ms, for timing sequences. */
  readonly now?: () => number;
  /** A handler threw or rejected. Without it, the error is logged. */
  readonly onError?: (error: unknown, command: Command) => void;
}

/** A keydown, as the listener reads it. */
export interface KeyPress {
  readonly stroke: Stroke;
  readonly repeat: boolean;
  readonly composing: boolean;
}

/** Where a key was pressed: its scope, and whether a text field has focus. */
export interface KeyPlace {
  readonly scope: FoundScope;
  readonly text: boolean;
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
  private readonly onError: (error: unknown, command: Command) => void;
  private readonly listeners = new Set<() => void>();
  private keymap: Keymap = { lines: [], errors: [] };
  /** Every binding in effect, in order of precedence. */
  private live: readonly Binding[] = [];
  private bindings: Bindings;
  private pending: Pending | undefined;
  /** The scope's source the pending keys were typed in. */
  private holder: ScopeSource | undefined;
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
        console.error(`${command.id} failed:`, error);
      });
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
    return this.keymap.errors;
  }

  /** The current keymap file's errors. */
  keymapErrors(): readonly KeymapError[] {
    return this.keymap.errors;
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

  /**
   * Runs `id` on `target`, as a key, a menu or the palette asks: `true`, or why it didn't. A
   * `jump` command records where the tab is in its history first. A handler that throws or
   * rejects is reported, never thrown to the caller.
   */
  run(id: string, target: Target): true | string {
    const ready = this.prepare(id, target);
    if (typeof ready === 'string') return ready;
    const { command, handler } = ready;
    if (command.jump) {
      const from = this.here?.();
      if (from) this.history.record(from);
    }
    try {
      const result = handler.run(ready.target);
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

  /** What becomes of a keydown pressed at `place`. The listener stops the event unless it passes. */
  handle(press: KeyPress, place: KeyPlace): Handled {
    const time = this.now();
    let step = match(this.bindings, this.pending, { ...press, time }, this.focus(place));
    if (step.outcome.kind === 'replay') {
      this.replay(step.outcome.strokes);
      // Vim has the held keys now, and may be in the middle of a command.
      step = match(this.bindings, undefined, { ...press, time }, this.focus(place));
    }
    this.pending = step.pending;
    const { outcome } = step;
    switch (outcome.kind) {
      case 'hold':
        this.holder = place.scope.source;
        this.arm();
        return STOP;
      case 'stop':
        this.settle();
        return STOP;
      case 'run': {
        this.settle();
        // The key is Lo's whatever happens next: it never falls through to the widget.
        let target: Target;
        try {
          target = scopeTarget(place.scope);
        } catch (error) {
          this.onError(error, outcome.command);
          return STOP;
        }
        this.run(outcome.command.id, target);
        return STOP;
      }
      case 'arrow':
        this.settle();
        return outcome;
      case 'pass':
      case 'replay':
        // A second replay can't happen: nothing was pending the second time.
        this.settle();
        return PASS;
      default:
        outcome satisfies never;
        this.settle();
        return PASS;
    }
  }

  /** Drops the pending sequence, as a focus change, a pointer down or the window's blur do. */
  drop(): void {
    this.pending = undefined;
    this.holder = undefined;
    this.disarm();
  }

  /** Switches to tab `id`: the pending sequence is dropped and `⌃o` walks the tab's history. */
  tab(id: string): void {
    this.drop();
    this.history.tab(id);
  }

  /** Whether a sequence is pending, for tests and the status bar. */
  isPending(): boolean {
    return this.pending !== undefined;
  }

  private focus(place: KeyPlace): Focus {
    const { source } = place.scope;
    if (isKeySource(source)) {
      const { mode, pending } = source.keyState();
      return { scope: place.scope.name, text: false, view: { mode, pending } };
    }
    return { scope: place.scope.name, text: place.text };
  }

  /** Hands held keys back to the code view they were typed in, and forgets them. */
  private replay(strokes: readonly Stroke[]): void {
    const holder = this.holder;
    this.drop();
    if (isKeySource(holder)) holder.passKeys(strokes.map(vimKey));
  }

  /** After the timeout, the held keys go to the code view, as Vim's do after its `timeoutlen`. */
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
    let live = declaredBindings(this.list, this.system);
    for (const line of this.keymap.lines) {
      if (line.kind === 'vim') continue;
      const strokes = systemStrokes(line.keys, this.system);
      if (line.kind === 'bind') {
        const command = this.byId.get(line.command);
        if (command) live = [{ command, strokes }, ...live];
      } else {
        live = live.filter(
          (binding) =>
            !sameStrokes(binding.strokes, strokes) ||
            (line.command !== undefined && binding.command.id !== line.command),
        );
      }
    }
    this.live = live;
    return new Bindings(this.system, live, this.timeout);
  }
}

function sameStrokes(a: readonly Stroke[], b: readonly Stroke[]): boolean {
  return a.length === b.length && a.every((each, index) => each.id === b[index]?.id);
}

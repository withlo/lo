// A command's control: what a button, a mark in a gutter or a ball needs to stand for a command
// where its target is drawn. Every action has a key and a visible control, and the control is the
// command's: it shows the command's label and its key as they are now, says why it can't run when
// it can't, and runs it as its key does, through the registry the window's keys go through.

import { liveKeys, liveShortcut } from './help.ts';
import type { Registry } from './registry.ts';
import { NO_TARGET, type Target } from './targets.ts';

let held: Registry | undefined;

/**
 * Holds `registry` as the one the window's controls run their commands through, as `listen` does
 * for the registry its keys go through. Returns a function that lets it go.
 */
export function holdRegistry(registry: Registry): () => void {
  held = registry;
  return () => {
    if (held === registry) held = undefined;
  };
}

/** The registry the window's controls run their commands through, once its keys are listened for. */
export function heldRegistry(): Registry | undefined {
  return held;
}

/** What a control shows of the command it runs. */
export interface CommandControl {
  readonly id: string;
  /**
   * The command's label, which names the control: what the palette calls it on the control's
   * target now (its handler's `labelled`), as "Add account…" once an account is listed.
   */
  readonly label: string;
  /** Its first key now, as labels in this system's form, if it has one. */
  readonly keys: readonly string[] | undefined;
  /** That key as `aria-keyshortcuts` says it, if it's one key or a chord. */
  readonly shortcut: string | undefined;
  /** Why it can't run on its target now, which dims the control and is its tooltip. */
  readonly off: string | undefined;
}

/**
 * What a control for command `id` on `target` shows now: nothing for a command the registry
 * doesn't have, or before any registry is held.
 */
export function controlOf(
  id: string,
  target: Target = NO_TARGET,
  registry: Registry | undefined = held,
): CommandControl | undefined {
  const command = registry?.command(id);
  if (!registry || !command) return undefined;
  const ready = registry.enabled(id, target);
  return {
    id,
    label: registry.labelled(id, target) ?? command.label,
    keys: liveKeys(registry, command)[0],
    shortcut: liveShortcut(registry, command),
    off: ready === true ? undefined : ready,
  };
}

/**
 * Runs command `id` on `target` for a control, as its key would: `true`, or why it didn't, which
 * the registry has reported as it does a key's refusal.
 */
export function runControl(
  id: string,
  target: Target = NO_TARGET,
  registry: Registry | undefined = held,
): true | string {
  return registry?.run(id, target) ?? `There’s no command called ${id}.`;
}

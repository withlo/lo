import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { controlOf, heldRegistry, runControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';
import { Key, keyAria } from './Key.tsx';

export interface HintButtonProps {
  /** The command it runs, by its id: `comments.reply`. */
  command: string;
  /** What it runs on, as a key pressed there would: nothing in particular by default. */
  target?: Target | undefined;
  /** Its words, where the command's label isn't what the row says. */
  children?: ReactNode;
}

/** How many times the keys have changed, which draws each hint again. */
let changes = 0;

const subscribe = (listener: () => void): (() => void) =>
  heldRegistry()?.subscribe(() => {
    changes += 1;
    listener();
  }) ?? (() => undefined);

/**
 * A hint that's a button: a command's label and its key, which runs the command when clicked.
 * Every row of key hints is made of these, so no hint is only text and every key shown can be
 * clicked. The label, the key and whether it can run come from the registry, so a hint never
 * shows a key the keymap file has moved. While its command can't run it's dimmed, with the reason
 * as its tooltip. It draws nothing for a command that isn't there.
 */
export function HintButton({ command, target, children }: HintButtonProps) {
  // Drawn again when the keymap changes.
  useSyncExternalStore(
    subscribe,
    () => changes,
    () => 0,
  );
  const why = useId();
  const control = controlOf(command, target);
  if (!control) return null;
  const off = control.off !== undefined;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={off || undefined}
        aria-describedby={off ? why : undefined}
        hint={control.off}
        {...keyAria(control.keys, control.shortcut)}
        onClick={() => {
          if (!off) runControl(command, target);
        }}
      >
        {children ?? control.label}
        {control.keys && <Key keys={control.keys} quiet decorative />}
      </Button>
      {off && (
        <span id={why} className="sr-only">
          {control.off}
        </span>
      )}
    </>
  );
}

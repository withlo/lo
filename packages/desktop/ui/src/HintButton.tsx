import { useId, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { controlOf, heldRegistry, runControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';
import { useHintsSqueezed } from './HintRow.tsx';
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
 * as its tooltip. In a `HintRow` too narrow for its key chips, its key is in its tooltip, with its
 * command's label. A click leaves focus where it was, on what the key acts on. It draws nothing
 * for a command that isn't there.
 */
export function HintButton({ command, target, children }: HintButtonProps) {
  // Drawn again when the keymap changes.
  useSyncExternalStore(
    subscribe,
    () => changes,
    () => 0,
  );
  const why = useId();
  const squeezed = useHintsSqueezed();
  const control = controlOf(command, target);
  if (!control) return null;
  const off = control.off !== undefined;
  // One tooltip throughout, with nothing to say while its chip shows, so it stays one element.
  const keyTip = squeezed && !off && control.keys !== undefined;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={off || undefined}
        aria-describedby={off ? why : undefined}
        hint={control.off ?? (keyTip ? control.label : null)}
        hintKeys={keyTip ? control.keys : undefined}
        {...keyAria(control.keys, control.shortcut)}
        // A click leaves focus where the key works, so the keys beside it go on working.
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
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

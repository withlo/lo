import { useId, type ReactNode } from 'react';

import { Button, type ButtonProps } from './Button.tsx';
import { runControl } from './commands/control.ts';
import { NO_TARGET, type Target } from './commands/targets.ts';
import { Ticks } from './Ticks.tsx';
import { useControl } from './useControl.ts';

export interface CommandButtonProps extends Omit<
  ButtonProps,
  'onClick' | 'hint' | 'hintKeys' | 'hintShortcut' | 'disabled'
> {
  /** The command it runs, by its id: `keys.help`. */
  command: string;
  /** What it runs the command on, where the button stands for one thing: a tab's servers, say. */
  target?: Target | undefined;
  /** Its words, where it says it shorter than the command's label: "Open". */
  children?: ReactNode;
  /**
   * Its tooltip's words, where they aren't the command's label: the button that turns a switch off,
   * as "Show whitespace changes" does "Hide whitespace changes".
   */
  hint?: string | undefined;
}

/**
 * A button for a command, where its key doesn't work, as in Settings or a status item's details:
 * it runs the command as its key does, gives the command's label and key in its tooltip, and while
 * the command can't run it's dimmed with the reason. A button whose words are the command's label,
 * for a command with no key, has no tooltip while it can run: it would only say its words again.
 * It follows the keymap file, and draws nothing for a command that isn't there.
 */
export function CommandButton({
  command,
  target = NO_TARGET,
  children,
  hint,
  ...button
}: CommandButtonProps) {
  const why = useId();
  const control = useControl(command, target);
  if (!control) return null;
  const { off } = control;
  // What its tooltip says: why it can't run, or the command's label with its key, or the words of
  // its own `hint`, or the label in full beside words of its own. Nothing, where it says the label.
  const ownWords = hint !== undefined || (children !== undefined && children !== control.label);
  const tip = off ?? (ownWords || control.keys !== undefined ? (hint ?? control.label) : null);
  return (
    <>
      <Button
        {...button}
        disabled={off !== undefined}
        aria-describedby={off ? why : undefined}
        hint={tip === null ? null : <Ticks text={tip} />}
        hintKeys={off === undefined ? control.keys : undefined}
        hintShortcut={off === undefined ? control.shortcut : undefined}
        onClick={() => runControl(command, target)}
      >
        {children ?? <Ticks text={control.label} />}
      </Button>
      {off && (
        <span id={why} className="sr-only">
          {off}
        </span>
      )}
    </>
  );
}

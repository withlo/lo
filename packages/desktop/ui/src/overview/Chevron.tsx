// The chevron that folds and unfolds what it's beside: a term's row, an overview's section. It's
// the command's control, as every control is: its name is what the command would do there now
// ("Expand term", then "Collapse term"), its tooltip that and the command's key, and while the
// command can't run it's dimmed, with why. It turns 90° while what it folds is open.

import { Button } from '../Button.tsx';
import { runControl } from '../commands/control.ts';
import { UNFOCUSABLE } from '../focus.ts';
import { Icon } from '../Icon.tsx';
import { useControl } from '../useControl.ts';
import type { TermHint } from './TermCard.tsx';

export interface ChevronProps {
  /** The command that folds and unfolds it, by its id, and what it runs on. */
  command: Pick<TermHint, 'command' | 'target'>;
  /** What it folds is open: it's turned down. */
  open: boolean;
  /** The element it folds, by its id. */
  controls?: string | undefined;
  /**
   * `false` where what it's beside takes the key, as a term's row's term does: it's out of the tab
   * order, and a click leaves focus where it was.
   */
  focusable?: boolean | undefined;
}

/** The chevron of a fold the command `command` opens and closes. Nothing for a command not there. */
export function Chevron({ command, open, controls, focusable = true }: ChevronProps) {
  const control = useControl(command.command, command.target);
  if (control === undefined) return null;
  const off = control.off !== undefined;
  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-label={control.label}
      aria-expanded={open}
      aria-controls={controls}
      disabled={off}
      hint={control.off ?? control.label}
      hintKeys={off ? undefined : control.keys}
      hintShortcut={off ? undefined : control.shortcut}
      {...(focusable ? {} : UNFOCUSABLE)}
      onClick={() => runControl(command.command, command.target)}
    >
      <Icon
        name="chevron-right"
        size={16}
        className={`transition-transform ease-out ${open ? 'rotate-90' : ''}`}
      />
    </Button>
  );
}

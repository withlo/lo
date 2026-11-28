import { useId, type MouseEvent, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { runControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';
import { useHintsSqueezed } from './HintRow.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Key, keyAria } from './Key.tsx';
import { useControl } from './useControl.ts';

export interface HintButtonProps {
  /** The command it runs, by its id: `comments.reply`. */
  command: string;
  /** What it runs on, as a key pressed there would: nothing in particular by default. */
  target?: Target | undefined;
  /** Its words, where the command's label isn't what the row says. */
  children?: ReactNode;
  /**
   * For a button in a head that gives up what it draws as it narrows (`useGiveUp`): the icon its
   * words give way to at `labels`, when it's the small control's square, with its label and key as
   * its tooltip throughout.
   */
  icon?: IconName | undefined;
  /**
   * `focus` for a button every card repeats: its key chip shows only on the one the keyboard is on
   * (`Key`'s `when`).
   */
  keyWhen?: 'always' | 'focus' | undefined;
}

/**
 * A hint that's a button: a command's label and its key, which runs the command when clicked.
 * Every row of key hints is made of these, so no hint is only text and every key shown can be
 * clicked. The label, the key and whether it can run come from the registry, so a hint never
 * shows a key the keymap file has moved. While its command can't run it's dimmed, with the reason
 * as its tooltip, or none for an empty reason, where the dimmed label says it all. In a `HintRow` too narrow for its key chips, its key is in its tooltip, with its
 * command's label. A click leaves focus where it was, on what the key acts on. It draws nothing
 * for a command that isn't there.
 */
export function HintButton({ command, target, children, icon, keyWhen }: HintButtonProps) {
  const why = useId();
  const squeezed = useHintsSqueezed();
  const control = useControl(command, target);
  // Every hook comes before this: a command can come and go while its hint is drawn.
  if (!control) return null;
  const off = control.off !== undefined;
  // One tooltip throughout, with nothing to say while its chip shows, so it stays one element.
  const keyTip = (squeezed || icon !== undefined) && !off && control.keys !== undefined;
  const words = children ?? control.label;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-squares={icon === undefined ? undefined : 'labels'}
        // Its words can go: its name stays.
        aria-label={icon === undefined || typeof words !== 'string' ? undefined : words}
        aria-disabled={off || undefined}
        aria-describedby={control.off ? why : undefined}
        hint={control.off || (keyTip || icon !== undefined ? control.label : null)}
        hintKeys={keyTip ? control.keys : undefined}
        {...keyAria(control.keys, control.shortcut)}
        // A click leaves focus where the key works, so the keys beside it go on working.
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        onClick={() => {
          if (!off) runControl(command, target);
        }}
      >
        {icon === undefined ? (
          words
        ) : (
          <>
            <span data-takes="labels" className="inline-flex">
              <Icon name={icon} size={16} />
            </span>
            <span data-gives="labels">{words}</span>
          </>
        )}
        {control.keys && <Key keys={control.keys} quiet decorative when={keyWhen} />}
      </Button>
      {control.off && (
        <span id={why} className="sr-only">
          {control.off}
        </span>
      )}
    </>
  );
}

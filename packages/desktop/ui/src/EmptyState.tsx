import { useId, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { runControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';
import { Key, keyAria } from './Key.tsx';
import { useControl } from './useControl.ts';

/** One of an empty state's buttons: a command, by its id, or with what it runs on and its words. */
export type EmptyAction =
  | string
  | {
      /** The command it runs, by its id: `open.box`. */
      readonly command: string;
      /** What it runs on, as a key pressed there would: nothing in particular by default. */
      readonly target?: Target | undefined;
      /** Its words, where the command's label isn't what the view says. */
      readonly label?: ReactNode;
    };

export interface EmptyStateProps {
  /** What's absent, in six words at most, with no full stop: "No pull requests yet". */
  title: ReactNode;
  /** One line: what will be listed here, or why there's nothing. */
  line?: ReactNode;
  /**
   * What to do about it: two commands at most, the first drawn as the main button. Each takes its
   * label, its key and whether it can run from the registry, as every control does.
   */
  actions?: readonly [] | readonly [EmptyAction] | readonly [EmptyAction, EmptyAction] | undefined;
}

function EmptyButton({ action, primary }: { action: EmptyAction; primary: boolean }) {
  const { command, target, label } =
    typeof action === 'string' ? { command: action, target: undefined, label: undefined } : action;
  const why = useId();
  const control = useControl(command, target);
  if (!control) return null;
  const off = control.off !== undefined;
  return (
    <>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        aria-disabled={off || undefined}
        aria-describedby={off ? why : undefined}
        hint={control.off ?? null}
        {...keyAria(control.keys, control.shortcut)}
        onClick={() => {
          if (!off) runControl(command, target);
        }}
      >
        {label ?? control.label}
        {control.keys && (
          <Key
            keys={control.keys}
            decorative
            className={primary && !off ? 'text-on-accent' : undefined}
          />
        )}
      </Button>
      {off && (
        <span id={why} className="sr-only">
          {control.off}
        </span>
      )}
    </>
  );
}

/**
 * A view or a list with nothing in it, in one shape wherever it shows: what's absent as a heading,
 * one line, and up to two buttons that do something about it here. With `Loading` and `Problem`
 * it's one of the three things a view shows in place of its content. The buttons are commands, so
 * each shows its key and follows the keymap file; a state never says where else an action lives.
 * It fills the view it's in.
 */
export function EmptyState({ title, line, actions }: EmptyStateProps) {
  const shown: readonly EmptyAction[] = actions ?? [];
  return (
    <div className="flex h-full min-w-0 flex-col items-center justify-center gap-16 p-32 text-center">
      <div className="flex max-w-read-measure flex-col gap-6">
        <h2 className="m-0 text-balance text-heading">{title}</h2>
        {line !== undefined && <p className="m-0 text-fg-muted text-ui">{line}</p>}
      </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-8">
          {shown.map((action, index) => (
            <EmptyButton
              key={typeof action === 'string' ? action : action.command}
              action={action}
              primary={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

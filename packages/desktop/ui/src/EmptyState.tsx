import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Button } from './Button.tsx';
import { runControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';
import { CopyFaces, CopyStatus, type CopySaid } from './CopyButton.tsx';
import { handOffFocus } from './focus.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Key, keyAria } from './Key.tsx';
import { Tooltip } from './Tooltip.tsx';
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
      /**
       * Whether what it started is still under way, as the view knows: it then says `working` at
       * the width it had, and pressing it does nothing until it's done, as a busy `Button` does.
       * Pass `false` while it rests, not nothing, so it holds room for both.
       */
      readonly busy?: boolean | undefined;
      /** What it says while busy, the verb of its label: "Checking…" for "Check again". */
      readonly working?: ReactNode;
      /**
       * For one that copies: what its last copy came to, from `useCopySaid`, or `null` while it
       * rests. It reads "Copied" or "Couldn’t copy" for two seconds, as wide as its label
       * throughout, as every Copy button does. The view says so, since its key copies too.
       */
      readonly copied?: CopySaid | null | undefined;
    };

/**
 * Where an empty state sits, which sets its shape: `view`, a tab's or the sheet's whole content;
 * `panel`, a side panel or a pane beside the code; `list`, a list's place in a page, as in
 * Settings; `row`, one of a popup's or a table's rows.
 */
export type EmptyFit = 'view' | 'panel' | 'list' | 'row';

export interface EmptyStateProps {
  /**
   * What's absent, by its icon's name in `icons.ts`: `search-x` for a search with nothing left,
   * `funnel-x` for a filter.
   */
  icon: IconName;
  /** What's absent, in six words at most, with no full stop: "No pull requests yet". */
  title: ReactNode;
  /**
   * Where it sits: `view` (the default) and `panel` fill their box and centre a column; `list`
   * sits in the flow, top- and left-aligned; `row` is one of its list's rows, its title alone.
   */
  fit?: EmptyFit | undefined;
  /** One line: what will be listed here, or why there's nothing. Not in a `row`. */
  line?: ReactNode;
  /**
   * What to do about it: two commands at most. In a `view` the first is drawn as the main button;
   * elsewhere each is a small one. Each takes its label, its key and whether it can run from the
   * registry, as every control does. Not in a `row`.
   */
  actions?: readonly [] | readonly [EmptyAction] | readonly [EmptyAction, EmptyAction] | undefined;
  /**
   * What its actions act on, between the line and the buttons: the prompt Copy prompt copies, as
   * code. Never more words. Not in a `row`.
   */
  children?: ReactNode;
}

/** How a button is drawn: the main one, or a secondary one at full size or small. */
type ButtonFace = 'primary' | 'secondary' | 'small';

function EmptyButton({ action, face }: { action: EmptyAction; face: ButtonFace }) {
  const { command, target, label, busy, working, copied } =
    typeof action === 'string' ? { command: action } : action;
  const why = useId();
  const control = useControl(command, target);
  if (!control) return null;
  const off = control.off !== undefined;
  const words = label ?? control.label;
  const primary = face === 'primary';
  return (
    <>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size={face === 'small' ? 'sm' : 'md'}
        aria-disabled={off || undefined}
        aria-describedby={off ? why : undefined}
        hint={control.off ?? null}
        busy={busy}
        working={working}
        {...keyAria(control.keys, control.shortcut)}
        onClick={() => {
          if (!off) runControl(command, target);
        }}
      >
        {copied === undefined ? words : <CopyFaces said={copied ?? undefined}>{words}</CopyFaces>}
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
      {copied !== undefined && <CopyStatus said={copied ?? undefined} />}
    </>
  );
}

/**
 * The buttons: in a view the first is the main one, and elsewhere each is a small one. As they go
 * with focus in them, as when their box drops under 160 px, focus goes to `box`, the state's own,
 * else to the scope around it, so it doesn't fall to the page.
 */
function Buttons({
  actions,
  fit,
  box,
  className,
}: {
  actions: readonly EmptyAction[];
  fit: EmptyFit;
  box: RefObject<HTMLDivElement | null>;
  className: string;
}) {
  const self = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const buttons = self.current;
    return () =>
      handOffFocus([buttons], () => [
        box.current,
        box.current?.closest<HTMLElement>('[data-lo-scope]'),
      ]);
  }, [box]);
  return (
    <div ref={self} className={className}>
      {/* By place: two buttons may run one command, on different targets. */}
      {actions.map((action, index) => (
        <EmptyButton
          key={index}
          action={action}
          face={fit === 'view' ? (index === 0 ? 'primary' : 'secondary') : 'small'}
        />
      ))}
    </div>
  );
}

/**
 * The narrowest box, in px, a view's or a panel's empty state draws its words in: in a narrower
 * one, it's its icon alone.
 */
const NARROWEST = 160;

/**
 * Whether `box` is narrower than {@link NARROWEST}, as it's laid out now and each time it's resized.
 * A box that isn't laid out, as a hidden view's, keeps what it was.
 */
function useNarrow(box: RefObject<HTMLElement | null>, watch: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (!watch || !element || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      if (width > 0) setNarrow(width < NARROWEST);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, watch]);
  return watch && narrow;
}

/**
 * A view or a list with nothing in it, in one quiet shape wherever it shows: an icon for what's
 * absent, its title in body text, one line, and buttons only where there's something to do here.
 * With `Loading` and `Problem` it's one of the three things a view shows in place of its content.
 * The buttons are commands, so each shows its key and follows the keymap file; a state never says
 * where else an action lives. Its title is never a heading.
 *
 * A `view` or a `panel` fills its box and centres itself in it, and scrolls where the box is too
 * short for it; in a box under 160 px wide it's its icon alone, its title in its tooltip, and its
 * buttons' keys still work. A `list` sits in the flow. A `row` is one of its list's rows, which
 * gives it its height and inset.
 */
export function EmptyState({
  icon,
  title,
  fit = 'view',
  line,
  actions,
  children,
}: EmptyStateProps) {
  const box = useRef<HTMLDivElement>(null);
  const named = useId();
  const narrow = useNarrow(box, fit === 'view' || fit === 'panel');
  const shown: readonly EmptyAction[] = actions ?? [];
  const holds =
    children !== undefined && children !== null && children !== false && children !== '';

  if (fit === 'row') {
    return (
      <div
        data-lo-empty={fit}
        className="flex min-w-0 items-center gap-8 text-start text-fg-muted text-ui"
      >
        <Icon name={icon} size={14} className="text-icon-muted" />
        {/* One line, cut short where the row is too narrow, and whole in its tooltip then. */}
        <Tooltip label={title} cut>
          <span className="min-w-0 truncate">{title}</span>
        </Tooltip>
      </div>
    );
  }

  if (fit === 'list') {
    // The row is the container its buttons go under its text in, when it's narrow.
    return (
      <div ref={box} data-lo-empty={fit} className="@container min-w-0">
        <div className="empty-list px-16 py-12 text-start">
          <Icon name={icon} size={16} className="text-icon-muted" />
          <div className="flex min-w-0 flex-col">
            <p className="m-0 text-fg-muted text-ui">{title}</p>
            {line !== undefined && <p className="m-0 text-fg-subtle text-small">{line}</p>}
          </div>
          {shown.length > 0 && (
            <Buttons
              actions={shown}
              fit={fit}
              box={box}
              className="empty-list-actions flex flex-wrap items-center gap-8"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={box}
      data-lo-empty={fit}
      className={`flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center-safe overflow-auto text-center ${fit === 'view' ? 'p-24' : 'p-16'}`}
    >
      {narrow ? (
        // Too narrow for its words: the icon, named by the title, which its tooltip shows.
        <>
          <Tooltip label={title}>
            <span role="img" aria-labelledby={named} className="flex flex-none">
              <Icon name={icon} size={24} className="text-icon-muted" />
            </span>
          </Tooltip>
          <span id={named} hidden>
            {title}
          </span>
        </>
      ) : (
        <>
          <Icon name={icon} size={24} className="text-icon-muted" />
          <div className="mt-12 flex max-w-empty-measure flex-col gap-4">
            <p className="m-0 text-balance text-fg-muted text-ui">{title}</p>
            {line !== undefined && <p className="m-0 text-fg-subtle text-small">{line}</p>}
          </div>
          {holds && (
            <div className="mt-16 flex w-full max-w-read-measure flex-col items-center">
              {children}
            </div>
          )}
          {shown.length > 0 && (
            <Buttons
              actions={shown}
              fit={fit}
              box={box}
              className="mt-16 flex flex-wrap items-center justify-center gap-8"
            />
          )}
        </>
      )}
    </div>
  );
}

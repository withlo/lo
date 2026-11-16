import { Popover } from '@base-ui/react/popover';
import { useCallback, useId, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { Button } from './Button.tsx';
import { withoutBidi } from './controls.ts';
import { useTakeFocus } from './focus.ts';
import { Input } from './Input.tsx';
import { Key } from './Key.tsx';
import { MergeDot, type MergeKind } from './MergeStatus.tsx';
import { useReturnFocus } from './returnFocus.ts';
import { SegmentedControl } from './SegmentedControl.tsx';
import { Switch } from './Switch.tsx';

export interface MergePanelProps {
  open: boolean;
  /** `Esc` or a click outside it asks for it to close. */
  onOpenChange: (open: boolean) => void;
  /** What it opens under: the header's merge status. */
  anchor: Element | null;
  /** Where it's put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** The key scope its keys apply in. */
  scope: string;
  /** How the pull request stands, which colors the dot before the verdict. */
  kind: MergeKind;
  /** The verdict, in a few words: "Can't merge yet". */
  verdict: string;
  /** What it merges into and how much is in the way: "into main · 6 things in the way". */
  sub?: ReactNode;
  /** The key that closes it, shown on its close button. */
  closeKeys?: readonly string[] | undefined;
  /** The reasons, or the form for the merge: what the panel is about. */
  children?: ReactNode;
  /** Its foot: see {@link MergeFoot}. */
  foot?: ReactNode;
  /** The panel itself, which takes focus as it opens, so its keys apply. */
  panelRef?: Ref<HTMLDivElement> | undefined;
  /**
   * The id of the row the keyboard is on, such as the reason `j` and `k` moved to
   * (`checkRowId`): the panel holds focus, so it names that row as its active descendant, and
   * a screen reader follows the keyboard as it moves. A row that has the keyboard also has a ring
   * while the panel has keyboard focus.
   */
  activeDescendant?: string | undefined;
  /** A key pressed anywhere in it, before the control with focus gets it. */
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * The merge panel's frame: a head with the verdict, a body for the reasons or the form, and a foot
 * with what to do. It opens under the header's merge status, as the revision picker does under its
 * button, over the diff without dimming it, and takes focus so its keys apply. Unlike other
 * popovers it holds a form, the commit's title and message, since the merge is decided where the
 * reasons are shown.
 */
export function MergePanel({
  open,
  onOpenChange,
  anchor,
  container,
  scope,
  kind,
  verdict,
  sub,
  closeKeys,
  children,
  foot,
  panelRef,
  activeDescendant,
  onKeyDown,
}: MergePanelProps) {
  const returnFocus = useReturnFocus(open);
  const takeFocus = useTakeFocus();
  // One ref for as long as the panel's own do not change, or each draw would take focus again.
  const popup = useCallback(
    (element: HTMLDivElement | null) => {
      takeFocus(element);
      if (typeof panelRef === 'function') panelRef(element);
      else if (panelRef) panelRef.current = element;
    },
    [takeFocus, panelRef],
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) returnFocus();
      }}
    >
      <Popover.Portal container={container}>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Popover.Popup
            ref={popup}
            initialFocus={false}
            finalFocus={false}
            aria-label="Merge"
            data-lo-scope={scope}
            data-kind={kind}
            aria-activedescendant={activeDescendant}
            onKeyDown={onKeyDown}
            className="group/list flex w-mergepanel-w max-w-full flex-col overflow-hidden rounded-md bg-bg-overlay text-fg shadow-pop outline-none text-ui"
          >
            <div className="flex items-center gap-12 ps-16 pe-12 pt-12 pb-8">
              <MergeDot kind={kind} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate verdict text-fg">{withoutBidi(verdict)}</div>
                {sub !== undefined && (
                  <div className="flex min-w-0 items-center gap-6 text-fg-muted text-small">
                    {sub}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={closeKeys === undefined ? 'Close' : `Close (${closeKeys.join(' ')})`}
                onClick={() => onOpenChange(false)}
              >
                <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Button>
            </div>
            {children !== undefined && children !== null && (
              <div className="max-h-palette-list-h min-h-0 overflow-auto px-16 pb-8">
                {children}
              </div>
            )}
            {foot !== undefined && (
              <div className="flex flex-none items-center gap-8 border-t border-border-subtle bg-bg-chrome py-12 ps-16 pe-12 text-fg-muted text-small">
                {foot}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The primary button of the panel's foot: what the merge is called, with its key. */
export interface MergePrimary {
  /** Named for the action: "Squash and merge", "Add to merge queue", "Merge 3 layers". */
  label: string;
  keys?: readonly string[] | undefined;
  /** It can't be pressed now, as while something is in the way. */
  disabled?: boolean | undefined;
  /** `quiet` where merging isn't the next thing, as while auto-merge waits. */
  quiet?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

export interface MergeFootProps {
  /** "Merge when ready" and its switch, where the pull request can wait for what blocks it. */
  auto?:
    | {
        on: boolean;
        onChange: (on: boolean) => void;
        disabled?: boolean | undefined;
        keys?: readonly string[] | undefined;
      }
    | undefined;
  /** Another button, before the primary: "See the queue". */
  start?: ReactNode;
  /** The method, as a word, where it can't be chosen here: "Squash". */
  method?: ReactNode;
  primary: MergePrimary;
}

/**
 * The foot of the merge panel: the switch that merges when ready, with its key, then at the end
 * the method and the one main button, named for what it does.
 */
export function MergeFoot({ auto, start, method, primary }: MergeFootProps) {
  return (
    <>
      {auto !== undefined && (
        <>
          <Switch
            checked={auto.on}
            onCheckedChange={auto.onChange}
            disabled={auto.disabled}
            aria-label="Merge when ready"
          />
          <span className={auto.on ? 'text-fg' : undefined}>Merge when ready</span>
          {auto.keys && <Key keys={auto.keys} decorative />}
        </>
      )}
      {start}
      <span className="flex-1" />
      {method !== undefined && <span>{method}</span>}
      <Button
        variant={primary.quiet ? 'secondary' : 'primary'}
        aria-disabled={primary.disabled || undefined}
        onClick={() => {
          if (!primary.disabled) primary.onClick?.();
        }}
      >
        {primary.label}
        {primary.keys && (
          <Key
            keys={primary.keys}
            decorative
            className={primary.quiet || primary.disabled ? undefined : 'text-on-accent'}
          />
        )}
      </Button>
    </>
  );
}

/** One method the repository allows. */
export interface MergeMethod<T extends string> {
  value: T;
  /** One or two words: "Squash", "Rebase", "Merge commit". */
  label: string;
}

export interface MergeMethodsProps<T extends string> {
  /** Only the methods the repository allows. */
  methods: readonly MergeMethod<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** What isn't offered, and why: "Merge commits are off in this repo". */
  note?: ReactNode;
  /** The key that steps through the methods, shown after the control. */
  keys?: readonly string[] | undefined;
}

/** The methods a repository allows, as a segmented control, with a note on any it doesn't. */
export function MergeMethods<T extends string>({
  methods,
  value,
  onChange,
  note,
  keys,
}: MergeMethodsProps<T>) {
  return (
    <div className="flex items-center gap-8">
      <SegmentedControl
        label="Method"
        kind="choice"
        size="sm"
        items={methods}
        value={value}
        onChange={onChange}
        keys={keys}
      />
      {note !== undefined && <span className="text-fg-muted text-small">{note}</span>}
    </div>
  );
}

/** One of the two fields of a squash: what it holds, which GitHub's own text fills until it's changed. */
export interface CommitField {
  value: string;
  onChange: (value: string) => void;
  /** GitHub's own text, which stands where nothing is typed, and is what's sent then. */
  placeholder?: string | undefined;
  /** A key pressed in the field, such as `Esc`, which leaves it for the panel. */
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
}

export interface CommitTextProps {
  title: CommitField;
  message: CommitField;
  /** The title's field, for the key that edits the commit to focus. */
  titleRef?: Ref<HTMLInputElement> | undefined;
  /** The message's field, for a key that moves on to it to focus. */
  messageRef?: Ref<HTMLTextAreaElement> | undefined;
}

/**
 * The commit a squash makes: its title and its message. They start from what GitHub would write,
 * and only what the reader types is sent. The window takes the characters that turn text around
 * out of GitHub's text before it goes here, so what's shown is what's sent.
 */
export function CommitText({ title, message, titleRef, messageRef }: CommitTextProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <label htmlFor={`${id}-title`} className="text-fg text-ui-strong">
          Commit title
        </label>
        <Input
          id={`${id}-title`}
          ref={titleRef}
          value={title.value}
          placeholder={title.placeholder}
          onChange={(event) => title.onChange(event.currentTarget.value)}
          onKeyDown={title.onKeyDown}
        />
      </div>
      <div className="flex flex-col gap-6">
        <label htmlFor={`${id}-message`} className="text-fg text-ui-strong">
          Message
        </label>
        <textarea
          id={`${id}-message`}
          ref={messageRef}
          rows={3}
          value={message.value}
          placeholder={message.placeholder}
          onChange={(event) => message.onChange(event.currentTarget.value)}
          onKeyDown={message.onKeyDown}
          className="w-full min-w-0 resize-none rounded-sm border border-border bg-bg-well px-8 py-6 text-fg code-text placeholder:text-fg-subtle hover:border-border-strong focus-visible:shadow-ring"
        />
      </div>
    </div>
  );
}

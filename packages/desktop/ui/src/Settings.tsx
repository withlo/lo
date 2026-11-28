import { cva } from 'class-variance-authority';
import { useId, type ReactNode, type Ref, type UIEvent } from 'react';

import { Button } from './Button.tsx';
import { Collapse } from './Collapse.tsx';
import { CommandButton, type CommandButtonProps } from './CommandButton.tsx';

/** One of Settings' groups, as the list beside it names it. */
export interface SettingsNavItem {
  /** The id of the `SettingsGroup` it goes to. */
  id: string;
  label: string;
}

const navItem = cva(
  'flex h-control-h items-center rounded-sm px-8 text-start move-tint text-ui focus-visible:shadow-ring-inset',
  {
    variants: {
      current: {
        true: 'bg-on-screen text-fg',
        false: 'text-fg-muted hover:bg-hover hover:text-fg',
      },
    },
  },
);

export interface SettingsPageProps {
  /** The list of groups beside the page. */
  items: readonly SettingsNavItem[];
  /** The group on screen. */
  current?: string | undefined;
  /** A group was chosen in the list. */
  onGo?: ((id: string) => void) | undefined;
  /** The search field, over the groups, where it never scrolls away. */
  search?: ReactNode;
  /** What sits at the foot of the list: the buttons that open the files Settings edits. */
  footer?: ReactNode;
  /** The `SettingsGroup`s, and whatever is said about the settings as a whole above them. */
  children?: ReactNode;
  /** The scrolling body, to scroll to a group and to see which is on screen. */
  bodyRef?: Ref<HTMLDivElement>;
  onBodyScroll?: ((event: UIEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * Settings: a list of groups beside one column of rows, which scrolls under a search field. The
 * column is `settings-w` at most, in the middle of the room right of the list, and at least as tall
 * as the room, so what fills it can sit in its middle. Room is kept for the scrollbar under the
 * field as beside the rows, so the two line up and nothing moves as the scrollbar comes and goes.
 * The page fills the middle of the window and is its own sheet.
 */
export function SettingsPage({
  items,
  current,
  onGo,
  search,
  footer,
  children,
  bodyRef,
  onBodyScroll,
}: SettingsPageProps) {
  return (
    <div className="settings-page min-h-0 flex-1 overflow-hidden rounded-t-lg">
      <nav
        aria-label="Settings"
        className="flex min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto border-e border-border-subtle bg-bg-chrome px-8 py-24"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={navItem({ current: item.id === current })}
            aria-current={item.id === current ? 'true' : undefined}
            onClick={() => onGo?.(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div className="flex-1" />
        {footer !== undefined && <div className="flex flex-col items-start gap-4">{footer}</div>}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col bg-bg">
        {search !== undefined && (
          <div className="flex-none gutter-stable overflow-hidden px-40 pt-24 pb-12">
            <div className="mx-auto w-full max-w-settings-w">{search}</div>
          </div>
        )}
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          className="min-h-0 flex-1 gutter-stable overflow-auto px-40"
        >
          <div className="mx-auto flex min-h-full w-full max-w-settings-w flex-col gap-32 pt-12 pb-64">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SettingsGroupProps {
  /** What the list beside Settings goes to. */
  id: string;
  /** Its name, in a word or two: "Pull requests". */
  title: string;
  /** Its rows: each a `Setting` or a `SettingsList`. */
  children?: ReactNode;
}

/** A group of Settings: its name, and under it its rows. */
export function SettingsGroup({ id, title, children }: SettingsGroupProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-settings-section={id}
      className="flex-none"
    >
      <h2 id={`${id}-title`} className="m-0 mb-8 read-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

export interface SettingProps {
  /** What it sets, in four words at most. */
  label: ReactNode;
  /** One line under the label, of 90 characters at most: what it changes that the label doesn't. */
  description?: ReactNode;
  /**
   * The setting's key in the settings file, `diff.layout`, shown after the label on hover and on
   * focus, for the people who edit the file.
   */
  settingKey?: string | undefined;
  /** What's wrong on the row, in a line under its description: what was typed, say. */
  note?: ReactNode;
  /** The note's id, for the control it's about to name in its `aria-describedby`. */
  noteId?: string | undefined;
  /** What the row shows under itself, across its width: a meter, or a `Problem` with its button. */
  below?: ReactNode;
  /**
   * Puts the setting back to its default. Given while it isn't its default, the row shows "Reset"
   * before its control, named for `resetName` to a screen reader.
   */
  onReset?: (() => void) | undefined;
  resetName?: string | undefined;
  /** The controls that change it, at the end of the row. */
  children?: ReactNode;
}

/**
 * One row of Settings: what it's called, one line on what it does, and its control at the end of
 * the row. Every row has this shape, whatever its control. The row is a group named by its label
 * and described by its line, so a screen reader says both as focus comes to its control. What's
 * said under it, a note or a `Problem`, comes and goes with the Open move.
 */
export function Setting({
  label,
  description,
  settingKey,
  note,
  noteId,
  below,
  onReset,
  resetName,
  children,
}: SettingProps) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={description === undefined ? undefined : `${id}-line`}
      className="group setting-row border-t border-border-subtle py-12"
      data-setting={settingKey}
    >
      <div className="flex min-w-0 items-baseline gap-8">
        <span id={`${id}-label`} className="text-ui-strong">
          {label}
        </span>
        {settingKey !== undefined && (
          <span
            aria-hidden="true"
            className="invisible truncate text-fg-subtle code-small group-focus-within:visible group-hover:visible"
          >
            {settingKey}
          </span>
        )}
      </div>
      {description !== undefined && (
        <div id={`${id}-line`} className="col-start-1 min-w-0 text-fg-muted text-small">
          {description}
        </div>
      )}
      <Collapse open={note !== undefined && note !== null} className="col-start-1 min-w-0">
        {note !== undefined && note !== null && (
          <div id={noteId} className="text-danger text-small" role="alert">
            {note}
          </div>
        )}
      </Collapse>
      <Collapse
        open={below !== undefined && below !== null}
        className="col-span-2 col-start-1 min-w-0"
      >
        {below !== undefined && below !== null && <div className="pt-4">{below}</div>}
      </Collapse>
      {(children !== undefined || onReset !== undefined) && (
        <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-8">
          {onReset !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              data-reset=""
              aria-label={resetName === undefined ? 'Reset' : `Reset ${resetName}`}
              onClick={(event) => {
                // "Reset" goes once the setting is back at its default, so focus goes to the
                // control beside it first, rather than falling to the page.
                event.currentTarget.parentElement
                  ?.querySelector<HTMLElement>(
                    'button:not([data-reset]):not([tabindex="-1"]), input, [role="switch"]',
                  )
                  ?.focus();
                onReset();
              }}
            >
              Reset
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export interface SettingsListProps {
  /** What the list holds, in a word or two: "Accounts". */
  label: ReactNode;
  /** One line on what the list is for. */
  description?: ReactNode;
  /** The list's own controls, at the end of its row: adding to it. */
  actions?: ReactNode;
  /**
   * Its controls are a field and its buttons, which need the room: where the row is narrower than
   * 600 px, they go under its words, from its start.
   */
  wraps?: boolean | undefined;
  /** What's wrong with what was typed in its controls, in a line under its description. */
  note?: ReactNode;
  /** The note's id, for the control it's about to name in its `aria-describedby`. */
  noteId?: string | undefined;
  /** The list itself: a `role="list"` of `SettingsListItem`s, or an `EmptyState`. */
  children?: ReactNode;
}

/**
 * A row of Settings that's a list, as the accounts, the trusted repos and the toolchains are: the
 * row's label, line and controls, as any row has, then the list under them, set in a box, each item
 * a `SettingsListItem`. What's wrong with what was typed in its controls is a line under its
 * description, which comes and goes with the Open move, as a `Setting`'s does.
 */
export function SettingsList({
  label,
  description,
  actions,
  wraps = false,
  note,
  noteId,
  children,
}: SettingsListProps) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={description === undefined ? undefined : `${id}-line`}
      className={`flex flex-col border-t border-border-subtle pb-12 ${wraps ? '@container' : ''}`}
    >
      <div className={wraps ? 'settings-list-wraps setting-row py-12' : 'setting-row py-12'}>
        <div id={`${id}-label`} className="text-ui-strong">
          {label}
        </div>
        {description !== undefined && (
          <div id={`${id}-line`} className="col-start-1 min-w-0 text-fg-muted text-small">
            {description}
          </div>
        )}
        <Collapse open={note !== undefined && note !== null} className="col-start-1 min-w-0">
          {note !== undefined && note !== null && (
            <div id={noteId} className="text-danger text-small" role="alert">
              {note}
            </div>
          )}
        </Collapse>
        {actions !== undefined && (
          <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-8">
            {actions}
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle">{children}</div>
    </div>
  );
}

export interface SettingsListItemProps {
  /** What goes before its name: an avatar, a mark. */
  lead?: ReactNode;
  /** Its name, with any tag after it. */
  label: ReactNode;
  /** One line under its name: what it is, where it's from. */
  description?: ReactNode;
  /** What went wrong with it, or what's needed, under its line. */
  note?: ReactNode;
  /** Its controls, at the end of its row. */
  children?: ReactNode;
  /** Any attributes its list finds it by, such as `data-key`. */
  data?: Readonly<Record<`data-${string}`, string>>;
  /**
   * Under 420 px of its list's own box (`@container`), its controls go under its name, the first
   * one's words starting where the name does: for a list whose items' buttons are words that need
   * the room, as `ScopedList`'s are.
   */
  stacks?: boolean | undefined;
}

/** One item of a `SettingsList`: its name, a line under it, and its controls at the end. */
export function SettingsListItem({
  lead,
  label,
  description,
  note,
  children,
  data,
  stacks = false,
}: SettingsListItemProps) {
  return (
    <div
      role="listitem"
      {...data}
      className={`flex min-h-row-h items-center gap-12 border-t border-border-subtle px-12 py-8 first:border-t-0 ${stacks ? 'settings-item-stacks' : ''}`}
    >
      {lead}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-8 text-ui">{label}</div>
        {description !== undefined && (
          <div className="min-w-0 text-fg-muted text-small">{description}</div>
        )}
        {note !== undefined && <div className="min-w-0 text-small">{note}</div>}
      </div>
      {children !== undefined && (
        <div className="flex flex-none items-center gap-6">{children}</div>
      )}
    </div>
  );
}

export type SettingsCommandProps = CommandButtonProps;

/**
 * A row's button for a command: it runs the command as its key does, gives the command's label and
 * key in its tooltip, and while the command can't run it's dimmed with the reason. It follows the
 * keymap file, and draws nothing for a command that isn't there.
 */
export function SettingsCommand(props: SettingsCommandProps) {
  return <CommandButton {...props} />;
}

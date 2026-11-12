import { Popover } from '@base-ui/react/popover';
import { cva } from 'class-variance-authority';
import { useCallback, type ReactNode, type Ref } from 'react';

import { Button } from './Button.tsx';
import { useTakeFocus } from './focus.ts';
import { Key } from './Key.tsx';
import { useReturnFocus } from './returnFocus.ts';
import { Tag } from './Tag.tsx';

/** A marker on a revision: your last review, last seen here, or the newest. */
export interface RevisionTag {
  readonly label: string;
  readonly kind: 'review' | 'seen' | 'newest';
}

/** One row of the picker: a revision, or the base, last. */
export interface RevisionPickerRow {
  /** The revision's head, or `base`. */
  readonly key: string;
  /** `r5`, or `base`; for a commit reviewed but never pushed, nothing. */
  readonly label: string;
  /** What the push did: "Force-pushed · rebased onto main". For the base, its branch. */
  readonly line: string;
  /** Whether the push was forced, which an icon marks. */
  readonly forced?: boolean | undefined;
  /** Who pushed it, when, and its commit; for the base, where it is. */
  readonly meta: string;
  readonly tags?: readonly RevisionTag[] | undefined;
  /** It can't be compared, as a revision that's no longer available can't. */
  readonly disabled?: boolean | undefined;
  /** The base's row, which shows its branch. */
  readonly base?: boolean | undefined;
}

/** A shortcut to a comparison: "Since your review · r2 → r5". */
export interface RevisionShortcut {
  readonly id: string;
  readonly label: string;
  readonly keys?: readonly string[] | undefined;
  /** It's the comparison on screen. */
  readonly pressed?: boolean | undefined;
}

export interface RevisionPickerProps {
  open: boolean;
  /** `Esc` or a click outside it asks for it to close. */
  onOpenChange: (open: boolean) => void;
  /** What it opens under: the header's revision button. */
  anchor: Element | null;
  /** Where it's put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** The key scope its keys apply in, named on the list. */
  scope: string;
  /** "Comparing r3 → r5", and what's after it. */
  heading: ReactNode;
  /** The key that opens it, shown at the end of the heading. */
  openKeys?: readonly string[] | undefined;
  /** The revisions, newest first, then the base. */
  rows: readonly RevisionPickerRow[];
  /** The row the keyboard is on, by key. */
  focused: string | undefined;
  /** The two rows the comparison runs between, by key, older first. */
  ends: { readonly from: string; readonly to: string } | undefined;
  /** A row was clicked, by key: it takes the keyboard. */
  onRowClick?: ((key: string) => void) | undefined;
  shortcuts: readonly RevisionShortcut[];
  onShortcut?: ((id: string) => void) | undefined;
  /** The button that compares the ends: its label, its key, and why it can't, if it can't. */
  compare: { label: string; keys?: readonly string[] | undefined; disabled?: boolean | undefined };
  onCompare?: (() => void) | undefined;
  /** The keys the foot hints at: moving, and setting an end. */
  moveKeys?: readonly string[] | undefined;
  endKeys?: readonly string[] | undefined;
  /** A line under the rows, such as what a comparison waits for. */
  note?: ReactNode;
  /** The list, which has focus while the picker is open. */
  listRef?: Ref<HTMLDivElement> | undefined;
}

const row = cva(
  'relative flex min-h-list-row-h cursor-default items-center gap-8 rounded-sm px-8 py-6 hover:bg-hover',
  {
    variants: {
      between: { true: 'bg-current', false: '' },
      focused: { true: 'shadow-ring-inset', false: '' },
      disabled: { true: 'text-fg-dim', false: 'text-fg' },
    },
  },
);

const dot = cva('ms-4 size-12 flex-none rounded-pill', {
  variants: {
    mark: {
      end: 'bg-accent ring-3 ring-current-strong',
      between: 'inset-ring-2 inset-ring-accent',
      none: 'inset-ring-2 inset-ring-fg-dim',
    },
  },
});

function rowId(prefix: string, key: string): string {
  return `${prefix}-${key}`;
}

/** The arrows that mark a forced push. */
function ForcedIcon() {
  return (
    <svg className="lo-i lo-i--xs flex-none text-warning" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 2.5v11M2.5 5 5 2.5 7.5 5M11 13.5v-11M8.5 11l2.5 2.5 2.5-2.5" />
    </svg>
  );
}

/** The eye that marks "last seen here". */
function SeenIcon() {
  return (
    <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8s2.25-4.25 6-4.25S14 8 14 8s-2.25 4.25-6 4.25S2 8 2 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}

/** A revision's marker. */
function RevisionMark({ tag }: { tag: RevisionTag }) {
  return (
    <Tag tone={tag.kind === 'newest' ? 'info' : 'neutral'}>
      {tag.kind === 'seen' && <SeenIcon />}
      {tag.label}
    </Tag>
  );
}

/**
 * The revision picker: every revision, newest first, with when and by whom it was pushed, forced
 * pushes marked, the markers of where the reader left off, and the base. Two ends choose what to
 * compare; shortcuts compare since a marker, or the whole pull request. It opens under the header's
 * revision button, and its list takes focus, so its keys apply.
 */
export function RevisionPicker({
  open,
  onOpenChange,
  anchor,
  container,
  scope,
  heading,
  openKeys,
  rows,
  focused,
  ends,
  onRowClick,
  shortcuts,
  onShortcut,
  compare,
  onCompare,
  moveKeys,
  endKeys,
  note,
  listRef,
}: RevisionPickerProps) {
  const returnFocus = useReturnFocus(open);
  const takeFocus = useTakeFocus();
  const list = useCallback(
    (element: HTMLDivElement | null) => {
      takeFocus(element);
      if (typeof listRef === 'function') listRef(element);
      else if (listRef) listRef.current = element;
    },
    [takeFocus, listRef],
  );
  const prefix = 'lo-revision';
  const from = ends === undefined ? -1 : rows.findIndex((each) => each.key === ends.from);
  const to = ends === undefined ? -1 : rows.findIndex((each) => each.key === ends.to);
  // Newest first: the newer end comes before the older.
  const [first, last] = from < to ? [from, to] : [to, from];
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
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            aria-label="Revisions"
            className="w-revpicker-w max-w-full overflow-hidden rounded-md bg-bg-overlay text-fg shadow-pop outline-none text-ui"
          >
            <div className="flex items-center gap-8 px-12 pt-12 pb-8 text-fg-muted text-small">
              <span className="flex min-w-0 flex-1 items-center gap-6">{heading}</span>
              {openKeys && <Key keys={openKeys} decorative />}
            </div>
            <div
              ref={list}
              role="listbox"
              aria-label="Revisions"
              aria-multiselectable="true"
              tabIndex={-1}
              data-lo-scope={scope}
              aria-activedescendant={focused === undefined ? undefined : rowId(prefix, focused)}
              className="flex max-h-palette-list-h flex-col overflow-auto px-6 pb-6 outline-none"
            >
              {rows.map((each, index) => {
                const end = index === first || index === last;
                const between = first >= 0 && index > first && index < last;
                return (
                  <div
                    key={each.key}
                    id={rowId(prefix, each.key)}
                    role="option"
                    aria-selected={end}
                    aria-disabled={each.disabled ? true : undefined}
                    data-key={each.key}
                    className={row({
                      between,
                      focused: each.key === focused,
                      disabled: each.disabled === true,
                    })}
                    onClick={() => onRowClick?.(each.key)}
                  >
                    <span
                      className={dot({ mark: end ? 'end' : between ? 'between' : 'none' })}
                      aria-hidden="true"
                    />
                    <span
                      className={`w-32 flex-none code-small ${each.base ? 'text-fg-muted' : 'font-bold'}`}
                    >
                      {each.label}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="flex min-w-0 items-center gap-6">
                        {each.forced && <ForcedIcon />}
                        <span
                          className={`min-w-0 truncate ${each.base ? 'rounded-xs bg-hover px-6 code-small' : ''}`}
                        >
                          {each.line}
                        </span>
                      </span>
                      <span className="truncate text-fg-muted text-small">{each.meta}</span>
                    </span>
                    {each.tags && each.tags.length > 0 && (
                      <span className="flex flex-none flex-col items-end gap-2">
                        {each.tags.map((tag) => (
                          <RevisionMark key={tag.label} tag={tag} />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {shortcuts.length > 0 && (
              <div className="flex flex-wrap gap-6 px-12 pt-4 pb-12">
                {shortcuts.map((shortcut) => (
                  <button
                    key={shortcut.id}
                    type="button"
                    aria-pressed={shortcut.pressed === true}
                    tabIndex={-1}
                    className={`inline-flex h-control-h-sm items-center gap-6 rounded-pill px-8 text-small-medium whitespace-nowrap focus-visible:shadow-ring ${shortcut.pressed ? 'bg-accent-soft text-fg-accent inset-ring inset-ring-accent-line' : 'text-fg-muted inset-ring inset-ring-border hover:bg-hover hover:text-fg'}`}
                    onClick={() => onShortcut?.(shortcut.id)}
                  >
                    {shortcut.label}
                    {shortcut.keys && <Key keys={shortcut.keys} quiet decorative />}
                  </button>
                ))}
              </div>
            )}
            {note !== undefined && note !== null && (
              <p className="m-0 px-12 pb-12 text-fg-muted text-small" role="status">
                {note}
              </p>
            )}
            <div className="flex items-center gap-12 border-t border-border-subtle bg-bg-chrome px-12 py-8 text-fg-muted text-small">
              {moveKeys && (
                <span className="inline-flex items-center gap-4">
                  <Key keys={moveKeys} quiet decorative /> Move
                </span>
              )}
              {endKeys && (
                <span className="inline-flex items-center gap-4">
                  <Key keys={endKeys} quiet decorative /> Set an end
                </span>
              )}
              <span className="flex-1" />
              <Button
                variant="primary"
                size="sm"
                tabIndex={-1}
                disabled={compare.disabled}
                onClick={() => onCompare?.()}
              >
                {compare.label}
                {compare.keys && <Key keys={compare.keys} quiet decorative />}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

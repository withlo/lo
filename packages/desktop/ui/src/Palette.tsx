import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { useRef, type ReactNode } from 'react';

import { Key, type KeyAria } from './Key.tsx';

/** A run of a palette's items, under a label or none. */
export interface PaletteGroup<T> {
  readonly label?: string | undefined;
  readonly items: readonly T[];
}

export interface PaletteProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the palette is, for screen readers: "Command palette". */
  label: string;
  placeholder: string;
  /** The palette's own key, shown at the end of its input. */
  keys?: readonly string[] | undefined;
  query: string;
  onQueryChange: (query: string) => void;
  /** The items that match the query, in the order to show them. */
  groups: readonly PaletteGroup<T>[];
  itemId: (item: T) => string;
  /** An item's row: its label, a detail, and its marks or keys at the end. */
  renderItem: (item: T) => ReactNode;
  /**
   * What a screen reader hears of an item's key in place of its key caps, which its row marks
   * `decorative`: `keyAria` makes it.
   */
  itemKeys?: ((item: T) => KeyAria) | undefined;
  /** `⏎` on the highlighted item, or a click on one. */
  onRun: (item: T) => void;
  /** The highlighted item changed, as the arrows, the pointer or typing moved it. */
  onHighlight?: ((item: T | undefined) => void) | undefined;
  /** What the list says when nothing matches. */
  empty: ReactNode;
  /** The row of hints at the bottom. */
  foot?: ReactNode;
  /** Where the dialog is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** The palette has closed, and focus has gone back to where it was. */
  onClosed?: (() => void) | undefined;
}

/**
 * A keyboard list over the window: the command palette, the file finder and open a PR. Typing
 * narrows it, the arrows move through it, and `⏎` acts on the highlighted row, which is always
 * one: nothing hides behind a second step.
 */
export function Palette<T>({
  open,
  onOpenChange,
  label,
  placeholder,
  keys,
  query,
  onQueryChange,
  groups,
  itemId,
  renderItem,
  itemKeys,
  onRun,
  onHighlight,
  empty,
  foot,
  container,
  onClosed,
}: PaletteProps<T>) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="fixed inset-0 z-dialog bg-scrim" />
        <Dialog.Viewport className="fixed inset-0 z-dialog flex items-start justify-center px-16 pt-64 pb-16">
          <Dialog.Popup
            initialFocus={input}
            aria-label={label}
            data-lo-scope="palette"
            className="flex max-h-full w-palette-w max-w-full flex-col overflow-hidden rounded-lg bg-bg-overlay text-fg shadow-dialog"
          >
            <Autocomplete.Root
              inline
              open
              mode="none"
              autoHighlight="always"
              items={groups}
              value={query}
              onValueChange={(value) => onQueryChange(value)}
              onItemHighlighted={(item: T | undefined) => onHighlight?.(item)}
            >
              <div className="flex h-48 flex-none items-center gap-12 border-b border-border-subtle ps-16 pe-12">
                <svg className="lo-i text-fg-muted" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 5.5 7 8l-3 2.5M8.5 11h3.5" />
                </svg>
                <Autocomplete.Input
                  ref={input}
                  placeholder={placeholder}
                  aria-label={label}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-fg outline-none read-body placeholder:text-fg-subtle focus-visible:shadow-none"
                />
                {keys && <Key keys={keys} quiet />}
              </div>
              <Autocomplete.List
                aria-label={`${label} results`}
                className="max-h-palette-list-h min-h-0 overflow-auto p-6"
              >
                {(group: PaletteGroup<T>) => (
                  <Autocomplete.Group
                    key={group.label ?? ''}
                    items={group.items}
                    className="flex flex-col"
                  >
                    {group.label !== undefined && (
                      <Autocomplete.GroupLabel className="px-12 pt-12 pb-4 label-caps text-fg-muted text-label">
                        {group.label}
                      </Autocomplete.GroupLabel>
                    )}
                    <Autocomplete.Collection>
                      {(item: T) => (
                        <Autocomplete.Item
                          key={itemId(item)}
                          value={item}
                          {...itemKeys?.(item)}
                          onClick={() => onRun(item)}
                          className="flex min-h-32 cursor-default items-center gap-12 rounded-sm px-12 py-6 text-fg text-ui data-highlighted:bg-current-strong"
                        >
                          {renderItem(item)}
                        </Autocomplete.Item>
                      )}
                    </Autocomplete.Collection>
                  </Autocomplete.Group>
                )}
              </Autocomplete.List>
              <Autocomplete.Empty className="px-16 text-fg-muted text-ui not-empty:py-12 empty:p-0">
                {empty}
              </Autocomplete.Empty>
            </Autocomplete.Root>
            {foot !== undefined && (
              <div className="flex flex-none flex-wrap items-center gap-16 border-t border-border-subtle bg-bg-chrome px-16 py-8 text-fg-muted text-small">
                {foot}
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A hint in a palette's foot: a key and what it does. */
export function PaletteHint({ keys, children }: { keys: readonly string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-6 whitespace-nowrap">
      <Key keys={keys} quiet />
      {children}
    </span>
  );
}

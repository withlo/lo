import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useRef, useState } from 'react';

import { filterHelp, type HelpGroup, type KeymapError } from './commands/index.ts';
import { Key } from './Key.tsx';

/** How many of the keymap file's errors key help lists. A file can have thousands of lines. */
export const ERRORS_SHOWN = 20;

export interface KeyHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every command's keys as they are now, in the key table's groups. */
  groups: readonly HelpGroup[];
  /** The keymap file's lines Lo couldn't use. Only the first few are listed. */
  errors?: readonly KeymapError[] | undefined;
  /** What went wrong with the keymap file as a whole, such as being too big to read. */
  problem?: string | undefined;
  /** A command to show: its row is marked and scrolled to. */
  show?: string | undefined;
  /** Opens the keymap file. Without it, key help offers no button for it. */
  onOpenKeymap?: (() => void) | undefined;
  /** Where the dialog is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** Key help has closed, and focus has gone back to where it was. */
  onClosed?: (() => void) | undefined;
}

/**
 * Every key (`?`): the key table's groups with each action's keys as they are now, the keymap
 * file's included, in this system's form, with where each applies and which are Vim's. A search
 * narrows it to the actions or keys typed.
 */
export function KeyHelp({
  open,
  onOpenChange,
  groups,
  errors = [],
  problem,
  show,
  onOpenKeymap,
  container,
  onClosed,
}: KeyHelpProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const found = filterHelp(groups, query);

  // Each opening starts from every key, at the command it was asked to show.
  useEffect(() => {
    if (open) setQuery('');
  }, [open, show]);
  useEffect(() => {
    if (open && show !== undefined) shown.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, show]);

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
        <Dialog.Viewport className="fixed inset-0 z-dialog flex items-center justify-center p-16">
          <Dialog.Popup
            initialFocus={search}
            data-lo-scope="dialog"
            className="flex max-h-full w-full max-w-keyhelp-w flex-col overflow-hidden rounded-lg bg-bg-overlay text-fg shadow-dialog text-ui"
          >
            <div className="flex items-start gap-12 ps-20 pe-16 pt-16 pb-4">
              <div className="min-w-0">
                <Dialog.Title className="m-0 text-title">Every key</Dialog.Title>
                <Dialog.Description className="mt-2 text-fg-muted text-small">
                  Your keys as they are now. Single letters act on what has focus.
                </Dialog.Description>
              </div>
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a key or an action"
                aria-label="Find a key or an action"
                className="ms-auto h-control-h w-tab-w min-w-0 rounded-sm border border-border bg-bg-well px-8 text-fg text-ui placeholder:text-fg-subtle focus-visible:shadow-ring"
              />
              <Dialog.Close
                aria-label="Close"
                className="grid size-control-h flex-none place-items-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg focus-visible:shadow-ring"
              >
                <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Dialog.Close>
            </div>
            <div className="flex min-h-0 flex-col gap-12 overflow-auto ps-20 pe-20 pt-8 pb-16">
              {problem !== undefined && (
                <div
                  role="alert"
                  className="rounded-md border border-danger-border bg-danger-bg px-12 py-8"
                >
                  {problem}
                </div>
              )}
              {errors.length > 0 && (
                <div
                  role="alert"
                  className="flex flex-col gap-4 rounded-md border border-danger-border bg-danger-bg px-12 py-8"
                >
                  <span className="font-semibold">
                    {errors.length === 1
                      ? "The keymap file has a line Lo can't use:"
                      : `The keymap file has ${errors.length} lines Lo can't use:`}
                  </span>
                  <ul className="m-0 flex flex-col gap-2 ps-16">
                    {errors.slice(0, ERRORS_SHOWN).map((error) => (
                      <li key={`${error.line} ${error.message}`}>
                        Line <span className="lo-num">{error.line}</span>: {error.message}
                      </li>
                    ))}
                    {errors.length > ERRORS_SHOWN && (
                      <li>
                        And <span className="lo-num">{errors.length - ERRORS_SHOWN}</span> more.
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {found.length === 0 ? (
                <p className="m-0 py-16 text-fg-muted">No key or action matches "{query}".</p>
              ) : (
                <div className="columns-4 gap-x-24">
                  {found.map(({ group, rows }) => (
                    <section key={group} aria-label={group} className="mb-16 break-inside-avoid">
                      <h3 className="m-0 mb-2 label-caps text-fg-muted text-label">{group}</h3>
                      {rows.map((row) => (
                        <div
                          key={row.id}
                          ref={row.id === show ? shown : undefined}
                          data-command={row.id}
                          aria-current={row.id === show ? 'true' : undefined}
                          className={`flex min-h-row-h items-center gap-8 border-b border-border-subtle py-2 text-small ${row.id === show ? 'rounded-sm bg-on-screen px-4' : ''}`}
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span>{row.label}</span>
                            {row.where !== undefined && (
                              <span className="text-fg-muted text-micro">{row.where}</span>
                            )}
                          </span>
                          {row.vim && <span className="text-fg-muted text-micro">Vim's</span>}
                          {row.overVim && (
                            <span className="text-fg-muted text-micro">Replaces Vim's</span>
                          )}
                          <span className="flex flex-none flex-wrap items-center justify-end gap-4">
                            {row.keys.length === 0 ? (
                              <span className="text-fg-subtle text-micro">No key</span>
                            ) : (
                              row.keys.map((keys) => <Key key={keys.join(' ')} keys={keys} />)
                            )}
                          </span>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </div>
            {onOpenKeymap && (
              <div className="flex items-center gap-8 border-t border-border-subtle bg-bg-chrome py-12 ps-20 pe-16 text-fg-muted text-small">
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={onOpenKeymap}
                  className="h-control-h-sm rounded-sm border border-border px-8 text-fg text-small hover:bg-hover focus-visible:shadow-ring"
                >
                  Open the keymap file
                </button>
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

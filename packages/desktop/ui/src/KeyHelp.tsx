import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { Button } from './Button.tsx';
import {
  filterHelp,
  type HelpArea,
  type HelpGroup,
  type HelpRow,
  type KeymapError,
} from './commands/index.ts';
import { Dialog, DialogSpacer } from './Dialog.tsx';
import { Input } from './Input.tsx';
import { Key } from './Key.tsx';
import { Problem } from './Problem.tsx';
import { reveal } from './reveal.ts';
import { Switch } from './Switch.tsx';
import { Ticks } from './Ticks.tsx';

/** How many of the keymap file's lines keyboard shortcuts lists. A file can have thousands. */
export const ERRORS_SHOWN = 20;

/** What went wrong with the keymap file as a whole, as an error says it. */
export interface KeyHelpProblem {
  readonly title: string;
  readonly reason?: string | undefined;
  /** What the system said, as it came. */
  readonly details?: string | undefined;
}

/** The first tab, "Here": the keys that work in what had focus. */
export const HERE = 'here';

export interface KeyHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The keys that work in what had focus as it opened, by group: the first tab, "Here". */
  here: readonly HelpGroup[];
  /** The window's areas, a tab each, with the keys that work in each, by group. */
  areas: readonly HelpArea[];
  /** Every command, by group, which a search looks through whichever tab is on. */
  all: readonly HelpGroup[];
  /** The keymap file's lines Lo couldn't use. Only the first few are listed. */
  errors?: readonly KeymapError[] | undefined;
  /**
   * What went wrong with the keymap file as a whole, as an error says it: its title, why, and what
   * the system said, behind Details.
   */
  problem?: KeyHelpProblem | undefined;
  /** A command to show: its row is marked and scrolled to, in `showIn`, its area. */
  show?: string | undefined;
  /** The area `show` is shown in, by its scope, or {@link HERE}. */
  showIn?: string | undefined;
  /** Opens the keymap file. Without it, there's no button for it. */
  onOpenKeymap?: (() => void) | undefined;
  /** `Esc`, which closes it, as the system shows it, on its Close button. */
  closeKeys?: readonly string[] | undefined;
  /** Where the dialog is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** It has closed, and focus has gone back to where it was. */
  onClosed?: (() => void) | undefined;
}

/** The rows that show: those with keys, or every one with `all`, and the one asked for anyway. */
function shownOf(
  groups: readonly HelpGroup[],
  all: boolean,
  show: string | undefined,
): HelpGroup[] {
  if (all) return [...groups];
  return groups.flatMap((each): HelpGroup[] => {
    const rows = each.rows.filter((row) => row.keys.length > 0 || row.ids.includes(show ?? ''));
    return rows.length > 0 ? [{ group: each.group, rows }] : [];
  });
}

/**
 * Keyboard shortcuts (`?`): the keys that work in what had focus, "Here", and a tab for each area
 * of the window, each command once by group, with its keys as they are now, the keymap file's
 * included, in this system's form. A command with no key shows only with "Show all commands" on,
 * and Vim's tags only with Vim keys on. A search looks through every area at once.
 */
export function KeyHelp({
  open,
  onOpenChange,
  here,
  areas,
  all,
  errors = [],
  problem,
  show,
  showIn,
  onOpenKeymap,
  closeKeys,
  container,
  onClosed,
}: KeyHelpProps) {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState(HERE);
  const [everything, setEverything] = useState(false);
  const ids = useId();
  const search = useRef<HTMLInputElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);

  // Each opening starts from Here with nothing typed, or at the command it was asked to show.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setArea(show === undefined ? HERE : (showIn ?? HERE));
  }, [open, show, showIn]);
  useEffect(() => {
    if (open && show !== undefined && shown.current) reveal(shown.current);
  }, [open, show, area]);

  const typed = query.trim() !== '';
  const listed = [{ scope: HERE, name: 'Here', groups: here }, ...areas]
    .map((each) => ({ ...each, groups: shownOf(each.groups, everything, show) }))
    .filter((each) => each.scope === HERE || each.groups.length > 0);
  const on = listed.find((each) => each.scope === area) ?? listed[0];
  const found = typed ? filterHelp(shownOf(all, everything, show), query) : (on?.groups ?? []);

  // The arrows move through the tabs, as through any list of them, and show what they land on.
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (by === 0) return;
    event.preventDefault();
    const at = listed.findIndex((each) => each.scope === on?.scope);
    const next = listed[(at + by + listed.length) % listed.length];
    if (!next) return;
    setArea(next.scope);
    setQuery('');
    tabs.current?.querySelector<HTMLElement>(`[data-area="${next.scope}"]`)?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      size="lg"
      initialFocus={search}
      container={container}
      onClosed={onClosed}
      testId="keyboard-shortcuts"
      foot={
        <>
          <label className="flex items-center gap-8 text-fg">
            <Switch checked={everything} onCheckedChange={setEverything} />
            Show all commands
          </label>
          <DialogSpacer />
          {onOpenKeymap && <Button onClick={onOpenKeymap}>Open keymap file</Button>}
          <Button onClick={() => onOpenChange(false)}>
            Close
            {closeKeys && <Key keys={closeKeys} decorative />}
          </Button>
        </>
      }
    >
      {problem !== undefined && (
        <Problem title={problem.title} reason={problem.reason} details={problem.details} />
      )}
      {errors.length > 0 && <KeymapLines errors={errors} />}
      <Input
        ref={search}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search keys and commands"
        aria-label="Search keys and commands"
      />
      <div className="flex min-h-0 flex-1 gap-16">
        <div
          ref={tabs}
          role="tablist"
          aria-label="Areas"
          aria-orientation="vertical"
          onKeyDown={step}
          className="flex w-keyhelp-nav-w flex-none flex-col gap-2 overflow-auto"
        >
          {listed.map((each) => {
            const chosen = each.scope === on?.scope;
            return (
              <button
                key={each.scope}
                type="button"
                role="tab"
                id={`${ids}-tab-${each.scope}`}
                data-area={each.scope}
                aria-selected={chosen && !typed}
                aria-controls={`${ids}-panel`}
                tabIndex={chosen ? 0 : -1}
                onClick={() => {
                  setArea(each.scope);
                  setQuery('');
                }}
                className={`flex min-h-row-h flex-none items-center rounded-sm px-8 text-start move-tint text-ui hover:bg-hover focus-visible:shadow-ring-inset ${chosen && !typed ? 'bg-current-strong text-fg' : 'text-fg-muted'}`}
              >
                {each.name}
              </button>
            );
          })}
        </div>
        <div
          id={`${ids}-panel`}
          role="tabpanel"
          aria-labelledby={typed ? undefined : `${ids}-tab-${on?.scope ?? HERE}`}
          aria-label={typed ? 'Search results' : undefined}
          className="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          {/* Said aloud when nothing matches; the same words show below. */}
          <div role="status" className="sr-only">
            {typed && found.length === 0 && `No keys or commands match “${query}”`}
          </div>
          {found.length === 0 ? (
            <p className="m-0 py-16 text-fg-muted">
              {typed ? `No keys or commands match “${query}”` : 'No keys here'}
            </p>
          ) : (
            <div className="columns-2 gap-x-20">
              {found.map(({ group, rows }, index) => (
                <div
                  key={group}
                  role="group"
                  aria-labelledby={`${ids}-${index}`}
                  className="mb-12 break-inside-avoid"
                >
                  <h3
                    id={`${ids}-${index}`}
                    className="m-0 mb-2 label-caps text-fg-muted text-label"
                  >
                    {group}
                  </h3>
                  {rows.map((row) => {
                    const marked = show !== undefined && row.ids.includes(show);
                    return (
                      <Row
                        key={row.id}
                        row={row}
                        marked={marked}
                        rowRef={marked ? shown : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** One command's line: its label, with code as code, its tags and its keys, and its one line. */
function Row({
  row,
  marked,
  rowRef,
}: {
  row: HelpRow;
  marked: boolean;
  rowRef: RefObject<HTMLDivElement | null> | undefined;
}) {
  return (
    <div
      ref={rowRef}
      data-command={row.id}
      aria-current={marked ? 'true' : undefined}
      className={`flex min-h-row-h items-center gap-8 border-b border-border-subtle py-2 text-small ${marked ? 'rounded-sm bg-on-screen px-4' : ''}`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span>
          <Ticks text={row.label} />
        </span>
        {row.description !== undefined && (
          <span className="text-fg-muted text-micro">{row.description}</span>
        )}
      </span>
      {row.vim && <span className="text-fg-muted text-micro">Vim</span>}
      {row.editor && <span className="text-fg-muted text-micro">Fixed</span>}
      {row.overVim && <span className="text-fg-muted text-micro">Replaces Vim’s</span>}
      <span className="flex flex-none flex-wrap items-center justify-end gap-4">
        {row.keys.length === 0 ? (
          <span className="text-fg-subtle text-micro">No key</span>
        ) : (
          row.keys.map((keys) => <Key key={keys.join(' ')} keys={keys} />)
        )}
      </span>
    </div>
  );
}

/** A count of the keymap file's lines: "1 line", "12 more lines". */
function lines(n: number, more = false): string {
  return `${n.toLocaleString('en')}${more ? ' more' : ''} ${n === 1 ? 'line' : 'lines'}`;
}

/**
 * The keymap file's lines Lo can't use, as an error: how many, and a line for each of the first
 * few with its number and why, then how many more. The foot's "Open keymap file" opens it.
 */
function KeymapLines({ errors }: { errors: readonly KeymapError[] }) {
  const count = errors.length;
  const more = count - ERRORS_SHOWN;
  return (
    <Problem
      title={`Can’t use ${lines(count)} of the keymap file`}
      reason={
        <>
          {errors.slice(0, ERRORS_SHOWN).map((error) => (
            <span key={`${error.line} ${error.message}`} className="block">
              Line <span className="lo-num">{error.line.toLocaleString('en')}</span> ·{' '}
              <Ticks text={error.message} />
            </span>
          ))}
          {more > 0 && <span className="block">{lines(more, true)}</span>}
        </>
      }
    />
  );
}

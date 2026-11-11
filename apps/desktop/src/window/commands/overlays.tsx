// Key help (`?`) and the command palette (`⌘⇧P`): which of them is open, and the window's copy of
// each, read live from the registry.

import {
  filterPalette,
  findScope,
  helpGroups,
  keyLabels,
  paletteItems,
  parseKeys,
  systemStrokes,
  NO_TARGET,
  type PaletteMatch,
  type Target,
} from '@lo/ui/commands';
import { Key, KeyHelp, keyAria, Palette, PaletteHint, type PaletteGroup } from '@lo/ui';
import { useState, useSyncExternalStore } from 'react';

import { focusedTarget } from './bar.ts';
import { keymapProblem, subscribeProblem } from './keymap.ts';
import { registry, useKeys } from './registry.ts';

/** What's open over the window. */
export type Overlay =
  | { readonly kind: 'help'; readonly show?: string | undefined }
  | {
      readonly kind: 'palette';
      /** The scope and target that had focus before it opened, which its commands run on. */
      readonly scope: string;
      readonly target: Target;
      /** Why the last `⌥⏎` did nothing, until what's typed changes. */
      readonly notice?: string | undefined;
    }
  | undefined;

let current: Overlay;
/** What to do once the overlay that's closing has given focus back. */
let afterClose: (() => void) | undefined;
/** The palette's highlighted command, which `⌥⏎` shows in key help. */
let highlighted: string | undefined;
const listeners = new Set<() => void>();

function set(next: Overlay): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What's open now. */
export function overlay(): Overlay {
  return current;
}

/** Opens key help, showing the command `show` if given. */
export function openHelp(show?: string): void {
  set({ kind: 'help', show });
}

/** Opens the command palette, for what has focus now. */
export function openPalette(): void {
  set({
    kind: 'palette',
    scope: findScope(document.activeElement).name,
    target: focusedTarget(),
  });
}

/**
 * Closes what's open, then runs `then` once focus is back where it was, so a command run from the
 * palette acts where it would have from its key.
 */
export function closeOverlay(then?: () => void): void {
  afterClose = then;
  set(undefined);
}

/** `?` again closes key help. */
export function toggleHelp(): void {
  if (current?.kind === 'help') closeOverlay();
  else if (current === undefined) openHelp();
  else closeOverlay(() => openHelp());
}

/** `⌘⇧P` again closes the palette. */
export function togglePalette(): void {
  if (current?.kind === 'palette') closeOverlay();
  else if (current === undefined) openPalette();
  else closeOverlay(openPalette);
}

/**
 * Shows the palette's highlighted command in key help, as `⌥⏎` asks. With none highlighted, the
 * palette says why instead. Returns `true`, or why it didn't.
 */
export function showHighlighted(): true | string {
  if (current?.kind !== 'palette') return 'No action is highlighted.';
  const id = highlighted;
  if (id === undefined) {
    const why = "No action matches, so there's no key to show.";
    set({ ...current, notice: why });
    return why;
  }
  closeOverlay(() => openHelp(id));
  return true;
}

/** Runs what was waiting for the overlay to close. */
function closed(): void {
  const then = afterClose;
  afterClose = undefined;
  then?.();
}

/** A key written in Lo's notation, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** Key help and the command palette, over the window. */
export function Overlays() {
  const open = useSyncExternalStore(subscribe, overlay);
  const problem = useSyncExternalStore(subscribeProblem, keymapProblem);
  useKeys();
  const container = document.getElementById('root');
  return (
    <>
      <KeyHelp
        open={open?.kind === 'help'}
        onOpenChange={(next) => {
          if (!next) closeOverlay();
        }}
        groups={helpGroups(registry())}
        errors={registry().keymapErrors()}
        problem={problem}
        onOpenKeymap={() => {
          registry().run('keys.openKeymap', NO_TARGET);
        }}
        show={open?.kind === 'help' ? open.show : undefined}
        container={container}
        onClosed={closed}
      />
      <CommandPalette open={open?.kind === 'palette' ? open : undefined} container={container} />
    </>
  );
}

/** A label with the letters the query matched marked. */
function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  const marked = new Set(marks);
  const runs: { text: string; marked: boolean }[] = [];
  for (let index = 0; index < text.length; index++) {
    const letter = text.slice(index, index + 1);
    const last = runs.at(-1);
    if (last && last.marked === marked.has(index)) last.text += letter;
    else runs.push({ text: letter, marked: marked.has(index) });
  }
  return runs.map((run, index) =>
    run.marked ? (
      <mark key={index} className="bg-transparent font-semibold text-fg-accent">
        {run.text}
      </mark>
    ) : (
      run.text
    ),
  );
}

function CommandPalette({
  open,
  container,
}: {
  open: Extract<Overlay, { kind: 'palette' }> | undefined;
  container: HTMLElement | null;
}) {
  const [query, setQuery] = useState('');
  const items = open ? paletteItems(registry(), open.scope, open.target) : [];
  const matches = filterPalette(items, query);
  const typed = query.trim() !== '';
  const showKey = keyOf('keys.showKey');
  // Grouped as key help is while nothing's typed; the best match first once something is.
  const groups: PaletteGroup<PaletteMatch>[] = typed
    ? matches.length > 0
      ? [{ items: matches }]
      : []
    : [...new Set(matches.map((match) => match.item.group))].map((group) => ({
        label: group,
        items: matches.filter((match) => match.item.group === group),
      }));
  return (
    <Palette<PaletteMatch>
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) closeOverlay();
      }}
      onClosed={() => {
        setQuery('');
        highlighted = undefined;
        closed();
      }}
      label="Command palette"
      placeholder="Type an action"
      keys={keyOf('keys.palette')}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        if (open?.notice !== undefined) set({ ...open, notice: undefined });
      }}
      groups={groups}
      itemId={(match) => match.item.id}
      itemKeys={({ item }) => keyAria(item.keys, item.shortcut)}
      onHighlight={(match) => {
        highlighted = match?.item.id;
      }}
      onRun={(match) => {
        const target = open?.target ?? { kind: 'none' };
        closeOverlay(() => {
          registry().run(match.item.id, target);
        });
      }}
      renderItem={({ item, marks }) => (
        <>
          <span className="whitespace-nowrap">
            <Marked text={item.label} marks={marks} />
          </span>
          {typed && <span className="min-w-0 truncate text-fg-muted text-small">{item.group}</span>}
          <span className="ms-auto flex flex-none items-center gap-8">
            {item.keys && <Key keys={item.keys} decorative />}
          </span>
        </>
      )}
      empty={`No action matches "${query}".`}
      foot={
        <>
          <span className="lo-num">
            {typed ? `${matches.length} of ${items.length} actions` : `${items.length} actions`}
          </span>
          <span role="status" className="text-fg">
            {open?.notice}
          </span>
          <span className="flex-1" />
          <PaletteHint keys={labels('enter')}>Run</PaletteHint>
          {showKey && <PaletteHint keys={showKey}>Show its key</PaletteHint>}
          <PaletteHint keys={labels('esc')}>Close</PaletteHint>
        </>
      }
      container={container}
    />
  );
}

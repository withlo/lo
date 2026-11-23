// Keyboard shortcuts (`?`) and the command palette (`⌘⇧P`): which of them is open, and the
// window's copy of each, read live from the registry.

import {
  areaOfCommand,
  filterPalette,
  findScope,
  helpAll,
  helpAreas,
  helpHere,
  keyLabels,
  paletteItems,
  parseKeys,
  systemStrokes,
  NO_TARGET,
  type Command,
  type HelpOptions,
  type PaletteMatch,
  type Target,
} from '@lo/ui/commands';
import { onVim, plainKeys, vimOn } from '@lo/ui/code';
import { HERE, Key, KeyHelp, keyAria, Palette, PaletteHint, type PaletteGroup } from '@lo/ui';
import { Fragment, useState, useSyncExternalStore } from 'react';

import { focusedTarget } from './bar.ts';
import { keymapProblem, keymapState, subscribeKeymap } from './keymap.ts';
import { registry, useKeys } from './registry.ts';

/** What's open over the window. */
export type Overlay =
  | {
      readonly kind: 'help';
      readonly show?: string | undefined;
      /** The scope and target that had focus as it opened, whose keys its "Here" lists. */
      readonly scope: string;
      readonly target: Target;
    }
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
/** The palette's highlighted command, which `⌥⏎` shows in keyboard shortcuts. */
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

/** Opens keyboard shortcuts, for what has focus now, showing the command `show` if given. */
export function openHelp(show?: string): void {
  set({
    kind: 'help',
    show,
    scope: findScope(document.activeElement).name,
    target: focusedTarget(),
  });
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

/** `?` again closes keyboard shortcuts. */
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
 * Shows the palette's highlighted command in keyboard shortcuts, as `⌥⏎` asks. With none
 * highlighted, the palette says why instead. Returns `true`, or why it didn't.
 */
export function showHighlighted(): true | string {
  if (current?.kind !== 'palette') return 'No command highlighted';
  const id = highlighted;
  if (id === undefined) {
    const why = 'No commands match';
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

/** Lo's own keys in a code view while Vim keys are off: the rest of Vim's own are Vim's alone. */
const plain = new Set<string>(Object.values(plainKeys));

/** Whether `command` is one of Vim's own keys that only Vim has, such as `v`. */
function vimOnly(command: Command): boolean {
  if (command.vim !== 'own') return false;
  return !command.keys.every((spec) => plain.has(typeof spec === 'string' ? spec : spec.keys));
}

/** Keyboard shortcuts' lists, for what had focus as it opened. */
function helpOf(open: Extract<Overlay, { kind: 'help' }> | undefined, vim: boolean) {
  const options: HelpOptions = { vim, vimOnly, all: true };
  const here = open ? helpHere(registry(), open.scope, open.target, options) : [];
  const show = open?.show;
  // A command shown is shown in "Here" if it's there, or else in the first area it works in.
  const shownHere = here.some(({ rows }) => rows.some((row) => row.ids.includes(show ?? '')));
  return {
    here,
    areas: open ? helpAreas(registry(), options) : [],
    all: open ? helpAll(registry(), options) : [],
    show,
    showIn: show === undefined || shownHere ? HERE : areaOfCommand(registry(), show),
  };
}

/** Keyboard shortcuts and the command palette, over the window. */
export function Overlays() {
  const open = useSyncExternalStore(subscribe, overlay);
  const keymap = useSyncExternalStore(subscribeKeymap, keymapState);
  const vim = useSyncExternalStore(onVim, vimOn);
  useKeys();
  const container = document.getElementById('root');
  const help = helpOf(open?.kind === 'help' ? open : undefined, vim);
  return (
    <>
      <KeyHelp
        open={open?.kind === 'help'}
        onOpenChange={(next) => {
          if (!next) closeOverlay();
        }}
        here={help.here}
        areas={help.areas}
        all={help.all}
        errors={registry().keymapErrors()}
        // Without a button for the file, what's wrong with it, or why Lo won't open it.
        problem={keymapProblem()}
        onOpenKeymap={
          // Without a file Lo will open, there's no button, and nothing to offer.
          keymap.canOpen
            ? () => {
                registry().run('keys.openKeymap', NO_TARGET);
              }
            : undefined
        }
        show={help.show}
        showIn={help.showIn}
        closeKeys={labels('esc')}
        container={container}
        onClosed={closed}
      />
      <CommandPalette open={open?.kind === 'palette' ? open : undefined} container={container} />
    </>
  );
}

/**
 * A label as it reads, what's between backticks set as code, with the letters the query matched
 * marked: `marks` index the label without its backticks.
 */
function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  const marked = new Set(marks);
  const runs: { text: string; code: boolean; marked: boolean }[] = [];
  let code = false;
  let at = 0;
  for (const letter of text) {
    if (letter === '`') {
      code = !code;
      continue;
    }
    const mark = marked.has(at);
    at += letter.length;
    const last = runs.at(-1);
    if (last && last.code === code && last.marked === mark) last.text += letter;
    else runs.push({ text: letter, code, marked: mark });
  }
  return runs.map((run, index) => {
    const letters = run.marked ? (
      <mark className="bg-transparent font-semibold text-fg-accent">{run.text}</mark>
    ) : (
      run.text
    );
    return run.code ? (
      <span key={index} className="code-small">
        {letters}
      </span>
    ) : (
      <Fragment key={index}>{letters}</Fragment>
    );
  });
}

/** A count of commands: "1 command", "80 commands". */
function commands(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'command' : 'commands'}`;
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
  // Grouped as keyboard shortcuts is while nothing's typed; the best match first once something is.
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
      placeholder="Search commands"
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
        // As its key would run it, there, so a motion goes from a header as from a line.
        closeOverlay(() => {
          registry().run(match.item.id, target, undefined, true);
        });
      }}
      renderItem={({ item, marks }) => (
        <>
          <span className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap">
              <Marked text={item.label} marks={marks} />
            </span>
            {item.description !== undefined && (
              <span className="truncate text-fg-muted text-small">{item.description}</span>
            )}
          </span>
          {typed && <span className="min-w-0 truncate text-fg-muted text-small">{item.group}</span>}
          <span className="ms-auto flex flex-none items-center gap-8">
            {item.keys && <Key keys={item.keys} decorative />}
          </span>
        </>
      )}
      empty={`No commands match “${query}”`}
      foot={
        <>
          <span className="lo-num">
            {typed
              ? `${matches.length.toLocaleString('en')} of ${commands(items.length)}`
              : commands(items.length)}
          </span>
          <span role="status" className="text-fg">
            {open?.notice}
          </span>
          <span className="flex-1" />
          <PaletteHint keys={labels('enter')}>Run</PaletteHint>
          {showKey && (
            <PaletteHint keys={showKey} onClick={() => registry().run('keys.showKey', NO_TARGET)}>
              Show key
            </PaletteHint>
          )}
          <PaletteHint keys={labels('esc')}>Close</PaletteHint>
        </>
      }
      container={container}
    />
  );
}

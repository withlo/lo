// The file finder over the window (`⌘P`): any file in the repository, found by name, the changed
// ones first and marked, on the same palette the command palette and the open box use.

import { FileIcon, FileMarks, Palette, PaletteHint, Spinner, Tag } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useActiveTab, useChangedFiles } from '../../tab/window/shared.ts';
import { PATH_LIMIT, type TreeState } from '../contract.ts';
import {
  changesByKey,
  countText,
  enterAction,
  groupsOf,
  itemsOf,
  placeOf,
  viewedByPath,
  type Item,
  type Shown,
} from './found.ts';
import {
  closeFinder,
  finderClosed,
  finderStore,
  go,
  highlight,
  showing,
  typeQuery,
  type FinderState,
} from './finding.ts';
import { states } from './store.ts';

const FILE_ICON = (
  <svg className="lo-i text-fg-muted" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 2h5l2.5 2.5V14h-7.5Z" />
    <path d="M9.5 2v2.5H12" />
  </svg>
);

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

/** Text with the letters the query matched marked. */
function Marked({ text, marks }: Shown) {
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

/** A file's row: its name, the folder it's in, and how the pull request changes it, if it does. */
function Row({ item }: { item: Item }) {
  const place = placeOf(item.path.text, item.matched);
  const dim = !item.changed;
  return (
    <>
      <FileIcon dim={dim} />
      <span
        className={`whitespace-nowrap ${dim ? 'text-fg-dim' : ''} ${item.change === 'deleted' ? 'text-fg-muted line-through decoration-fg-subtle' : ''}`}
        title={place.title}
      >
        <Marked {...place.name} />
      </span>
      {place.folder.text !== '' && (
        <span className="min-w-0 truncate text-fg-muted text-small">
          <Marked {...place.folder} />
        </span>
      )}
      <span className="ms-auto flex flex-none items-center gap-8">
        {item.change ? (
          <FileMarks change={item.change} viewed={item.viewed} />
        ) : (
          !item.changed && <span className="text-fg-muted text-small">whole file</span>
        )}
      </span>
    </>
  );
}

/** What the list says when there's nothing to list. */
function emptyOf(state: FinderState, tree: TreeState | undefined): ReactNode {
  if (state.problem !== undefined) return state.problem;
  if (state.answer === undefined) {
    const reading =
      tree === undefined || (tree.listing.kind === 'loading' && tree.changes === null);
    return (
      <span className="inline-flex items-center gap-8">
        <Spinner size="xs" />
        {reading ? 'Reading the files…' : 'Looking…'}
      </span>
    );
  }
  const typed = state.query.trim() !== '';
  if (state.changedOnly) {
    return typed
      ? `No changed file matches "${state.query}".`
      : 'This pull request changes no files.';
  }
  return typed ? `No file matches "${state.query}".` : 'There are no files to find.';
}

/** What the finder says about the files it can't list, if anything. */
function noteOf(tree: TreeState | undefined): string | undefined {
  if (!tree) return undefined;
  const notes: string[] = [];
  if (tree.listing.kind === 'changed')
    notes.push(`Only changed files can be found. ${tree.listing.why}`);
  if (tree.omitted > 0) {
    notes.push(
      `${tree.omitted.toLocaleString('en')} unchanged ${tree.omitted === 1 ? 'file has a path' : 'files have paths'} longer than ${PATH_LIMIT.toLocaleString('en')} bytes, which the finder leaves out.`,
    );
  }
  if (tree.problem !== null) notes.push(tree.problem);
  return notes.length === 0 ? undefined : notes.join(' ');
}

/**
 * How many files the repository has, once the tree has said: those at the head, which the listing
 * names one each, and the deleted files the pull request removes, which the finder lists too.
 */
function fileCount(listing: TreeState['listing'] | undefined, changes: TreeState['changes']) {
  if (listing?.kind !== 'whole') return undefined;
  return (
    listing.entries.length + (changes?.filter((each) => each.change === 'deleted').length ?? 0)
  );
}

/** The file finder, over the window while it's open. */
export function Finder() {
  const state = useStore(finderStore);
  useKeys();
  const tab = state.tab;
  const tree = useSyncExternalStore(states.subscribe, () =>
    tab === undefined ? undefined : states.get(tab),
  );
  const viewedFiles = useChangedFiles(tab ?? '');
  const active = useActiveTab();
  const changes = useMemo(() => changesByKey(tree?.changes ?? null), [tree?.changes]);
  const viewed = useMemo(() => viewedByPath(viewedFiles?.files ?? []), [viewedFiles]);
  const items = useMemo(
    () => itemsOf(state.answer, changes, viewed, state.changedOnly),
    [state.answer, changes, viewed, state.changedOnly],
  );
  const groups = useMemo(() => groupsOf(items, state.repo), [items, state.repo]);
  const files = useMemo(
    () => fileCount(tree?.listing, tree?.changes ?? null),
    [tree?.listing, tree?.changes],
  );

  // The finder is for the tab it opened over: it goes if another is shown, or that one closes.
  useEffect(() => {
    if (state.open && active?.id !== tab) closeFinder();
  }, [state.open, active?.id, tab]);
  // The keys act only on what's listed.
  useEffect(() => {
    showing(items);
  }, [items]);

  const highlighted = items.find((item) => item.id === state.highlighted);
  const enter = enterAction(highlighted);
  const whole = keyOf('tree.findWhole');
  const onlyChanged = keyOf('tree.findChanged');
  const note = noteOf(tree);
  return (
    <Palette<Item>
      open={state.open}
      onOpenChange={(next) => {
        if (!next) closeFinder();
      }}
      onClosed={finderClosed}
      returnFocus={false}
      label="Go to a file"
      placeholder="Find a file by name"
      keys={keyOf('tree.find')}
      icon={FILE_ICON}
      query={state.query}
      onQueryChange={typeQuery}
      groups={groups}
      itemId={(item) => item.id}
      onHighlight={highlight}
      onRun={(item) => go(item, 'show')}
      renderItem={(item) => <Row item={item} />}
      empty={emptyOf(state, tree)}
      foot={
        <>
          <span className="lo-num">
            {countText(state.answer, items.length, files, tree?.changes?.length, state.changedOnly)}
          </span>
          {state.changedOnly && <Tag>Changed only</Tag>}
          {note !== undefined && (
            <span role="status" className="min-w-0">
              {note}
            </span>
          )}
          <span className="flex-1" />
          {enter !== undefined && <PaletteHint keys={labels('enter')}>{enter}</PaletteHint>}
          {whole && highlighted && <PaletteHint keys={whole}>Whole file</PaletteHint>}
          {onlyChanged && (
            <PaletteHint keys={onlyChanged}>
              {state.changedOnly ? 'All files' : 'Changed only'}
            </PaletteHint>
          )}
        </>
      }
      container={document.getElementById('root')}
    />
  );
}

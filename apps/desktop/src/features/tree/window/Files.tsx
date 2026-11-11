// The files of a pull request's tab, in its left panel: the tree, or the changed files in review
// order, with the tools that switch between them and filter to the changed files, and a note when
// only some of the files can show.

import { FileTree, FileTreePanel, Skeleton, type FileTreeRow } from '@lo/ui';
import { keyLabels, setScopeSource, type Target } from '@lo/ui/commands';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { currentMenu, openMenu } from '../../../window/commands/menus.tsx';
import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useChangedFiles, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { PATH_LIMIT, pathBytes, type TreeState } from '../contract.ts';
import { model as modelOf, type Row, type Viewed } from './model.ts';
import {
  askFolders,
  catchUp,
  choices,
  focus,
  folders,
  onScreen,
  reveal,
  shown,
  states,
} from './store.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The row as the tree draws it. */
function drawn(row: Row): FileTreeRow {
  switch (row.kind) {
    case 'group':
      return row;
    case 'folder':
      return {
        kind: 'folder',
        key: row.key,
        names: row.names,
        depth: row.depth,
        open: row.open,
        changes: row.changes,
        loading: row.loading,
      };
    case 'file':
      return {
        kind: 'file',
        key: row.key,
        name: row.name,
        depth: row.depth,
        entry: row.entry,
        change: row.change,
        previous: row.previous,
        generated: row.generated !== null,
        viewed: row.viewed,
        folder: row.folder,
        title: row.title,
      };
    default:
      row satisfies never;
      throw new Error(`A row Lo doesn't know: ${JSON.stringify(row)}.`);
  }
}

/** What the panel says over the files, when only some of them can show. */
function noteOf(state: TreeState | undefined, omitted: number): ReactNode {
  if (!state) return undefined;
  const notes: string[] = [];
  const long = state.omitted + omitted;
  if (long > 0) {
    notes.push(
      `${long.toLocaleString('en')} unchanged ${long === 1 ? 'file has a path' : 'files have paths'} longer than ${PATH_LIMIT.toLocaleString('en')} bytes, which the tree leaves out.`,
    );
  }
  if (state.listing.kind === 'changed') notes.push(state.listing.why);
  if (state.partial) {
    notes.push(
      'GitHub lists only some of the changed files, so the rest show once the local copy is ready.',
    );
  }
  if (state.problem !== null) notes.push(state.problem);
  if (notes.length === 0) return undefined;
  return notes.map((note) => <p key={note}>{note}</p>);
}

/** The target a key in the tree acts on: the file the keyboard is on, or nothing on a folder. */
export function treeTarget(tab: string): Target {
  const key = focus.get(tab);
  const row = shown.get(tab)?.rows.find((each) => each.key === key);
  return row?.kind === 'file' ? { kind: 'file', file: row.key } : { kind: 'none' };
}

/** Skeleton rows, while the files are on their way. */
function Loading() {
  return (
    <div
      className="flex flex-col gap-12 px-16 py-8"
      aria-busy="true"
      aria-label="Loading the files"
    >
      {[60, 45, 70, 50].map((width) => (
        <Skeleton key={width} className={width > 55 ? 'w-3/4' : 'w-1/2'} />
      ))}
    </div>
  );
}

/** A pull request's tab's files, in its left panel. */
export function Files({
  tab,
  onRow,
}: {
  tab: PullTab;
  /** A row was clicked: a folder opens or closes, a file shows. */
  onRow: (tab: string, key: string, twisty: boolean) => void;
}) {
  // Key caps follow the keymap file.
  useKeys();
  const state = useTabState(states, tab.id);
  const sent = useTabState(folders, tab.id);
  const chosen = useTabState(choices, tab.id);
  const focused = useTabState(focus, tab.id);
  const current = useTabState(onScreen, tab.id);
  const revealed = useTabState(reveal, tab.id);
  const changed = useChangedFiles(tab.id);

  useEffect(() => {
    if (states.get(tab.id) === undefined) catchUp(tab.id);
  }, [tab.id]);

  const viewed = useMemo(
    () =>
      new Map<string, Viewed>(
        // GitHub's paths, kept only while they're short enough to key a map by.
        changed?.files.flatMap((file) =>
          pathBytes({ text: file.path }) <= PATH_LIMIT ? [[file.path, file.viewed] as const] : [],
        ) ?? [],
      ),
    [changed],
  );
  const model = useMemo(
    () => (state ? modelOf(state, sent.entries, viewed, chosen) : undefined),
    [state, sent, viewed, chosen],
  );
  if (model) shown.set(tab.id, model);
  else shown.delete(tab.id);

  // The folders open with nothing in them yet.
  useEffect(() => {
    const at = state?.at;
    if (model && at && model.wanted.length > 0) askFolders(tab.id, at, model.wanted);
  }, [model, state?.at, tab.id]);

  // Keys in the tree act on the row the keyboard is on.
  const stop = useRef<(() => void) | undefined>(undefined);
  const treeRef = useCallback(
    (element: HTMLDivElement | null) => {
      stop.current?.();
      stop.current = element
        ? setScopeSource(element, { target: () => treeTarget(tab.id) })
        : undefined;
    },
    [tab.id],
  );

  const rows = useMemo(() => model?.rows.map(drawn) ?? [], [model]);
  const viewedCount = changed && {
    viewed: changed.files.filter((file) => file.viewed === 'viewed').length,
    total: changed.total,
  };
  const loading = !state || (state.listing.kind === 'loading' && state.changes === null);

  return (
    <FileTreePanel
      viewed={viewedCount || undefined}
      mode={chosen.mode}
      onMode={(mode) => choices.update(tab.id, (now) => ({ ...now, mode }))}
      modeKeys={keyOf('tree.mode')}
      changedOnly={chosen.changedOnly}
      onChangedOnly={(changedOnly) => choices.update(tab.id, (now) => ({ ...now, changedOnly }))}
      changedOnlyKeys={keyOf('tree.changedOnly')}
      note={noteOf(state, model?.omitted ?? 0)}
    >
      {loading ? (
        <Loading />
      ) : (
        <FileTree
          treeRef={treeRef}
          data-lo-scope="tree"
          aria-label={chosen.mode === 'review' ? 'Changed files in review order' : 'Files'}
          rows={rows}
          focused={focused}
          current={current}
          reveal={revealed}
          onRowClick={(key, twisty) => {
            focus.set(tab.id, key);
            onRow(tab.id, key, twisty);
          }}
          onFileMenu={(key, event) => {
            // The browser's own event for the key that opened a menu, which is open.
            if (currentMenu() !== undefined) {
              event.preventDefault();
              return;
            }
            focus.set(tab.id, key);
            if (openMenu({ kind: 'file', file: key }, { x: event.clientX, y: event.clientY })) {
              event.preventDefault();
            }
          }}
        />
      )}
    </FileTreePanel>
  );
}

import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { EmptyState } from './EmptyState.tsx';
import { SettingsListItem } from './Settings.tsx';

/** A toolchain language servers use, as Settings lists it: one Lo downloads, or the system's. */
export type ToolchainEntry = DownloadedToolchain | SystemToolchain;

/** A toolchain Lo downloads. */
export interface DownloadedToolchain {
  kind?: 'download' | undefined;
  /** What identifies it, and what `onRemove` names. */
  id: string;
  /** "Go". */
  name: string;
  /** "1.27.4". */
  version: string;
  /** How much room its files take, "229.1 MB", or `undefined` while it isn't downloaded. */
  installed?: string | undefined;
  /** How large its download is, "65.1 MB". */
  download: string;
  /** The language servers that use it, by name. */
  uses: readonly string[];
  /** Whether it's being deleted: its button is busy, and takes no press, until it's done. */
  removing?: boolean | undefined;
  /** Why deleting it didn't work, under its line, while that holds. */
  problem?: ReactNode;
}

/**
 * A toolchain of the system's, which Lo doesn't download, as Swift's comes with Xcode: it has no
 * version of Lo's, and nothing to remove.
 */
export interface SystemToolchain {
  kind: 'system';
  id: string;
  /** "Swift". */
  name: string;
  /** Where the copy Lo runs is from, "Xcode", or `undefined` while there's none. */
  from?: string | undefined;
  /** What it needs while there's none: "Apple’s Command Line Tools". */
  needs: string;
  /** The language servers that use it, by name. */
  uses: readonly string[];
}

/** Whether `entry` is one of Lo’s, downloaded, so it has a "Delete". */
function downloaded(entry: ToolchainEntry): entry is DownloadedToolchain {
  return entry.kind !== 'system' && entry.installed !== undefined;
}

export interface ToolchainRowProps {
  entry: ToolchainEntry;
  /** Delete was pressed: the servers that use it stop, and its files go. */
  onRemove?: ((id: string) => void) | undefined;
}

/** `names` as a sentence lists them: "Java", "Java and Kotlin", "C, Java and Kotlin". */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What a row says under its name: how large it is, or where it's from, or what it needs, and what
 * uses it.
 */
function described(entry: ToolchainEntry): string {
  const uses = entry.uses.length === 0 ? 'Not used yet' : `For ${listed(entry.uses)}`;
  if (entry.kind === 'system') {
    return `${entry.from === undefined ? `Needs ${entry.needs}` : `From ${entry.from}`} · ${uses}`;
  }
  const size =
    entry.installed === undefined ? `Not downloaded · ${entry.download}` : entry.installed;
  return `${size} · ${uses}`;
}

/**
 * One toolchain as an item of Settings' list: its name and version, how much room it takes or that
 * it isn't downloaded and how large it is, what uses it, and, once it's downloaded, the button that
 * deletes it. One of the system's says where it's from, or what it needs, and has no button.
 */
export function ToolchainRow({ entry, onRemove }: ToolchainRowProps) {
  const removing = entry.kind !== 'system' && entry.removing === true;
  return (
    <SettingsListItem
      data={{ 'data-id': entry.id }}
      label={
        entry.kind === 'system' ? (
          entry.name
        ) : (
          <span>
            {entry.name} <span className="tabular-nums">{entry.version}</span>
          </span>
        )
      }
      description={<span className="tabular-nums">{described(entry)}</span>}
      note={entry.kind === 'system' ? undefined : entry.problem}
    >
      {downloaded(entry) && (
        <Button
          variant="ghost"
          size="sm"
          align="end"
          busy={removing}
          working="Deleting…"
          aria-label={`Delete ${entry.name}`}
          onClick={() => onRemove?.(entry.id)}
        >
          Delete
        </Button>
      )}
    </SettingsListItem>
  );
}

export interface ToolchainListProps {
  entries: readonly ToolchainEntry[];
  onRemove?: ((id: string) => void) | undefined;
}

/** A toolchain being removed, and the row focus goes to once its button is gone. */
interface Removal {
  id: string;
  /** The next downloaded row's id, else the previous one's, else none: focus goes to the list. */
  next: string | undefined;
}

/**
 * Settings' list of the toolchains Lo downloads for language servers: an item each. Once an item's
 * toolchain is deleted its button goes, and focus doesn't fall to the page with it: it moves to the
 * next downloaded item's "Delete", or the previous one's, or to the list itself when none is left.
 */
export function ToolchainList({ entries, onRemove }: ToolchainListProps) {
  const list = useRef<HTMLDivElement>(null);
  const removal = useRef<Removal | null>(null);
  useLayoutEffect(() => {
    const pending = removal.current;
    const root = list.current;
    if (pending === null || root === null) return;
    const entry = entries.find((each) => each.id === pending.id);
    if (entry !== undefined && downloaded(entry)) {
      // It wasn't removed: its button stays, and focus with it.
      if (entry.removing !== true) removal.current = null;
      return;
    }
    removal.current = null;
    const active = root.ownerDocument.activeElement;
    // Focus that went somewhere else on its own is left where it went.
    if (active !== null && active !== root.ownerDocument.body && !root.contains(active)) return;
    const row = [...root.children].find((child) => child.getAttribute('data-id') === pending.next);
    const target = row?.querySelector('button') ?? root;
    target.focus();
  }, [entries]);
  const remove = (id: string) => {
    const removable = entries.filter(downloaded);
    const at = removable.findIndex((entry) => entry.id === id);
    removal.current = { id, next: (removable[at + 1] ?? removable[at - 1])?.id };
    onRemove?.(id);
  };
  return (
    <div
      ref={list}
      // With nothing to list it's a group holding the empty state, not a list without items.
      role={entries.length === 0 ? 'group' : 'list'}
      aria-label="Toolchains"
      tabIndex={-1}
      className="outline-none focus-visible:shadow-ring-inset"
    >
      {entries.length === 0 && <EmptyState level={3} title="No toolchains for this computer" />}
      {entries.map((entry) => (
        <ToolchainRow key={entry.id} entry={entry} onRemove={remove} />
      ))}
    </div>
  );
}

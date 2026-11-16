import { useLayoutEffect, useRef } from 'react';

import { Button } from './Button.tsx';
import { Setting } from './Settings.tsx';
import { Spinner } from './Spinner.tsx';

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
  /** Whether it's being removed: its button waits, and takes no press, until it's done. */
  removing?: boolean | undefined;
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

/** Whether `entry` is one of Lo's, downloaded, so it has a "Remove". */
function downloaded(entry: ToolchainEntry): entry is DownloadedToolchain {
  return entry.kind !== 'system' && entry.installed !== undefined;
}

export interface ToolchainRowProps {
  entry: ToolchainEntry;
  /** Remove was pressed: the servers that use it stop, and its files go. */
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
  const uses =
    entry.uses.length === 0 ? 'No language server uses it yet' : `For ${listed(entry.uses)}`;
  if (entry.kind === 'system') {
    return `${entry.from === undefined ? `Needs ${entry.needs}` : `From ${entry.from}`} · ${uses}`;
  }
  const size =
    entry.installed === undefined ? `Not downloaded · ${entry.download}` : entry.installed;
  return `${size} · ${uses}`;
}

/**
 * One toolchain as a setting: its name and version, how much room it takes or that it isn't
 * downloaded and how large it is, what uses it, and, once it's downloaded, the button that
 * removes it. One of the system's says where it's from, or what it needs, and has no button.
 */
export function ToolchainRow({ entry, onRemove }: ToolchainRowProps) {
  return (
    <Setting
      label={
        entry.kind === 'system' ? (
          entry.name
        ) : (
          <>
            {entry.name} <span className="tabular-nums">{entry.version}</span>
          </>
        )
      }
      description={<span className="tabular-nums">{described(entry)}</span>}
    >
      {downloaded(entry) && (
        <Button
          variant="ghost"
          size="sm"
          // Not `disabled`, which would drop focus from it.
          aria-disabled={entry.removing === true ? true : undefined}
          aria-label={`${entry.removing === true ? 'Removing' : 'Remove'} ${entry.name}`}
          onClick={() => {
            if (entry.removing !== true) onRemove?.(entry.id);
          }}
        >
          {entry.removing === true ? (
            <span className="inline-flex items-center gap-6">
              <Spinner size="xs" />
              Removing
            </span>
          ) : (
            'Remove'
          )}
        </Button>
      )}
    </Setting>
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
 * Settings' list of the toolchains Lo downloads for language servers: a row each. Once a row's
 * toolchain is removed its button goes, and focus doesn't fall to the page with it: it moves to the
 * next downloaded row's "Remove", or the previous one's, or to the list itself when none is left.
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
      // With nothing to list it's a group holding the line, not a list without items.
      role={entries.length === 0 ? 'group' : 'list'}
      aria-label="Toolchains"
      tabIndex={-1}
      className="outline-none focus-visible:shadow-ring-inset"
    >
      {entries.length === 0 && (
        <p className="m-0 border-t border-border-subtle py-12 text-fg-muted text-ui">
          Lo downloads no toolchains for this system.
        </p>
      )}
      {entries.map((entry) => (
        <div key={entry.id} role="listitem" data-id={entry.id}>
          <ToolchainRow entry={entry} onRemove={remove} />
        </div>
      ))}
    </div>
  );
}

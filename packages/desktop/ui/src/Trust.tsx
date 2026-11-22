import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { showFormat } from './controls.ts';
import { EmptyState } from './EmptyState.tsx';
import { SettingsListItem } from './Settings.tsx';
import { ShownText } from './ShownText.tsx';

/** What a trust entry covers: every pull request of a repo, or one pull request from a fork. */
export type TrustKind = 'repo' | 'fork';

/** One thing the reader trusts, as Settings lists it. */
export interface TrustEntry {
  /** What identifies it, and what `onRemove` names. */
  key: string;
  /** Its name, as GitHub writes it: `fieldwork/atlas-api`, or `sam-whit/atlas-api#4833`. */
  name: string;
  kind: TrustKind;
  /** When it was trusted, or where it came from: "trusted 12 d ago", "added in `settings.json`". */
  trusted: ReactNode;
  /** Why stopping trusting it didn't work, under its line, while that holds. */
  problem?: ReactNode;
}

export interface TrustRowProps {
  entry: TrustEntry;
  /** "Stop trusting" was pressed: its language servers stop at once. */
  onRemove?: ((key: string) => void) | undefined;
}

const KIND: Record<TrustKind, string> = {
  repo: 'Repo',
  fork: 'Pull request from a fork',
};

/**
 * One trusted repo, or one trusted pull request from a fork, as an item of Settings' list: its name,
 * as plain text as a repo's name is, what it covers and since when, and the button that stops
 * trusting it.
 */
export function TrustRow({ entry, onRemove }: TrustRowProps) {
  return (
    <SettingsListItem
      data={{ 'data-key': entry.key }}
      label={
        <span className="min-w-0 truncate text-fg">
          <ShownText text={entry.name} />
        </span>
      }
      description={
        <>
          {KIND[entry.kind]} · {entry.trusted}
        </>
      }
      note={entry.problem}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Stop trusting ${showFormat(entry.name)}`}
        onClick={() => onRemove?.(entry.key)}
      >
        Stop trusting
      </Button>
    </SettingsListItem>
  );
}

export interface TrustListProps {
  entries: readonly TrustEntry[];
  onRemove?: ((key: string) => void) | undefined;
}

/** A row that was removed, and the one focus goes to once it's gone. */
interface Removal {
  key: string;
  /** The next row's key, else the previous one's, else none: focus goes to the list. */
  next: string | undefined;
}

/**
 * Settings' list of what the reader trusts: an item each, or a heading saying there's none. Stopping
 * trusting one stops that repo's language servers and turns them off for its pull requests. Focus
 * doesn't fall to the page with the button that had it: it moves to the next item's "Stop
 * trusting", or the previous one's when the last item went, or to the list itself when nothing is
 * left.
 */
export function TrustList({ entries, onRemove }: TrustListProps) {
  const list = useRef<HTMLDivElement>(null);
  const removal = useRef<Removal | null>(null);
  // Once the row is gone, as the caller shows it, whatever had focus in it is gone too.
  useLayoutEffect(() => {
    const pending = removal.current;
    const root = list.current;
    if (pending === null || root === null) return;
    if (entries.some((entry) => entry.key === pending.key)) return;
    removal.current = null;
    const active = root.ownerDocument.activeElement;
    // Focus that went somewhere else on its own is left where it went.
    if (active !== null && active !== root.ownerDocument.body && !root.contains(active)) return;
    const row = [...root.children].find((child) => child.getAttribute('data-key') === pending.next);
    const target = row?.querySelector('button') ?? root;
    target.focus();
  }, [entries]);
  const remove = (key: string) => {
    const at = entries.findIndex((entry) => entry.key === key);
    removal.current = { key, next: (entries[at + 1] ?? entries[at - 1])?.key };
    onRemove?.(key);
  };
  return (
    <div
      ref={list}
      // With nothing to list it's a group holding the empty state, not a list without items. It's
      // the same element either way, so it can take focus when the last row goes.
      role={entries.length === 0 ? 'group' : 'list'}
      aria-label="Trusted repos and pull requests"
      tabIndex={-1}
      className="outline-none focus-visible:shadow-ring-inset"
    >
      {entries.length === 0 && <EmptyState level={3} title="No trusted repos or pull requests" />}
      {entries.map((entry) => (
        <TrustRow key={entry.key} entry={entry} onRemove={remove} />
      ))}
    </div>
  );
}

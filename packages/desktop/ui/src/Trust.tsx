import { useLayoutEffect, useRef } from 'react';

import { Button } from './Button.tsx';
import { showControls } from './controls.ts';
import { Setting } from './Settings.tsx';

/** What a trust entry covers: every pull request of a repo, or one pull request from a fork. */
export type TrustKind = 'repo' | 'fork';

/** One thing the reader trusts, as Settings lists it. */
export interface TrustEntry {
  /** What identifies it, and what `onRemove` names. */
  key: string;
  /** Its name, as GitHub writes it: `fieldwork/atlas-api`, or `sam-whit/atlas-api#4833`. */
  name: string;
  kind: TrustKind;
  /** How long ago it was trusted, as the row says it: "12 days ago", "today". */
  trusted: string;
}

export interface TrustRowProps {
  entry: TrustEntry;
  /** Remove was pressed: its language servers stop at once. */
  onRemove?: ((key: string) => void) | undefined;
}

const KIND: Record<TrustKind, string> = {
  repo: 'Repo',
  fork: 'One PR from a fork',
};

/**
 * One trusted repo, or one trusted pull request from a fork, as a setting: its name in the code
 * font, what it covers and since when, and the button that takes the trust away.
 */
export function TrustRow({ entry, onRemove }: TrustRowProps) {
  return (
    <Setting
      label={<span className="text-fg code-small">{showControls(entry.name)}</span>}
      description={`${KIND[entry.kind]} · trusted ${entry.trusted}`}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Remove ${showControls(entry.name)}`}
        onClick={() => onRemove?.(entry.key)}
      >
        Remove
      </Button>
    </Setting>
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
 * Settings' list of what the reader trusts: a row each, or a line saying nothing is yet. Removing a
 * row stops that repo's language servers and turns them off for its pull requests. Focus doesn't
 * fall to the page with the button that had it: it moves to the next row's "Remove", or the
 * previous one's when the last row went, or to the list itself when nothing is left.
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
      // With nothing to list it's a group holding the line, not a list without items. It's the
      // same element either way, so it can take focus when the last row goes.
      role={entries.length === 0 ? 'group' : 'list'}
      aria-label="Trusted repos and PRs"
      tabIndex={-1}
      className="outline-none focus-visible:shadow-ring-inset"
    >
      {entries.length === 0 && (
        <p className="m-0 border-t border-border-subtle py-12 text-fg-muted text-ui">
          Nothing is trusted yet. Trust a repo or a PR from the language servers item in the status
          bar, or from the command palette.
        </p>
      )}
      {entries.map((entry) => (
        <div key={entry.key} role="listitem" data-key={entry.key}>
          <TrustRow entry={entry} onRemove={remove} />
        </div>
      ))}
    </div>
  );
}

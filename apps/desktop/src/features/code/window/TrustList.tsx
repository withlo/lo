// Settings' list of what the reader trusts: a row each, its name, what it covers and since when,
// with "Remove". Shaped as `ui`'s trust rows will be, so the list can move there as it is.

import { Button, Setting } from '@lo/ui';

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

const KIND: Record<TrustKind, string> = {
  repo: 'Repo',
  fork: 'One PR from a fork',
};

/** One trusted repo, or one trusted pull request from a fork, as a setting. */
export function TrustRow({
  entry,
  onRemove,
}: {
  entry: TrustEntry;
  onRemove?: ((key: string) => void) | undefined;
}) {
  return (
    <Setting
      label={<span className="text-fg code-small">{entry.name}</span>}
      description={`${KIND[entry.kind]} · trusted ${entry.trusted}`}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Remove ${entry.name}`}
        onClick={() => onRemove?.(entry.key)}
      >
        Remove
      </Button>
    </Setting>
  );
}

/** A row each, or a line saying nothing is trusted yet. */
export function TrustList({
  entries,
  onRemove,
}: {
  entries: readonly TrustEntry[];
  onRemove?: ((key: string) => void) | undefined;
}) {
  if (entries.length === 0) {
    return (
      <p className="m-0 border-t border-border-subtle py-12 text-fg-muted text-ui">
        Nothing is trusted yet. Trust a repo or a PR from the banner on its tab.
      </p>
    );
  }
  return (
    <div role="list" aria-label="Trusted repos and PRs">
      {entries.map((entry) => (
        <div key={entry.key} role="listitem">
          <TrustRow entry={entry} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

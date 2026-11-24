// Settings' Kept drafts row, in Storage: each open pull request with kept drafts, those the diff
// took down open that no box has taken since, how many, and "Show", which runs the command the
// palette has on that pull request's tab.

import { EmptyState, SettingsCommand, SettingsList, SettingsListItem } from '@lo/ui';
import { useSyncExternalStore } from 'react';

import { defineRow } from '../../settings/window/shared.ts';
import { onScreen, type Tab } from '../../tab/contract.ts';
import { useTabs, useTabState } from '../../tab/window/shared.ts';
import { keptAway } from './boxes.ts';

/** A pull request's tab as the view it shows, which its kept drafts are kept by. */
type Shown = Extract<Tab, { kind: 'pull' }>;

/** One pull request's kept drafts: how many, and "Show". */
function Item({ view }: { view: Shown }) {
  const count = useTabState(keptAway, view.id, (kept) => kept.length);
  if (count === 0) return null;
  const name = `${view.owner}/${view.repo}#${view.number}`;
  return (
    <SettingsListItem
      label={<span className="truncate">{name}</span>}
      description={count === 1 ? '1 kept draft' : `${count} kept drafts`}
      data={{ 'data-view': view.id }}
    >
      <SettingsCommand
        command="comments.keptDrafts"
        target={{ kind: 'tab', tab: view.id }}
        size="sm"
        aria-label={`Show kept drafts of ${name}`}
      >
        Show kept drafts
      </SettingsCommand>
    </SettingsListItem>
  );
}

function KeptDrafts({ label, description }: { label: string; description: string }) {
  const { tabs } = useTabs();
  const views = tabs.flatMap((tab) => (tab.kind === 'pull' ? [onScreen(tab)] : []));
  // Whether any of them keeps a draft now, so it follows each view's.
  const any = useSyncExternalStore(keptAway.subscribe, () =>
    views.some((view) => keptAway.get(view.id).length > 0),
  );
  return (
    <SettingsList label={label} description={description}>
      {any ? (
        <div role="list" aria-label="Kept drafts">
          {views.map((view) => (view.kind === 'pull' ? <Item key={view.id} view={view} /> : null))}
        </div>
      ) : (
        <EmptyState level={3} title="No kept drafts" />
      )}
    </SettingsList>
  );
}

export default defineRow({
  id: 'comments.kept',
  group: 'storage',
  // After the cache (10) and its size limit (20).
  order: 30,
  label: 'Kept drafts',
  description: 'Drafts whose lines aren’t in the diff in view.',
  words: () => ['draft', 'comment'],
  render: KeptDrafts,
});

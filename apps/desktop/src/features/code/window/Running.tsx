// Settings' Language servers row: each open pull request whose language servers run, with how each
// server is, as its status bar item says it, and "Restart" and "Show log", which run the commands
// the palette has on that pull request's tab.

import {
  ServerWords,
  SettingsCommand,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
} from '@lo/ui';
import { Fragment, useEffect, useSyncExternalStore } from 'react';

import { defineRow } from '../../settings/window/shared.ts';
import { onScreen, type Tab } from '../../tab/contract.ts';
import { useTabs, useTabState } from '../../tab/window/shared.ts';
import { catchUpServers, itemState, servers } from './servers.ts';

/** A pull request's tab as the view it shows, which its servers are kept by. */
type Shown = Extract<Tab, { kind: 'pull' }>;

/** One pull request's servers: how each is, and the two commands on its tab. */
function Item({ view }: { view: Shown }) {
  const shown = useTabState(servers, view.id);
  if (!shown || shown.servers.length === 0) return null;
  const target = { kind: 'tab', tab: view.id } as const;
  const name = `${view.owner}/${view.repo}#${view.number}`;
  return (
    <SettingsListItem
      label={<span className="truncate">{name}</span>}
      description={shown.servers.map((server, index) => (
        <Fragment key={server.id}>
          {index > 0 && ' · '}
          <ServerWords name={server.name} state={itemState(server.state)} />
        </Fragment>
      ))}
      data={{ 'data-view': view.id }}
    >
      <SettingsCommand
        command="code.restart"
        target={target}
        size="sm"
        aria-label={`Restart language servers of ${name}`}
      >
        Restart
      </SettingsCommand>
      <SettingsCommand
        command="code.log"
        target={target}
        size="sm"
        variant="ghost"
        aria-label={`Show log of ${name}`}
      >
        Show log
      </SettingsCommand>
    </SettingsListItem>
  );
}

function Servers({ label, description }: { label: string; description: string }) {
  const { tabs } = useTabs();
  const views = tabs.flatMap((tab) => (tab.kind === 'pull' ? [onScreen(tab)] : []));
  // Which of them have servers now, as one string, so it follows each view's servers.
  const running = useSyncExternalStore(servers.subscribe, () =>
    views
      .filter((view) => (servers.get(view.id)?.servers.length ?? 0) > 0)
      .map((view) => view.id)
      .join(' '),
  );
  // Main is asked about the servers of a view the window hasn't drawn yet.
  const ids = views.map((view) => view.id).join(' ');
  useEffect(() => {
    for (const id of ids === '' ? [] : ids.split(' ')) catchUpServers(id);
  }, [ids]);
  return (
    <SettingsList label={label} description={description}>
      {running === '' ? (
        <SettingsEmpty
          heading="No language servers running"
          line="Language servers for open pull requests are listed here."
        />
      ) : (
        <div role="list" aria-label="Language servers">
          {views.map((view) => (view.kind === 'pull' ? <Item key={view.id} view={view} /> : null))}
        </div>
      )}
    </SettingsList>
  );
}

export default defineRow({
  id: 'code.serverList',
  group: 'code',
  // After the trusted repos (20), before the toolchains (30).
  order: 25,
  label: 'Language servers',
  description: 'Running for the pull requests open in tabs.',
  words: () => ['restart', 'log', 'language server', 'LSP'],
  render: Servers,
});

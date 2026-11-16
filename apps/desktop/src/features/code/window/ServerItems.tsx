// A pull request's language servers in its tab's status bar: one item for each server its new
// side needs, each opening its details with "Restart", "Show the log" and "Stop trusting this
// repo", and with what its server said, as it said it; one whose license waits for the reader
// offers "Read the license" and "Accept the license" instead. On a view nothing trusts,
// "Language servers off", whose details offer to trust it.

import { ServerStatus, type ServerTrust } from '@lo/ui';
import { useEffect } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import {
  actOnLicense,
  actOnNotice,
  catchUpServers,
  itemState,
  restartServer,
  servers,
  showLog,
} from './servers.ts';
import { askToTrust, statuses, stopTrusting, trustable } from './status.ts';

export function ServerItems({ tab }: { tab: PullTab }) {
  const shown = useTabState(servers, tab.id);
  const status = useTabState(statuses, tab.id);
  useEffect(() => catchUpServers(tab.id), [tab.id]);
  const container = document.getElementById('root');
  if (!shown || !status) return null;
  if (shown.off) {
    const pull = trustable(status, true) === true;
    const trust: ServerTrust | undefined =
      pull || trustable(status, false) === true
        ? { action: pull ? 'pr' : 'repo', onChoose: () => void askToTrust(status, pull) }
        : undefined;
    return (
      <ServerStatus
        name="Language servers"
        state={{ kind: 'off' }}
        trust={trust}
        container={container}
      />
    );
  }
  const stop: ServerTrust | undefined =
    status.trust.kind === 'trusted'
      ? { action: 'stop', onChoose: () => void stopTrusting(status) }
      : undefined;
  return shown.servers.map((server) => {
    // Nothing of a server whose license waits has run: there's nothing to restart, and no log.
    const waits = server.state.kind === 'license';
    return (
      <ServerStatus
        // A server drawn again for a new state keeps its item, and the focus on it.
        key={server.id}
        name={server.name}
        state={itemState(server.state)}
        version={server.version}
        onRestart={waits ? undefined : () => void restartServer(tab.id, server.id, server.name)}
        onShowLog={
          waits ? undefined : () => showLog({ view: tab.id, server: server.id, name: server.name })
        }
        trust={stop}
        license={{
          onRead: () => void actOnLicense(server.id, 'read'),
          onAccept: () => void actOnLicense(server.id, 'accept'),
        }}
        notices={server.notices}
        onNotice={(notice, act) => void actOnNotice(tab.id, server.id, notice, act)}
        container={container}
      />
    );
  });
}

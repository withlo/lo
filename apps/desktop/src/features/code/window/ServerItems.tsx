// A pull request's language servers in its tab's status bar: one item for each server its new
// side needs, each opening its details with "Restart", "Show log" and "Stop trusting"; or, on a
// view nothing trusts, "Language servers off", whose details say what they're off for and offer to
// trust it. They open by themselves once for a repo, at the first `g d` in it. They stay open while
// main asks, their button saying how far it has got: once it's trusted, the item gives way to the
// servers starting, and once trusting failed, they say why.

import { ServerStatus, type ServerTrust } from '@lo/ui';
import { useEffect } from 'react';

import { openSettingsFile } from '../../settings/window/shared.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { catchUpServers, itemState, offered, restartServer, servers, showLog } from './servers.ts';
import {
  askToTrust,
  busyLabel,
  catchUp,
  failures,
  failureTitle,
  offerOf,
  statuses,
  stopTrusting,
  TRUSTING,
} from './status.ts';

export function ServerItems({ tab }: { tab: PullTab }) {
  const shown = useTabState(servers, tab.id);
  const status = useTabState(statuses, tab.id);
  const failure = useTabState(failures, tab.id);
  const open = useTabState(offered, tab.id);
  useEffect(() => catchUpServers(tab.id), [tab.id]);
  useEffect(() => catchUp(tab.id), [tab.id]);
  const container = document.getElementById('root');
  if (!shown || !status) return null;
  if (shown.off) {
    const offer = offerOf(status);
    const pull = offer?.pull;
    const trust: ServerTrust | undefined =
      pull === undefined
        ? undefined
        : {
            action: pull ? 'pr' : 'repo',
            onChoose: () => void askToTrust(status, pull),
            busy: busyLabel(status),
            widest: TRUSTING,
            failure: failure
              ? {
                  title: failureTitle(status, failure),
                  // As an error's body line, a refusal's reason ends as a sentence does.
                  message: failure.refusal === true ? `${failure.message}.` : failure.message,
                  code: failure.code,
                  details: failure.details,
                  fix: failure.file
                    ? {
                        label: (
                          <>
                            Open <code>settings.json</code>
                          </>
                        ),
                        onChoose: () => void openSettingsFile(),
                      }
                    : undefined,
                }
              : undefined,
          };
    return (
      <ServerStatus
        name="Language servers"
        state={{ kind: 'off' }}
        line={offer?.line}
        trust={trust}
        open={open !== 'closed'}
        quiet={open === 'offered'}
        onOpenChange={(next) => offered.set(tab.id, next ? 'open' : 'closed')}
        container={container}
      />
    );
  }
  const stop: ServerTrust | undefined =
    status.trust.kind === 'trusted'
      ? { action: 'stop', onChoose: () => void stopTrusting(status) }
      : undefined;
  return shown.servers.map((server) => (
    <ServerStatus
      // A server drawn again for a new state keeps its item, and the focus on it.
      key={server.id}
      name={server.name}
      state={itemState(server.state)}
      version={server.version}
      onRestart={() => void restartServer(tab.id, server.id, server.name)}
      onShowLog={() => showLog({ view: tab.id, server: server.id, name: server.name })}
      trust={stop}
      container={container}
    />
  ));
}

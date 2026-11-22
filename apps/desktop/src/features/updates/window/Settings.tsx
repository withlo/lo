// Settings' About rows for updates: this Lo's version and the build it is, with "Check now", when
// it last checked and why a check failed; the update on offer, downloading or ready, with what
// this copy can do about it; and whether Lo checks by itself, which is the `updates.check` setting.

import { Button, Problem, Setting, SettingsCommand } from '@lo/ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { ago, defineRow, settingRow } from '../../settings/window/shared.ts';
import type { UpdateState } from '../contract.ts';
import { check as checkSetting } from '../settings.ts';
import { check } from './actions.ts';
import { updatesStore } from './store.ts';
import { progressText } from './words.ts';

/** The time now, again each minute, for a time said as how long ago it was. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const every = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(every);
  }, []);
  return now;
}

/** The update on offer, downloading or ready, and what this copy of Lo can do about it. */
function OnOffer({ state }: { state: UpdateState }) {
  if (state.status === 'idle') return null;
  const whatsNew = (
    <SettingsCommand command="updates.whatsNew" size="sm" variant="ghost">
      What’s new
    </SettingsCommand>
  );
  let title: string;
  let line: string | undefined;
  let actions = whatsNew;
  switch (state.status) {
    case 'available': {
      title = `Lo ${state.version} is available`;
      line = state.failed ?? (state.line === '' ? undefined : state.line);
      const ways = {
        install: ['updates.install', 'Update'],
        brew: ['updates.copy', 'Copy Homebrew command'],
        move: ['updates.move', 'Move Lo to Applications'],
        page: ['updates.download', 'Download update'],
      } as const;
      const [command, label] = ways[state.how];
      if (state.how === 'move') line = 'Updates need Lo in Applications.';
      actions = (
        <>
          {whatsNew}
          <SettingsCommand command={command} size="sm" variant="primary">
            {label}
          </SettingsCommand>
        </>
      );
      break;
    }
    case 'downloading':
      title = `Downloading Lo ${state.version}…`;
      line = progressText(state.received, state.total);
      break;
    case 'ready':
      title = `Lo ${state.version} is ready`;
      actions = (
        <SettingsCommand command="updates.restart" size="sm" variant="primary">
          Restart to update
        </SettingsCommand>
      );
      break;
    default:
      throw new Error(`An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
  return (
    <div className="flex items-center gap-8 rounded-md border border-border-subtle p-8">
      <div className="min-w-0 flex-1">
        <div className="text-ui-strong">{title}</div>
        {line !== undefined && <div className="truncate text-fg-muted text-small">{line}</div>}
      </div>
      {actions}
    </div>
  );
}

/** This Lo's version and build, with the button that asks GitHub for a newer one. */
function Version() {
  const version = useStore(updatesStore, (state) => state.version);
  const build = useStore(updatesStore, (state) => state.build);
  const checking = useStore(updatesStore, (state) => state.checking);
  const checkedAt = useStore(updatesStore, (state) => state.checkedAt);
  const failed = useStore(updatesStore, (state) => state.failed);
  const offer = useStore(updatesStore, (state) => state.state);
  const now = useNow();
  const below = failed ? (
    <Problem
      title="Couldn’t check for updates"
      reason={failed.reason}
      action={{ label: 'Try again', onClick: () => void check('settings') }}
    />
  ) : offer.status === 'idle' ? undefined : (
    <OnOffer state={offer} />
  );
  return (
    <Setting
      label={version === undefined ? 'Lo' : `Lo ${version}`}
      description={build}
      below={below}
    >
      {checkedAt !== undefined && !checking && (
        <span className="text-fg-muted text-small" role="status">
          Checked {ago(checkedAt, now)}
        </span>
      )}
      {/* Not the command's button: a check from here says what it found here, not in a note. */}
      <Button busy={checking} working="Checking…" onClick={() => void check('settings')}>
        Check now
      </Button>
    </Setting>
  );
}

export default [
  defineRow({
    id: 'updates.version',
    group: 'about',
    order: 10,
    label: 'Lo',
    description: '',
    words: () => [
      'version',
      'updates',
      'check for updates',
      updatesStore.getState().version ?? '',
      updatesStore.getState().build ?? '',
    ],
    render: Version,
  }),
  settingRow(checkSetting, { order: 20 }),
];

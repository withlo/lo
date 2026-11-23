// Settings' About rows for updates: this Lo's version and the build it is, with "Check now", when
// it last checked and why a check failed; the update on offer, downloading or ready, with what
// this copy can do about it; and whether Lo checks by itself, which is the `updates.check` setting.

import { Button, Problem, Setting, SettingsCommand } from '@lo/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { ago, defineRow, settingRow } from '../../settings/window/shared.ts';
import type { UpdateState } from '../contract.ts';
import { check as checkSetting } from '../settings.ts';
import { check, checkWay } from './actions.ts';
import { updatesStore } from './store.ts';
import {
  buildText,
  checkFailedTitle,
  downloadingText,
  failureReason,
  failureWay,
  type Build,
} from './words.ts';

/** The time now, again each minute, for a time said as how long ago it was. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const every = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(every);
  }, []);
  return now;
}

/** Whether some of `element` is inside the window, as it's drawn now. */
function onScreen(element: HTMLElement): boolean {
  const { top, bottom } = element.getBoundingClientRect();
  return top < window.innerHeight && bottom > 0;
}

/**
 * Says while `box`, the offer under the Lo row, is in view, so the toast that says the same steps
 * aside meanwhile. `drawn` is whether there's an offer to draw: one that comes while the row shows
 * is watched from then. It's said before the frame is drawn, so the toast doesn't come for a frame
 * and go. Where the window can't tell, as in a test without layout, it's in view.
 */
function useSaysOffer(box: { readonly current: HTMLElement | null }, drawn: boolean): void {
  useLayoutEffect(() => {
    const element = drawn ? box.current : null;
    if (!element) return undefined;
    const say = (shown: boolean) => {
      if (updatesStore.getState().offerInView !== shown)
        updatesStore.setState({ offerInView: shown });
    };
    if (typeof IntersectionObserver === 'undefined') {
      say(true);
      return () => say(false);
    }
    say(onScreen(element));
    const observer = new IntersectionObserver((entries) => {
      const last = entries.at(-1);
      if (last) say(last.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      say(false);
    };
  }, [box, drawn]);
}

/** The update on offer, downloading or ready, and what this copy of Lo can do about it. */
function OnOffer({ state }: { state: UpdateState }) {
  const box = useRef<HTMLDivElement>(null);
  useSaysOffer(box, state.status !== 'idle');
  if (state.status === 'idle') return null;
  const whatsNew = (
    <SettingsCommand command="updates.whatsNew" size="sm" variant="ghost">
      What’s new
    </SettingsCommand>
  );
  let title: string;
  let line: string | undefined;
  let actions = whatsNew;
  let failed: ReactNode;
  switch (state.status) {
    case 'available': {
      title = `Lo ${state.version} is available`;
      line = state.line === '' ? undefined : state.line;
      if (state.failed !== undefined) {
        line = undefined;
        failed = (
          <Problem
            title={`Couldn’t download Lo ${state.version}`}
            reason={failureReason(state.failed.why)}
            details={state.failed.details}
          />
        );
      }
      const again = state.failed !== undefined && failureWay(state.failed.why) === 'again';
      const ways = {
        install: ['updates.install', 'Update'],
        brew: ['updates.copy', 'Copy Homebrew command'],
        move: ['updates.move', 'Move Lo to Applications'],
        page: ['updates.download', 'Download update'],
      } as const;
      const [command, label] = ways[state.how];
      if (state.how === 'move') line = 'Updates need Lo in Applications.';
      const stopped = state.failed !== undefined && !again && state.how === 'install';
      actions = (
        <>
          {whatsNew}
          {!stopped && (
            <SettingsCommand command={command} size="sm" variant="primary">
              {again ? 'Try again' : label}
            </SettingsCommand>
          )}
        </>
      );
      break;
    }
    case 'downloading':
      title = downloadingText(state.version, state.received, state.total);
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
    <div
      ref={box}
      data-lo-offer=""
      className="flex flex-col gap-8 rounded-md border border-border-subtle p-8"
    >
      <div className="flex items-center gap-8">
        <div className="min-w-0 flex-1">
          <div className="lo-num text-ui-strong">{title}</div>
          {line !== undefined && <div className="truncate text-fg-muted text-small">{line}</div>}
        </div>
        {actions}
      </div>
      {failed}
    </div>
  );
}

/** What names a build beside its version: a commit's ID is code. */
function BuildLabel({ build }: { build: Build }) {
  return (
    <span className="ms-8 text-fg-muted text-small">
      {build.kind === 'source' ? (
        'Built from source'
      ) : (
        <>
          Commit <code className="code-small">{build.commit}</code>
        </>
      )}
    </span>
  );
}

/**
 * This Lo's version, with what names its build beside it, and its line, with the button that asks
 * GitHub for a newer one.
 */
function Version({ description }: { label: string; description: string }) {
  const version = useStore(updatesStore, (state) => state.version);
  const build = useStore(updatesStore, (state) => state.build);
  const checking = useStore(updatesStore, (state) => state.checking);
  const checkedAt = useStore(updatesStore, (state) => state.checkedAt);
  const failed = useStore(updatesStore, (state) => state.failed);
  const offer = useStore(updatesStore, (state) => state.state);
  const now = useNow();
  const below = failed ? (
    <Problem
      title={checkFailedTitle(failed.why)}
      reason={failureReason(failed.why)}
      details={failed.details}
      action={checkWay(failed.why, 'settings')}
    />
  ) : offer.status === 'idle' ? undefined : (
    <OnOffer state={offer} />
  );
  return (
    <Setting
      label={
        <>
          {version === undefined ? 'Lo' : `Lo ${version}`}
          {build !== undefined && <BuildLabel build={build} />}
        </>
      }
      description={description}
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
    description: 'The version in use, and any update available.',
    words: () => [
      'version',
      'updates',
      'check for updates',
      updatesStore.getState().version ?? '',
      ...[updatesStore.getState().build].flatMap((build) => (build ? [buildText(build)] : [])),
    ],
    render: Version,
  }),
  settingRow(checkSetting, { order: 20 }),
];

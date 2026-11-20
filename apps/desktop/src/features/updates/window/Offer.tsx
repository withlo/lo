// The toasts that say a newer Lo is out, downloading or ready, in the window's toast region, below
// a note that passes. A toast waits until it's acted on and never takes focus, wherever it is when
// it comes: its buttons are reached by Tab like any other, and each is also a command in the
// palette. No button installs or restarts but by its own press. When a toast goes while one of its
// buttons has focus, as it does on pressing Install or Later, focus goes back to the middle of the
// window, rather than to nowhere.

import { Button, Meter, Spinner, Toast } from '@lo/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { BREW_UPGRADE, type UpdateState } from '../contract.ts';
import { copyBrewCommand, install, later, move, openPage, restart } from './actions.ts';
import { updatesStore } from './store.ts';
import { progressText } from './words.ts';

type Offered = Extract<UpdateState, { status: 'available' }>;

/** "Lo 0.2.0 is out": an arrow up in a ring, as the design draws a release arriving. */
const OUT = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 11V5.5M5.5 8 8 5.5 10.5 8" />
  </svg>
);

/** "Lo 0.2.0 is ready". */
const TICK = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

/** A download that failed. */
const WARNING = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
    <path d="M8 6.25v3M8 11.25v.01" />
  </svg>
);

/** A spinner in the icon's place, centered on the icon's 16 px. */
const WAITING = (
  <span className="ms-2 mt-2 inline-flex">
    <Spinner />
  </span>
);

/**
 * Holds one toast, and takes focus back to the middle of the window when the toast goes while
 * something in it has focus. Each state of the offer is its own toast, so its buttons go with it.
 */
function Held({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // A layout effect, whose cleanup runs before the toast leaves the page, with focus still in it.
  useLayoutEffect(
    () => () => {
      if (box.current?.contains(document.activeElement)) focusMiddle();
    },
    [],
  );
  return <div ref={box}>{children}</div>;
}

/** How long "Copied" stays on the button, in ms. */
export const COPIED_TIME = 2000;

/** The command that updates Lo through Homebrew, with the button that copies it. */
function BrewCommand() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_TIME);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-8 flex items-center gap-8 rounded-sm bg-bg-well py-6 ps-8 pe-6 text-fg inset-ring inset-ring-border">
      <code className="min-w-0 flex-1 break-all select-text code-small">{BREW_UPGRADE}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void copyBrewCommand().then(setCopied);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** A newer Lo, on offer, as this copy takes it: the buttons are what it can do about it. */
function Available({ offer }: { offer: Offered }) {
  const title = `Lo ${offer.version} is out`;
  const whatsNew = (
    <Button size="sm" onClick={() => void openPage(offer.page)}>
      What’s new
    </Button>
  );
  const hide = (
    <Button variant="ghost" size="sm" onClick={() => void later()}>
      Later
    </Button>
  );
  switch (offer.how) {
    case 'install':
      if (offer.failed !== undefined) {
        return (
          <Toast
            tone="warning"
            icon={WARNING}
            title={`Lo couldn’t download ${offer.version}`}
            body={offer.failed}
            actions={
              <>
                <Button variant="primary" size="sm" onClick={() => void install()}>
                  Try again
                </Button>
                {whatsNew}
                {hide}
              </>
            }
          />
        );
      }
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body={offer.line === '' ? undefined : offer.line}
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => void install()}>
                Install
              </Button>
              {whatsNew}
              {hide}
            </>
          }
        />
      );
    case 'brew':
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body={
            <>
              You installed Lo with Homebrew, so update it there:
              <BrewCommand />
            </>
          }
          actions={
            <>
              {whatsNew}
              {hide}
            </>
          }
        />
      );
    case 'move':
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body="Lo can’t update itself from where it is. Move it to Applications, and it updates from there."
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => void move()}>
                Move to Applications
              </Button>
              {hide}
            </>
          }
        />
      );
    case 'page':
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body={offer.line === '' ? undefined : offer.line}
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => void openPage(offer.page)}>
                Download
              </Button>
              {hide}
            </>
          }
        />
      );
    default:
      throw new Error(
        `A way to update Lo doesn't know: ${JSON.stringify(offer.how satisfies never)}`,
      );
  }
}

/**
 * The toast for where updates stand: a newer Lo on offer, downloading, or ready; nothing while
 * there's nothing to say.
 */
export function UpdateToast({ state }: { state: UpdateState }) {
  switch (state.status) {
    case 'idle':
      return null;
    case 'available':
      return (
        <Held key={`${state.how}-${state.failed === undefined ? 'offer' : 'failed'}`}>
          <Available offer={state} />
        </Held>
      );
    case 'downloading': {
      const known = state.total > 0;
      return (
        <Held key="downloading">
          <Toast
            tone="info"
            icon={WAITING}
            title={`Downloading Lo ${state.version}`}
            body={
              // How far it has come changes as bytes do, and isn't said again each time.
              <div className="flex items-center gap-8" aria-live="off">
                <span className="tabular-nums">{progressText(state.received, state.total)}</span>
                {known && (
                  <div className="min-w-0 flex-1">
                    <Meter
                      value={state.received}
                      max={state.total}
                      label={`Download of Lo ${state.version}`}
                    />
                  </div>
                )}
              </div>
            }
          />
        </Held>
      );
    }
    case 'ready':
      return (
        <Held key="ready">
          <Toast
            tone="success"
            icon={TICK}
            title={`Lo ${state.version} is ready`}
            body="It installs when you quit, or now."
            actions={
              <Button variant="primary" size="sm" onClick={() => void restart()}>
                Restart now
              </Button>
            }
          />
        </Held>
      );
    default:
      throw new Error(`An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** The view in the toast region: the toast for where updates stand now. */
export function Offer() {
  const state = useStore(updatesStore, (window) => window.state);
  return <UpdateToast state={state} />;
}

// The toasts that say a newer Lo is out, downloading or ready, in the window's toast region, below
// a note that passes. A toast waits until it's acted on and never takes focus by itself, wherever
// it is when it comes. Its buttons are reached with the keyboard from "Go to the update", which
// focuses the first, and `Tab` and `⇧Tab` move between them from there, round from the last to the
// first and back, as in a toolbar, and `Esc` goes back to the middle of the window; each button is
// also a command in the palette. No button installs or restarts but by its own press. A press in
// the moment after a toast comes or changes is ignored, since the reader's click may have been meant
// for what was there before, and so is a key press in the moment after focus comes into the toast,
// since the key that took it there may still be down: a key held down repeats, and a repeat never
// presses a button. When a toast goes while one of its buttons has focus, as it does on pressing
// Install or Later, focus goes back to the middle of the window, rather than to nowhere.

import { Button, Meter, Spinner, Toast } from '@lo/ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as KeyEvent,
  type ReactNode,
} from 'react';
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

/** A spinner in the icon's place, centered on the icon's 16 px. */
const WAITING = (
  <span className="ms-2 mt-2 inline-flex">
    <Spinner />
  </span>
);

/** How long a toast's buttons ignore a press after it comes or changes, in ms. */
export const GUARD_TIME = 500;

/** What a toast's `Tab` moves between: its buttons. */
const REACHED = 'button:not(:disabled), a[href]';

/**
 * Holds one toast, which is its own scope of keys where `Tab` moves between its buttons, and wraps
 * from the last to the first and back. A press on a button is ignored for {@link GUARD_TIME} ms:
 * - after the toast comes, whether by pointer or key: each state draws in the same place, so a
 *   click meant for the one before lands on the next;
 * - after focus comes into the toast, when it's a key that presses: the key that took focus there,
 *   by "Go to the update" or a `Tab`, may still be down.
 * A key held down repeats, and a repeat of `⏎` or `␣` on a button never presses it. Takes focus
 * back to the middle of the window when the toast goes while something in it has focus. Each state
 * of the offer is its own toast, so its buttons go with it.
 */
function Held({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const came = useRef(0);
  const entered = useRef(0);
  useLayoutEffect(() => {
    came.current = Date.now();
    // A layout effect, whose cleanup runs before the toast leaves the page, with focus still in it.
    return () => {
      if (box.current?.contains(document.activeElement)) focusMiddle();
    };
  }, []);
  return (
    <div
      ref={box}
      data-lo-scope="toasts"
      data-lo-tab="browser"
      onFocusCapture={(event) => {
        const from = event.relatedTarget;
        if (!(from instanceof Node) || !box.current?.contains(from)) entered.current = Date.now();
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Tab') {
          wrap(event, box.current);
        } else if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          if (event.target instanceof Element && event.target.closest('button')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }}
      onClickCapture={(event) => {
        const now = Date.now();
        // A click a key made has no click count, as one from a pointer has.
        const keyed = event.detail === 0;
        if (now - came.current >= GUARD_TIME && !(keyed && now - entered.current < GUARD_TIME)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Keeps `Tab` in the toast: from its last button it goes to the first, and `⇧Tab` from the first
 * goes to the last, as in a toolbar, rather than out to the tab strip. `Esc` leaves.
 */
function wrap(event: KeyEvent, box: HTMLElement | null): void {
  if (!box || event.altKey || event.ctrlKey || event.metaKey) return;
  const buttons = [...box.querySelectorAll<HTMLElement>(REACHED)];
  const [first] = buttons;
  const last = buttons.at(-1);
  const at = event.target;
  if (first === undefined || last === undefined || !(at instanceof HTMLElement)) return;
  const edge = event.shiftKey ? first : last;
  if (!edge.contains(at)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
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
        <Held key={`offer-${state.version}-${state.how}`}>
          <Available offer={state} />
        </Held>
      );
    case 'downloading': {
      const known = state.total > 0;
      return (
        <Held key={`downloading-${state.version}`}>
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
        <Held key={`ready-${state.version}`}>
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

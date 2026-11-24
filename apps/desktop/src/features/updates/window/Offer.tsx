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
// Update or Hide, focus goes back to the middle of the window, rather than to nowhere. While
// Settings › About shows the offer in view under its Lo row, the toast steps aside, so the offer and
// its failure are said once.

import { Button, CopyButton, Meter, Problem, Spinner, Toast, useCopy } from '@lo/ui';
import { useLayoutEffect, useRef, type KeyboardEvent as KeyEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { BREW_UPGRADE, type UpdateState } from '../contract.ts';
import { install, later, move, openPage, restart } from './actions.ts';
import { updatesStore } from './store.ts';
import { downloadingText, failureReason, failureWay } from './words.ts';

type Offered = Extract<UpdateState, { status: 'available' }>;

/** "Lo 0.2.0 is available": an arrow up in a ring, as the design draws an update arriving. */
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

/**
 * The command that updates Lo through Homebrew, with the button that copies it, which answers on
 * itself: "Copied", or "Couldn’t copy".
 */
function BrewCommand() {
  const copy = useCopy();
  return (
    <div className="mt-8 flex items-center gap-8 rounded-sm bg-bg-well py-6 ps-8 pe-6 text-fg inset-ring inset-ring-border">
      <code className="min-w-0 flex-1 break-all code-small select-text">{BREW_UPGRADE}</code>
      <CopyButton size="sm" onCopy={() => copy(BREW_UPGRADE)} />
    </div>
  );
}

/**
 * Why the last download of the update on offer failed, said on the offer, whose button then tries
 * again where that can help.
 */
function DownloadFailed({ offer }: { offer: Offered }) {
  if (offer.failed === undefined) return null;
  return (
    <div className="mt-8">
      <Problem
        title={`Couldn’t download Lo ${offer.version}`}
        reason={failureReason(offer.failed.why)}
        details={offer.failed.details}
      />
    </div>
  );
}

/** A newer Lo, on offer, as this copy takes it: the buttons are what it can do about it. */
function Available({ offer }: { offer: Offered }) {
  const title = `Lo ${offer.version} is available`;
  const line = offer.line === '' ? undefined : offer.line;
  const whatsNew = (
    <Button size="sm" onClick={() => void openPage(offer.page)}>
      What’s new
    </Button>
  );
  const hide = (
    <Button variant="ghost" size="sm" onClick={() => void later()}>
      Hide
    </Button>
  );
  switch (offer.how) {
    case 'install': {
      const failed = offer.failed;
      const again = failed !== undefined && failureWay(failed.why) === 'again';
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body={failed === undefined ? line : <DownloadFailed offer={offer} />}
          actions={
            <>
              {(failed === undefined || again) && (
                <Button variant="primary" size="sm" onClick={() => void install()}>
                  {again ? 'Try again' : 'Update'}
                </Button>
              )}
              {whatsNew}
              {hide}
            </>
          }
        />
      );
    }
    case 'brew':
      return (
        <Toast
          tone="info"
          icon={OUT}
          title={title}
          body={
            <>
              This copy of Lo updates with Homebrew.
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
          body="Updates need Lo in Applications."
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => void move()}>
                Move Lo to Applications
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
          body={line}
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => void openPage(offer.page)}>
                Download update
              </Button>
              {hide}
            </>
          }
        />
      );
    default:
      throw new Error(
        `A way to update Lo doesn’t know: ${JSON.stringify(offer.how satisfies never)}`,
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
            title={
              // How far it has come changes as bytes do, and isn't said again each time.
              <span className="tabular-nums" aria-live="off">
                {downloadingText(state.version, state.received, state.total)}
              </span>
            }
            body={
              known ? (
                <Meter
                  value={state.received}
                  max={state.total}
                  label={`Downloading Lo ${state.version}`}
                />
              ) : undefined
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
            actions={
              <Button variant="primary" size="sm" onClick={() => void restart()}>
                Restart to update
              </Button>
            }
          />
        </Held>
      );
    default:
      throw new Error(`An update state Lo doesn’t know: ${JSON.stringify(state satisfies never)}`);
  }
}

/**
 * The view in the toast region: the toast for where updates stand now, except while Settings ›
 * About shows the same under its Lo row, in view.
 */
export function Offer() {
  const state = useStore(updatesStore, (window) => window.state);
  const aside = useStore(updatesStore, (window) => window.offerInView);
  return aside ? null : <UpdateToast state={state} />;
}

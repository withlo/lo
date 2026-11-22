import { cva } from 'class-variance-authority';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { formatBytes } from './bytes.ts';
import { showFormat } from './controls.ts';
import { Popover, PopoverDescription, PopoverTitle } from './Popover.tsx';
import { ShownText } from './ShownText.tsx';
import { Spinner } from './Spinner.tsx';

/** Why a language server isn't running. */
export type ServerFailure =
  /** Lo stopped it past its memory limit: "4 GB", and how many files it was loading. */
  | { kind: 'memory'; limit: string; files?: number | undefined }
  /** It couldn't be downloaded, after trying again; `message` says what GitHub or the network said. */
  | { kind: 'download'; message: string }
  /** It exited, or answered badly; `message` says how, in a sentence. */
  | { kind: 'error'; message: string };

/** Where a language server is: what its item in the status bar shows. */
export type ServerState =
  /** Its files are on their way, in bytes. */
  | { kind: 'downloading'; done: number; total: number }
  /** Its files have come, and are being unpacked. */
  | { kind: 'unpacking' }
  /** Its source has come, and Lo is building it, as it does Go's server. */
  | { kind: 'building' }
  /**
   * It waits in line for room, since Lo runs `count` at once at most, and they're all in use on
   * screen: `next` when it's first in line.
   */
  | { kind: 'waiting'; count: number; next: boolean }
  | { kind: 'starting' }
  /** It's reading the project; `percent` is how far, from 0 to 100, when it says. */
  | { kind: 'indexing'; percent?: number | undefined }
  | { kind: 'ready' }
  /** It runs, but missed several answers in a short while. It may come back by itself. */
  | { kind: 'notAnswering' }
  | { kind: 'failed'; why: ServerFailure }
  /**
   * The toolchain it needs isn't installed: `needs` names it ("Go 1.24 or later", "a JDK"), and
   * `install` is a command that installs it, when there is one. `plural` when `needs` names them,
   * as "Apple’s Command Line Tools" does.
   */
  | {
      kind: 'missing';
      needs: string;
      install?: string | undefined;
      plural?: boolean | undefined;
    }
  /**
   * Lo won't run it on this checkout, as files there would steer its tools: `why` says so, and
   * why, in a sentence or two. A new head is looked at again by itself.
   */
  | { kind: 'refused'; why: string }
  /**
   * Lo doesn't run language servers here, since the repo isn't trusted. The item says so for all of
   * them, whatever its `name` is.
   */
  | { kind: 'off' };

/** What the details offer to do about trust. */
export interface ServerTrust {
  /**
   * "Trust this repo…" and "Trust this PR…" ask in a dialog of main's, so they end in an ellipsis,
   * and the details stay open while Lo asks; "Stop trusting this repo" takes it away at once, and
   * closes them.
   */
  action: 'repo' | 'pr' | 'stop';
  onChoose: () => void;
  /**
   * What Lo is doing about it, while it does: "Checking with GitHub", "Trusting". The button says
   * so, with a ring turning, in place of its label, and pressing it does nothing until it's done.
   */
  busy?: string | undefined;
  /** Why trusting didn't happen, which the details say under what they said, until it's asked again. */
  failure?: ServerTrustFailure | undefined;
}

/** Why trusting didn't happen, in a sentence or two, and what to do about it, if anything. */
export interface ServerTrustFailure {
  message: string;
  /** A button that helps: "Open the settings file". */
  fix?: { label: string; onChoose: () => void } | undefined;
}

export interface ServerStatusProps {
  /** The language: "TypeScript". */
  name: string;
  state: ServerState;
  /** The program and its version, for the details: "tsserver 5.6.3". */
  version?: string | undefined;
  /**
   * The button that starts it again. A failed download offers "Retry" in its place, and one waiting
   * in line "Start next", unless it's next already. One refused offers none.
   */
  onRestart?: (() => void) | undefined;
  onShowLog?: (() => void) | undefined;
  /** The details' way to trust the repo, or to stop. */
  trust?: ServerTrust | undefined;
  /** Whether the details are open. Without it, the item keeps its own. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Where the details are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

/** What the details say fills in for a server that isn't answering: the syntax index does. */
const FALLBACK = "Peek, references and hovers fall back to the syntax index until it's back.";
const WAITING = "Peek, references and hovers use the syntax index until it's ready.";
const UNTIL = 'Until then, peek, references and hovers use the syntax index.';
const INSTEAD = 'Peek, references and hovers use the syntax index instead.';

/** The percent of a progress report, clamped to the scale it's on. */
function percentOf(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** The word or words beside the language's name in the status bar. */
function Words({ name: raw, state }: { name: string; state: ServerState }): ReactNode {
  const name = <ShownText text={raw} />;
  switch (state.kind) {
    case 'downloading':
      return (
        <>
          {name} downloading ·{' '}
          <span className="lo-num">
            {formatBytes(state.done)} of {formatBytes(state.total)}
          </span>
        </>
      );
    case 'unpacking':
      return <>{name} unpacking</>;
    case 'building':
      return <>{name} building</>;
    case 'waiting':
      return state.next ? <>{name} waiting · next</> : <>{name} waiting</>;
    case 'starting':
      return <>{name} starting</>;
    case 'indexing':
      return (
        <>
          {name} indexing
          {state.percent !== undefined && (
            <>
              {' '}
              <span className="lo-num">{percentOf(state.percent)}%</span>
            </>
          )}
        </>
      );
    case 'ready':
      return name;
    case 'notAnswering':
      return <>{name} not answering</>;
    case 'failed':
      return <>{name} failed</>;
    case 'missing':
      return <>{name} toolchain missing</>;
    case 'refused':
      return <>{name} refused</>;
    case 'off':
      return 'Language servers off';
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

const DOT = {
  ok: 'bg-success',
  warn: 'bg-warning',
  fail: 'bg-danger',
  idle: 'bg-fg-dim',
} as const;

/** A language server's state as a mark: a ring turning while it's coming up, else a dot. */
function Mark({ state }: { state: ServerState }) {
  switch (state.kind) {
    case 'downloading':
    case 'unpacking':
    case 'building':
    case 'starting':
    case 'indexing':
      return <Spinner size="xs" />;
    case 'ready':
      return <span className={`size-8 flex-none rounded-full ${DOT.ok}`} aria-hidden="true" />;
    case 'failed':
      return <span className={`size-8 flex-none rounded-full ${DOT.fail}`} aria-hidden="true" />;
    case 'waiting':
    case 'notAnswering':
    case 'missing':
      return <span className={`size-8 flex-none rounded-full ${DOT.warn}`} aria-hidden="true" />;
    case 'refused':
    case 'off':
      return <span className={`size-8 flex-none rounded-full ${DOT.idle}`} aria-hidden="true" />;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** The status bar's items, as `StatusItem` sets them. A failed server's is tinted. */
const item = cva(
  'inline-flex h-20 min-w-0 items-center gap-6 rounded-xs px-6 hover:bg-hover hover:text-fg focus-visible:shadow-ring',
  {
    variants: {
      failed: { true: 'bg-danger-bg text-danger', false: '' },
    },
  },
);

/** What the details' heading says of the server: "TypeScript ready", "TypeScript stopped". */
function heading(raw: string, state: ServerState): ReactNode {
  const name = <ShownText text={raw} />;
  switch (state.kind) {
    case 'downloading':
      return <>{name} downloading</>;
    case 'unpacking':
      return <>{name} unpacking</>;
    case 'building':
      return <>{name} building</>;
    case 'waiting':
      return <>{name} waiting</>;
    case 'starting':
      return <>{name} starting</>;
    case 'indexing':
      return <>{name} indexing</>;
    case 'ready':
      return <>{name} ready</>;
    case 'notAnswering':
      return <>{name} not answering</>;
    case 'failed':
      return <>{name} stopped</>;
    case 'missing':
      return <>{name} toolchain missing</>;
    case 'refused':
      return <>{name} refused</>;
    case 'off':
      return 'Language servers off';
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** What went wrong, in a sentence, for a failure. */
function why(failure: ServerFailure): ReactNode {
  switch (failure.kind) {
    case 'memory':
      return (
        <>
          It ran out of memory at <ShownText text={failure.limit} />
          {failure.files !== undefined &&
            ` while loading ${failure.files.toLocaleString('en-US')} files`}
          .
        </>
      );
    case 'download':
    case 'error':
      return <ShownText text={failure.message} />;
    default:
      failure satisfies never;
      throw new Error(`A failure Lo doesn't know: ${JSON.stringify(failure)}.`);
  }
}

/** What the details say under the heading. */
function detail(raw: string, state: ServerState): ReactNode {
  const name = <ShownText text={raw} />;
  switch (state.kind) {
    case 'downloading':
    case 'unpacking':
    case 'building':
    case 'starting':
    case 'indexing':
      return WAITING;
    case 'refused':
      return (
        <>
          <ShownText text={state.why} /> {INSTEAD}
        </>
      );
    case 'waiting':
      return (
        <>
          {`Lo runs ${state.count} language servers at once at most, and they're all in use on screen.`}{' '}
          {name}{' '}
          {state.next
            ? 'is next in line, and starts when one of them stops.'
            : 'is in line, and starts when its turn comes.'}{' '}
          {UNTIL}
        </>
      );
    case 'ready':
      return undefined;
    case 'notAnswering':
      return `It missed several answers in a row. ${FALLBACK}`;
    case 'failed':
      return (
        <>
          {why(state.why)} {FALLBACK}
        </>
      );
    case 'missing':
      return (
        <>
          {name} needs <ShownText text={state.needs} />.
          {state.install !== undefined && (
            <>
              {' '}
              Install {state.plural === true ? 'them' : 'it'} with{' '}
              <code className="text-fg code-small">
                <ShownText text={state.install} />
              </code>
              .
            </>
          )}{' '}
          {UNTIL}
        </>
      );
    case 'off':
      return `Lo runs language servers only on repos you trust. ${UNTIL}`;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** What the button that takes the reader to trust, or to stop, says. */
function trustLabel(action: ServerTrust['action']): string {
  switch (action) {
    case 'repo':
      return 'Trust this repo…';
    case 'pr':
      return 'Trust this PR…';
    case 'stop':
      return 'Stop trusting this repo';
    default:
      action satisfies never;
      throw new Error(`A way to change trust Lo doesn't know: ${JSON.stringify(action)}.`);
  }
}

/**
 * What the button that starts a server again says: for one waiting in line, which it puts first,
 * "Start next".
 */
function restartLabel(state: ServerState): string {
  if (state.kind === 'waiting') return 'Start next';
  return state.kind === 'failed' && state.why.kind === 'download' ? 'Retry' : 'Restart';
}

/**
 * Where focus goes when an item leaves the page with it: the bar's next item, else its previous
 * one, else the bar itself. `own` is the item's own buttons, and `details` its open details, which
 * leave with it. Nothing happens unless focus is on one of them, or inside the details.
 */
function handOffFocus(own: readonly (HTMLElement | null)[], details: HTMLElement | null): void {
  const mine = own.filter((each) => each !== null);
  const leaving = mine.find((each) => each.isConnected);
  const bar = leaving?.parentElement;
  if (!leaving || !bar) return;
  const active = leaving.ownerDocument.activeElement;
  if (!active || !(mine.some((each) => each === active) || details?.contains(active))) return;
  const stops = [...bar.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')].filter(
    (stop) => !mine.includes(stop) && !details?.contains(stop),
  );
  const next =
    stops.find(
      (stop) => leaving.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ??
    stops.findLast(
      (stop) => leaving.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_PRECEDING,
    );
  if (next) {
    next.focus({ preventScroll: true });
    return;
  }
  // The bar is no stop for `Tab`: it takes focus only for as long as it needs to hold it.
  if (!bar.hasAttribute('tabindex')) {
    bar.tabIndex = -1;
    bar.addEventListener('blur', () => bar.removeAttribute('tabindex'), { once: true });
  }
  bar.focus({ preventScroll: true });
}

/**
 * One language server in the status bar: a mark and its name, with how far it has got while it's
 * coming up. A click, or `⏎` on it, opens its details over it, with what to do: start it again, or
 * read its log. A failed server shows "Restart" beside its name, since that's the one thing to do.
 * The item is quiet while all is well.
 */
export function ServerStatus({
  name,
  state,
  version,
  onRestart,
  onShowLog,
  trust,
  open,
  onOpenChange,
  container,
}: ServerStatusProps) {
  // One first in line for room already starts as soon as it can, and one refused would only be
  // refused again on this head: there's nothing to offer either.
  const again =
    (state.kind === 'waiting' && state.next) || state.kind === 'refused' ? undefined : onRestart;
  const [kept, setKept] = useState(false);
  const shown = open ?? kept;
  const restart = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const beside = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement | null>(null);
  // Whatever takes the item away while it has focus, such as a caller that draws another item for
  // the new state, would drop focus on the page: it goes to the bar instead.
  useLayoutEffect(() => () => handOffFocus([trigger.current, beside.current], details.current), []);
  const failed = state.kind === 'failed';
  const says = detail(name, state);
  const change = (next: boolean) => {
    setKept(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <Popover
        open={shown}
        onOpenChange={change}
        trigger={
          <button type="button" ref={trigger} className={item({ failed })}>
            <Mark state={state} />
            <span className="min-w-0 truncate">
              <Words name={name} state={state} />
            </span>
          </button>
        }
        side="top"
        scope="dialog"
        // The details take focus as they open, not a frame on, so a key pressed then is theirs. It
        // goes to Restart, or to the first of the other buttons when the server has none to offer.
        initialFocus={again ? restart : first}
        popupRef={details}
        container={container}
        className="flex server-details flex-col gap-8 px-12 py-12"
      >
        <div className="flex items-center gap-8">
          <Mark state={state} />
          <PopoverTitle className="m-0 min-w-0 truncate text-ui-strong">
            {heading(name, state)}
          </PopoverTitle>
          {version !== undefined && (
            <span className="lo-num ms-auto flex-none text-fg-muted text-small">
              <ShownText text={version} />
            </span>
          )}
        </div>
        {says !== undefined && (
          <PopoverDescription className="m-0 text-fg-muted text-small">{says}</PopoverDescription>
        )}
        {trust?.failure && (
          <p role="alert" className="m-0 text-danger text-small">
            <ShownText text={trust.failure.message} />
          </p>
        )}
        {(again || onShowLog || trust) && (
          <div className="flex flex-wrap gap-6">
            {again && (
              <Button
                ref={restart}
                variant={failed ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => {
                  change(false);
                  again();
                }}
              >
                {restartLabel(state)}
              </Button>
            )}
            {onShowLog && (
              <Button
                ref={again ? undefined : first}
                variant="ghost"
                size="sm"
                onClick={() => {
                  change(false);
                  onShowLog();
                }}
              >
                Show the log
              </Button>
            )}
            {trust && (
              <Button
                ref={again || onShowLog ? undefined : first}
                variant={state.kind === 'off' ? 'secondary' : 'ghost'}
                size="sm"
                // Not `disabled`, which would drop focus from it.
                aria-disabled={trust.busy === undefined ? undefined : true}
                onClick={() => {
                  if (trust.busy !== undefined) return;
                  // Trusting asks first, and says here how that goes.
                  if (trust.action === 'stop') change(false);
                  trust.onChoose();
                }}
              >
                {trust.busy === undefined ? (
                  trustLabel(trust.action)
                ) : (
                  <span className="inline-flex items-center gap-6">
                    <Spinner size="xs" />
                    <ShownText text={trust.busy} />
                  </span>
                )}
              </Button>
            )}
            {trust?.failure?.fix && (
              <Button variant="ghost" size="sm" onClick={trust.failure.fix.onChoose}>
                {trust.failure.fix.label}
              </Button>
            )}
          </div>
        )}
      </Popover>
      {failed && again && (
        <button
          ref={beside}
          type="button"
          // Named for its server: a bar can hold several, each with a button like it.
          aria-label={`${restartLabel(state)} ${showFormat(name)}`}
          className="inline-flex h-20 flex-none items-center rounded-xs px-6 text-fg hover:bg-hover focus-visible:shadow-ring"
          onClick={() => {
            // The button goes once the server is starting, and takes focus with it: the item stays.
            trigger.current?.focus({ preventScroll: true });
            again();
          }}
        >
          {restartLabel(state)}
        </button>
      )}
    </>
  );
}

import { Popover } from '@base-ui/react/popover';
import { cva } from 'class-variance-authority';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { showFormat } from './controls.ts';
import { useTakeFocus } from './focus.ts';
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
  | { kind: 'starting' }
  /** It's reading the project; `percent` is how far, from 0 to 100, when it says. */
  | { kind: 'indexing'; percent?: number | undefined }
  | { kind: 'ready' }
  /** It runs, but missed several answers in a short while. It may come back by itself. */
  | { kind: 'notAnswering' }
  | { kind: 'failed'; why: ServerFailure }
  /**
   * The toolchain it needs isn't installed: `needs` names it ("Go 1.24 or later", "a JDK"), and
   * `install` is a command that installs it, when there is one.
   */
  | { kind: 'missing'; needs: string; install?: string | undefined }
  /**
   * Its server, `server` ("Intelephense"), has a license of its own, `license` ("the Intelephense
   * Licence"), which the reader hasn't accepted: nothing of it is downloaded until they do.
   */
  | { kind: 'license'; server: string; license: string }
  /**
   * Lo doesn't run language servers here, since the repo isn't trusted. The item says so for all of
   * them, whatever its `name` is.
   */
  | { kind: 'off' };

/**
 * What a server said to the reader, as it said it: a message, of its type; a question, with its
 * actions; or a link, a web page it named, whose text is its address.
 */
export interface ServerNotice {
  id: number;
  kind: 'message' | 'question' | 'link';
  type: 'error' | 'warning' | 'info' | 'log' | 'debug';
  text: string;
  actions?: readonly string[] | undefined;
}

/** What the reader does with a notice: dismisses it, opens a link's page, or answers a question. */
export type NoticeAct = 'dismiss' | 'open' | { action: number };

/** What the details offer for a server whose license the reader hasn't accepted. */
export interface ServerLicense {
  /** "Read the license": its page, in the browser. */
  onRead: () => void;
  /** "Accept the license": the server downloads and starts. */
  onAccept: () => void;
}

/** What the details offer to do about trust. */
export interface ServerTrust {
  /**
   * "Trust this repo…" and "Trust this PR…" ask in a dialog of main's, so they end in an ellipsis;
   * "Stop trusting this repo" takes it away at once.
   */
  action: 'repo' | 'pr' | 'stop';
  onChoose: () => void;
}

export interface ServerStatusProps {
  /** The language: "TypeScript". */
  name: string;
  state: ServerState;
  /** The program and its version, for the details: "tsserver 5.6.3". */
  version?: string | undefined;
  /** The button that starts it again. A failed download offers "Retry" in its place. */
  onRestart?: (() => void) | undefined;
  onShowLog?: (() => void) | undefined;
  /** The details' way to trust the repo, or to stop. */
  trust?: ServerTrust | undefined;
  /** The details' way to read and accept its server's license, while it's `license`. */
  license?: ServerLicense | undefined;
  /** What its server said to the reader, oldest first, each kept until they dismiss it. */
  notices?: readonly ServerNotice[] | undefined;
  onNotice?: ((id: number, act: NoticeAct) => void) | undefined;
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

/** Bytes as whole megabytes, as a download's progress counts them. */
function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/** The percent of a progress report, clamped to the scale it's on. */
function percentOf(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** How many notices there are, as the item counts them. */
function noticeCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'message' : 'messages'}`;
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
            {megabytes(state.done)} of {megabytes(state.total)} MB
          </span>
        </>
      );
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
    case 'license':
      return <>{name} off · license</>;
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
    case 'starting':
    case 'indexing':
      return <Spinner size="xs" />;
    case 'ready':
      return <span className={`size-8 flex-none rounded-full ${DOT.ok}`} aria-hidden="true" />;
    case 'failed':
      return <span className={`size-8 flex-none rounded-full ${DOT.fail}`} aria-hidden="true" />;
    case 'notAnswering':
    case 'missing':
      return <span className={`size-8 flex-none rounded-full ${DOT.warn}`} aria-hidden="true" />;
    case 'license':
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
    case 'license':
      return <>{name} off</>;
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
    case 'starting':
    case 'indexing':
      return WAITING;
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
              Install it with{' '}
              <code className="text-fg code-small">
                <ShownText text={state.install} />
              </code>
              .
            </>
          )}{' '}
          {UNTIL}
        </>
      );
    case 'license':
      return (
        <>
          {name}'s server, <ShownText text={state.server} />, has its own license. Read it and
          accept it to use it. {UNTIL}
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

/** What a notice is, in a word or two, above its text. */
function noticeLabel(notice: ServerNotice): string {
  if (notice.kind === 'question') return 'Question';
  if (notice.kind === 'link') return 'A page it links to';
  switch (notice.type) {
    case 'error':
      return 'Error';
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Message';
    case 'log':
      return 'Log';
    case 'debug':
      return 'Debugging';
    default:
      notice.type satisfies never;
      return 'Message';
  }
}

/**
 * What a server said, each as it said it, its text whole and its lines kept, with what to do: a
 * question's actions, a link's "Open the page", and "Dismiss".
 */
function Notices({
  name,
  notices,
  onNotice,
}: {
  name: string;
  notices: readonly ServerNotice[];
  onNotice: ((id: number, act: NoticeAct) => void) | undefined;
}) {
  return (
    <section aria-label={`What ${showFormat(name)}'s server says`} className="flex flex-col gap-6">
      <h3 className="m-0 text-fg-muted text-small">
        <ShownText text={name} />
        's server says
      </h3>
      <ul className="m-0 flex server-notices list-none flex-col gap-8 p-0">
        {notices.map((notice) => (
          <li
            key={notice.id}
            className="flex flex-col gap-6 rounded-sm bg-bg-raised px-8 py-8"
            data-notice={notice.kind}
          >
            <span className="text-fg-muted text-micro">{noticeLabel(notice)}</span>
            <p
              className={`m-0 wrap-anywhere whitespace-pre-wrap text-fg ${notice.kind === 'link' ? 'code-small' : 'text-small'}`}
            >
              <ShownText text={notice.text} />
            </p>
            <div className="flex flex-wrap gap-6">
              {notice.kind === 'question' &&
                notice.actions?.map((title, action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    size="sm"
                    onClick={() => onNotice?.(notice.id, { action })}
                  >
                    <ShownText text={title} />
                  </Button>
                ))}
              {notice.kind === 'link' && (
                <Button variant="secondary" size="sm" onClick={() => onNotice?.(notice.id, 'open')}>
                  Open the page
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onNotice?.(notice.id, 'dismiss')}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the button that starts a server again says. */
function restartLabel(state: ServerState): string {
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
  license,
  notices = [],
  onNotice,
  open,
  onOpenChange,
  container,
}: ServerStatusProps) {
  const [kept, setKept] = useState(false);
  const shown = open ?? kept;
  const restart = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const beside = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLElement | null>(null);
  // The details take focus as they open, not a frame on, so a key pressed then is theirs. It goes
  // to Restart, or to the first of the other buttons when the server has none to offer.
  const takeFocus = useTakeFocus(onRestart ? restart : first);
  const popup = useCallback(
    (element: HTMLElement | null) => {
      details.current = element;
      takeFocus(element);
    },
    [takeFocus],
  );
  // Whatever takes the item away while it has focus, such as a caller that draws another item for
  // the new state, would drop focus on the page: it goes to the bar instead.
  useLayoutEffect(() => () => handOffFocus([trigger.current, beside.current], details.current), []);
  const failed = state.kind === 'failed';
  const says = detail(name, state);
  const licensing = state.kind === 'license' ? license : undefined;
  const change = (next: boolean) => {
    setKept(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <Popover.Root open={shown} onOpenChange={change}>
        <Popover.Trigger ref={trigger} className={item({ failed })}>
          <Mark state={state} />
          <span className="min-w-0 truncate">
            <Words name={name} state={state} />
            {notices.length > 0 && <span className="lo-num"> · {noticeCount(notices.length)}</span>}
          </span>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Positioner
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-popover outline-none"
          >
            <Popover.Popup
              ref={popup}
              initialFocus={false}
              data-lo-scope="dialog"
              className="flex server-details flex-col gap-8 rounded-md bg-bg-overlay px-12 py-12 text-fg shadow-pop outline-none text-ui"
            >
              <div className="flex items-center gap-8">
                <Mark state={state} />
                <Popover.Title className="m-0 min-w-0 truncate text-ui-strong">
                  {heading(name, state)}
                </Popover.Title>
                {version !== undefined && (
                  <span className="lo-num ms-auto flex-none text-fg-muted text-small">
                    <ShownText text={version} />
                  </span>
                )}
              </div>
              {says !== undefined && (
                <Popover.Description className="m-0 text-fg-muted text-small">
                  {says}
                </Popover.Description>
              )}
              {notices.length > 0 && <Notices name={name} notices={notices} onNotice={onNotice} />}
              {licensing && (
                <div className="flex flex-wrap gap-6">
                  <Button
                    ref={first}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      change(false);
                      licensing.onRead();
                    }}
                  >
                    Read the license
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      change(false);
                      licensing.onAccept();
                    }}
                  >
                    Accept the license
                  </Button>
                </div>
              )}
              {(onRestart || onShowLog || trust) && (
                <div className="flex flex-wrap gap-6">
                  {onRestart && (
                    <Button
                      ref={restart}
                      variant={failed ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        change(false);
                        onRestart();
                      }}
                    >
                      {restartLabel(state)}
                    </Button>
                  )}
                  {onShowLog && (
                    <Button
                      ref={onRestart || licensing ? undefined : first}
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
                      ref={onRestart || onShowLog || licensing ? undefined : first}
                      variant={state.kind === 'off' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        change(false);
                        trust.onChoose();
                      }}
                    >
                      {trustLabel(trust.action)}
                    </Button>
                  )}
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {failed && onRestart && (
        <button
          ref={beside}
          type="button"
          // Named for its server: a bar can hold several, each with a button like it.
          aria-label={`${restartLabel(state)} ${showFormat(name)}`}
          className="inline-flex h-20 flex-none items-center rounded-xs px-6 text-fg hover:bg-hover focus-visible:shadow-ring"
          onClick={() => {
            // The button goes once the server is starting, and takes focus with it: the item stays.
            trigger.current?.focus({ preventScroll: true });
            onRestart();
          }}
        >
          {restartLabel(state)}
        </button>
      )}
    </>
  );
}

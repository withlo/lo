import { cva } from 'class-variance-authority';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { formatBytes } from './bytes.ts';
import { besideIn, handOffFocus } from './focus.ts';
import { showFormat } from './controls.ts';
import { CopyFaces, CopyStatus, useCopy, useCopySaid } from './CopyButton.tsx';
import { Popover } from './Popover.tsx';
import { Problem, type ProblemAction } from './Problem.tsx';
import { ShownText } from './ShownText.tsx';
import {
  STATUS_BUTTON,
  StatusActions,
  StatusBall,
  StatusLine,
  type StatusBallState,
} from './StatusBar.tsx';

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
   * The toolchain it needs isn't installed: `needs` names it ("Go 1.24 or newer", "a JDK"), and
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
   * "Trust repo…" and "Trust pull request…" ask in a dialog of main's, so they end in an
   * ellipsis, and the details stay open while Lo asks; "Stop trusting" takes it away at once, and
   * closes them.
   */
  action: 'repo' | 'pr' | 'stop';
  onChoose: () => void;
  /**
   * What Lo is doing about it, while it does: "Checking…", "Trusting…". The button is busy and says
   * so, with a ring turning, in place of its label, and pressing it does nothing until it's done.
   */
  busy?: string | undefined;
  /**
   * The widest thing it says while busy, where `busy` changes as Lo goes on: "Trusting…" for one
   * that says "Waiting…" first. The button holds that room from the start, so it's one width.
   */
  widest?: string | undefined;
  /** Why trusting didn't happen, which the details say under their line, until it's asked again. */
  failure?: ServerTrustFailure | undefined;
}

/** Why trusting didn't happen, as a `Problem`, and what to do about it, if anything. */
export interface ServerTrustFailure {
  /** What didn't happen: "Couldn’t trust fieldwork/atlas-api". */
  title: string;
  /** Why, in a sentence, or nothing where the cause isn't known. */
  message: string;
  /** A name in `message` that's code, such as `settings.json`, which shows as code. */
  code?: string | undefined;
  /** What the settings file or the system said, as it came, behind Details. */
  details?: string | undefined;
  /** A button that helps, after the reason: "Open settings.json". */
  fix?: { label: ReactNode; onChoose: () => void } | undefined;
}

export interface ServerStatusProps {
  /** The language: "TypeScript". */
  name: string;
  state: ServerState;
  /** The program and its version, for the details: "tsserver 5.6.3". */
  version?: string | undefined;
  /**
   * The details' one line, where the caller knows it better than the state does: what language
   * servers are off for, "Language servers are off for fieldwork/atlas-api".
   */
  line?: string | undefined;
  /**
   * The button that starts it again. A failed download offers "Try again" in its place, and one
   * waiting in line "Start next", unless it's next already. One refused offers none.
   */
  onRestart?: (() => void) | undefined;
  onShowLog?: (() => void) | undefined;
  /** The details' way to trust the repo, or to stop. */
  trust?: ServerTrust | undefined;
  /** Whether the details are open. Without it, the item keeps its own. */
  open?: boolean | undefined;
  /**
   * They're open unasked, as an offer: focus stays where the reader is, and a screen reader hears
   * their line, politely.
   */
  quiet?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Where the details are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

/** The percent of a progress report, clamped to the scale it's on. */
function percentOf(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** "38 / 112 MB": how much of a download has come, in the whole's unit where they share one. */
function measure(done: number, total: number): string {
  const part = formatBytes(done);
  const whole = formatBytes(total);
  const unit = part.slice(part.lastIndexOf(' '));
  return whole.endsWith(unit) ? `${part.slice(0, -unit.length)} / ${whole}` : `${part} / ${whole}`;
}

/**
 * What the item says of a server: its state in words, around its name. `name` is how the name is
 * drawn, as text or as `ShownText`, so one list of words serves a screen reader and the eye.
 */
function words<T>(name: T, state: ServerState): (T | string)[] {
  switch (state.kind) {
    case 'downloading':
      return ['Downloading ', name, ` · ${measure(state.done, state.total)}`];
    case 'unpacking':
      return ['Installing ', name, '…'];
    case 'building':
      return ['Building ', name, '…'];
    case 'waiting':
      return [name, ' · waiting to start'];
    case 'starting':
      return ['Starting ', name, '…'];
    case 'indexing':
      return state.percent === undefined
        ? ['Indexing with ', name, '…']
        : ['Indexing with ', name, ` · ${percentOf(state.percent)}%`];
    case 'ready':
      return [name];
    case 'notAnswering':
      return [name, ' isn’t responding'];
    case 'failed':
      return [name, ' isn’t running'];
    case 'missing':
      return [name, ` needs ${state.needs}`];
    case 'refused':
      return [name, ' can’t use the local copy'];
    case 'off':
      return ['Language servers off'];
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/**
 * The words beside a language server's ball in the status bar, which Settings' list of language
 * servers says too: "Starting gopls…", "gopls", "gopls isn’t running".
 */
export function ServerWords({ name, state }: { name: string; state: ServerState }): ReactNode {
  return words(<ShownText key="name" text={name} />, state).map((part, index) =>
    typeof part === 'string' ? (
      // Numbers keep their width as they count.
      <span key={index} className={/\d/.test(part) ? 'lo-num' : undefined}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** The same words as text: the details' name, for a screen reader. */
export function serverText(name: string, state: ServerState): string {
  return words(showFormat(name), state).join('');
}

/** A language server's state as its ball draws it. */
export function serverBall(state: ServerState): StatusBallState {
  switch (state.kind) {
    case 'downloading':
    case 'unpacking':
    case 'building':
    case 'starting':
    case 'indexing':
      return 'working';
    case 'ready':
      return 'ready';
    case 'waiting':
      return 'warn';
    case 'failed':
    case 'notAnswering':
    case 'missing':
      return 'failed';
    case 'refused':
    case 'off':
      return 'off';
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** A server's item, as `StatusItem` draws one. A server that can't run is tinted. */
const item = cva(STATUS_BUTTON, {
  variants: {
    failed: { true: 'bg-danger-bg text-danger', false: '' },
  },
});

/** `text`, with the name `code` in it shown as code: "`settings.json` has an error." */
function Coded({ text, code }: { text: string; code?: string | undefined }) {
  const at = code === undefined ? -1 : text.indexOf(code);
  if (code === undefined || at === -1) return <ShownText text={text} />;
  return (
    <>
      <ShownText text={text.slice(0, at)} />
      <code>{code}</code>
      <ShownText text={text.slice(at + code.length)} />
    </>
  );
}

/** What the button that takes the reader to trust, or to stop, says. */
function trustLabel(action: ServerTrust['action']): string {
  switch (action) {
    case 'repo':
      return 'Trust repo…';
    case 'pr':
      return 'Trust pull request…';
    case 'stop':
      return 'Stop trusting';
    default:
      action satisfies never;
      throw new Error(`A way to change trust Lo doesn't know: ${JSON.stringify(action)}.`);
  }
}

/**
 * What the button that starts a server again says: for one waiting in line, which it puts first,
 * "Start next"; for a download that failed, "Try again".
 */
function restartLabel(state: ServerState): string {
  if (state.kind === 'waiting') return 'Start next';
  return state.kind === 'failed' && state.why.kind === 'download' ? 'Try again' : 'Restart';
}

/** Why a server can't run, for its `Problem`: the reason where it's known, and what it said. */
interface CantRun {
  readonly reason?: string | undefined;
  readonly details?: string | undefined;
  /** The command that installs what it needs, which the Problem's button copies. */
  readonly install?: string | undefined;
}

/** Why a server can't run, or nothing for one that isn't stopped. */
function cantRun(state: ServerState): CantRun | undefined {
  switch (state.kind) {
    case 'notAnswering':
      return { reason: 'It didn’t respond.' };
    case 'failed': {
      const { why } = state;
      switch (why.kind) {
        case 'memory':
          return {
            reason: 'It ran out of memory.',
            details:
              why.files === undefined
                ? why.limit
                : `${why.limit}, ${why.files.toLocaleString('en-US')} files`,
          };
        case 'download':
        case 'error':
          // What it said is its own sentence, not a cause Lo knows: it goes behind Details.
          return { details: why.message };
        default:
          why satisfies never;
          throw new Error(`A failure Lo doesn't know: ${JSON.stringify(why)}.`);
      }
    }
    case 'missing':
      return {
        reason: `${state.plural === true ? 'They need' : 'It needs'} ${state.needs}.`,
        details: state.install,
        install: state.install,
      };
    case 'downloading':
    case 'unpacking':
    case 'building':
    case 'waiting':
    case 'starting':
    case 'indexing':
    case 'ready':
    case 'refused':
    case 'off':
      return undefined;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** The details' one line for a server that can run: what it waits for, why it's held, its version. */
function lineOf(state: ServerState, version: string | undefined): ReactNode {
  switch (state.kind) {
    case 'waiting':
      return `At most ${state.count} language servers run at once.`;
    case 'refused':
      return <ShownText text={state.why} />;
    case 'ready':
      return version === undefined ? undefined : <ShownText text={version} />;
    case 'downloading':
    case 'unpacking':
    case 'building':
    case 'starting':
    case 'indexing':
    case 'notAnswering':
    case 'failed':
    case 'missing':
    case 'off':
      return undefined;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/**
 * One language server in the status bar, as `StatusItem` draws an item: its ball and its state in
 * words, "Starting gopls…" while it comes up and its name alone once it's ready. A click, or `⏎`
 * on it, opens its details over it: one line of state, or why it can't run, and what to do: start
 * it again, read its log, trust the repo or stop trusting it. A server that stopped shows its
 * Restart beside its name, since that's the one thing to do. The item is quiet while all is well.
 */
export function ServerStatus({
  name,
  state,
  version,
  line,
  onRestart,
  onShowLog,
  trust,
  open,
  quiet = false,
  onOpenChange,
  container,
}: ServerStatusProps) {
  // One first in line for room already starts as soon as it can, and one refused would only be
  // refused again on this head: there's nothing to offer either.
  const again =
    (state.kind === 'waiting' && state.next) || state.kind === 'refused' ? undefined : onRestart;
  const [kept, setKept] = useState(false);
  const shown = open ?? kept;
  const first = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const beside = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement | null>(null);
  const copy = useCopy();
  const [copied, sayCopied] = useCopySaid();
  // Whatever takes the item away while it has focus, such as a caller that draws another item for
  // the new state, would drop focus on the page: it goes to the bar's next item, else its previous
  // one, else the bar.
  useLayoutEffect(
    () => () => {
      const leaving = [trigger.current, beside.current, details.current];
      const stops = besideIn(trigger.current?.parentElement, leaving);
      handOffFocus(leaving, () => stops);
    },
    [],
  );
  const ball = serverBall(state);
  const stopped = cantRun(state);
  const says = line ?? lineOf(state, version);
  const change = (next: boolean) => {
    setKept(next);
    onOpenChange?.(next);
  };
  const restart = (): void => {
    change(false);
    again?.();
  };
  const install = stopped?.install;
  // The one thing to do about a server that can't run is its Problem's button: copy what installs
  // what it needs, or start it again.
  const fix: ProblemAction | undefined =
    install !== undefined
      ? {
          label: <CopyFaces said={copied}>Copy command</CopyFaces>,
          ref: first,
          onClick: () => {
            Promise.resolve()
              .then(() => copy(install))
              .then(
                () => sayCopied('copied'),
                () => sayCopied('failed'),
              );
          },
        }
      : stopped !== undefined && again
        ? { label: restartLabel(state), onClick: restart, ref: first }
        : undefined;
  // Restart goes in the row under the line, unless the Problem holds it.
  const restartInRow = again !== undefined && (stopped === undefined || install !== undefined);
  return (
    <>
      <Popover
        open={shown}
        onOpenChange={change}
        trigger={
          <button type="button" ref={trigger} className={item({ failed: ball === 'failed' })}>
            <StatusBall state={ball} />
            <span className="min-w-0 truncate">
              <ServerWords name={name} state={state} />
            </span>
          </button>
        }
        side="top"
        scope="dialog"
        label={serverText(name, state)}
        // The details take focus as they open, not a frame on, so a key pressed then is theirs. It
        // goes to the first button in their row, or to them when there's none.
        initialFocus={first}
        takeFocus={!quiet}
        popupRef={details}
        container={container}
        className="flex status-details flex-col gap-8 p-12"
      >
        {says !== undefined && <StatusLine>{says}</StatusLine>}
        {stopped !== undefined && (
          <Problem
            layout="details"
            title={
              <>
                Can’t run <ShownText text={name} />
              </>
            }
            reason={stopped.reason === undefined ? undefined : <ShownText text={stopped.reason} />}
            action={fix}
            details={stopped.details}
          />
        )}
        {install !== undefined && <CopyStatus said={copied} />}
        {trust?.failure && (
          <Problem
            layout="details"
            title={<ShownText text={trust.failure.title} />}
            reason={
              trust.failure.message === '' ? undefined : (
                <Coded text={trust.failure.message} code={trust.failure.code} />
              )
            }
            action={
              trust.failure.fix && {
                label: trust.failure.fix.label,
                onClick: trust.failure.fix.onChoose,
              }
            }
            details={trust.failure.details}
          />
        )}
        {(restartInRow || onShowLog || trust) && (
          <StatusActions flush={!restartInRow && (onShowLog !== undefined || state.kind !== 'off')}>
            {restartInRow && (
              <Button ref={fix ? undefined : first} variant="secondary" size="sm" onClick={restart}>
                {restartLabel(state)}
              </Button>
            )}
            {onShowLog && (
              <Button
                ref={restartInRow || fix ? undefined : first}
                variant="ghost"
                size="sm"
                onClick={() => {
                  change(false);
                  onShowLog();
                }}
              >
                Show log
              </Button>
            )}
            {trust && (
              <Button
                ref={restartInRow || fix || onShowLog ? undefined : first}
                variant={state.kind === 'off' ? 'secondary' : 'ghost'}
                size="sm"
                busy={trust.busy !== undefined}
                working={trust.busy}
                widest={trust.widest}
                onClick={() => {
                  // Trusting asks first, and says here how that goes.
                  if (trust.action === 'stop') change(false);
                  trust.onChoose();
                }}
              >
                {trustLabel(trust.action)}
              </Button>
            )}
          </StatusActions>
        )}
      </Popover>
      {state.kind === 'failed' && again && (
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
      {/* Opened unasked, the details take no focus, so a screen reader hears their line here. */}
      <span role="status" className="sr-only">
        {shown && quiet && says !== undefined ? says : ''}
      </span>
    </>
  );
}

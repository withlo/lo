import { Popover } from '@base-ui/react/popover';
import { cva } from 'class-variance-authority';
import { useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { useTakeFocus } from './focus.ts';
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
  | { kind: 'failed'; why: ServerFailure }
  /**
   * The toolchain it needs isn't installed: `needs` names it ("Go 1.24 or later", "a JDK"), and
   * `install` is a command that installs it, when there is one.
   */
  | { kind: 'missing'; needs: string; install?: string | undefined };

export interface ServerStatusProps {
  /** The language: "TypeScript". */
  name: string;
  state: ServerState;
  /** The program and its version, for the details: "tsserver 5.6.3". */
  version?: string | undefined;
  /** The button that starts it again. A failed download offers "Retry" in its place. */
  onRestart?: (() => void) | undefined;
  onShowLog?: (() => void) | undefined;
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

/** The word or words beside the language's name in the status bar. */
function Words({ name, state }: { name: string; state: ServerState }): ReactNode {
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
    case 'failed':
      return <>{name} failed</>;
    case 'missing':
      return <>{name} toolchain missing</>;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

const DOT = {
  ok: 'bg-success',
  warn: 'bg-warning',
  fail: 'bg-danger',
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
    case 'missing':
      return <span className={`size-8 flex-none rounded-full ${DOT.warn}`} aria-hidden="true" />;
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
function heading(name: string, state: ServerState): string {
  switch (state.kind) {
    case 'downloading':
      return `${name} downloading`;
    case 'starting':
      return `${name} starting`;
    case 'indexing':
      return `${name} indexing`;
    case 'ready':
      return `${name} ready`;
    case 'failed':
      return `${name} stopped`;
    case 'missing':
      return `${name} toolchain missing`;
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** What went wrong, in a sentence, for a failure. */
function why(failure: ServerFailure): string {
  switch (failure.kind) {
    case 'memory':
      return failure.files === undefined
        ? `It ran out of memory at ${failure.limit}.`
        : `It ran out of memory at ${failure.limit} while loading ${failure.files.toLocaleString('en-US')} files.`;
    case 'download':
    case 'error':
      return failure.message;
    default:
      failure satisfies never;
      throw new Error(`A failure Lo doesn't know: ${JSON.stringify(failure)}.`);
  }
}

/** What the details say under the heading. */
function detail(name: string, state: ServerState): ReactNode {
  switch (state.kind) {
    case 'downloading':
    case 'starting':
    case 'indexing':
      return WAITING;
    case 'ready':
      return undefined;
    case 'failed':
      return `${why(state.why)} ${FALLBACK}`;
    case 'missing':
      return (
        <>
          {name} needs {state.needs}.
          {state.install !== undefined && (
            <>
              {' '}
              Install it with <code className="text-fg code-small">{state.install}</code>.
            </>
          )}{' '}
          {UNTIL}
        </>
      );
    default:
      state satisfies never;
      throw new Error(`A language server state Lo doesn't know: ${JSON.stringify(state)}.`);
  }
}

/** What the button that starts a server again says. */
function restartLabel(state: ServerState): string {
  return state.kind === 'failed' && state.why.kind === 'download' ? 'Retry' : 'Restart';
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
  open,
  onOpenChange,
  container,
}: ServerStatusProps) {
  const [kept, setKept] = useState(false);
  const shown = open ?? kept;
  const restart = useRef<HTMLButtonElement>(null);
  // The details take focus as they open, not a frame on, so a key pressed then is theirs.
  const takeFocus = useTakeFocus(restart);
  const failed = state.kind === 'failed';
  const says = detail(name, state);
  const change = (next: boolean) => {
    setKept(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <Popover.Root open={shown} onOpenChange={change}>
        <Popover.Trigger className={item({ failed })}>
          <Mark state={state} />
          <span className="min-w-0 truncate">
            <Words name={name} state={state} />
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
              ref={takeFocus}
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
                    {version}
                  </span>
                )}
              </div>
              {says !== undefined && (
                <Popover.Description className="m-0 text-fg-muted text-small">
                  {says}
                </Popover.Description>
              )}
              {(onRestart || onShowLog) && (
                <div className="flex gap-6">
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
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {failed && onRestart && (
        <button
          type="button"
          className="inline-flex h-20 flex-none items-center rounded-xs px-6 text-fg hover:bg-hover focus-visible:shadow-ring"
          onClick={onRestart}
        >
          {restartLabel(state)}
        </button>
      )}
    </>
  );
}

// A merge queue's tab: the repository, the branch and the queue's settings, with a switch of the
// branches it can show; the queue's entries in order, those tested together in a group, then those
// waiting to join, then those Lo saw leave and why; and a status bar of its own, with when the
// queue was last checked and a hint for each of the queue's keys, which runs it when clicked. A
// row's actions show on the row the keyboard is on, and on one under the pointer: an entry's
// removal and its move to the front, the auto-merge of one waiting to join, and a `⋯` that opens
// the row's menu. A double click opens a row's pull request. What was asked of a row that didn't
// go shows under it, with what can be done about it.

import {
  Branch,
  Button,
  EmptyState,
  HintButton,
  HintRow,
  Key,
  keyAria,
  Loading,
  MoreButton,
  Problem,
  QueueTable,
  SegmentedControl,
  StatusBar,
  StatusItem,
  StatusKeys,
  type QueueItem,
  type LeftEntry as TableLeft,
  type WaitingEntry as TableWaiting,
} from '@lo/ui';
import { controlOf, keyLabels, runControl, setScopeSource, type Target } from '@lo/ui/commands';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import type { QueueTab } from '../../tab/contract.ts';
import { useTabState, withoutBidi } from '../../tab/window/shared.ts';
import { QUEUE_EVERY, type QueueRead, type QueueState } from '../contract.ts';
import {
  acting,
  nextLabel,
  problemAction,
  problemKey,
  reasonOf,
  workingWord,
  workKey,
  type RowProblem,
  type Working,
} from './acting.ts';
import { focusRow, openOnGithub, openPage, rowTarget, setTable, showBranch } from './actions.ts';
import { main } from './main.ts';
import {
  focusedRow,
  itemsOf,
  leftOf,
  retryIn,
  rowsOf,
  settingsOf,
  updated,
  waitingOf,
} from './rows.ts';
import { focusedRows, queuesStore, showQueue } from './store.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The time now, ticking each second, for how long ago the queue was read and entries joined. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const onHeldKeys = (listener: () => void) => registry().onHeldKeys(listener);
const heldKeys = () => registry().heldKeys();

/** The keys held for a command still to come, as `g` before `gx`. */
function HeldKeys() {
  const held = useSyncExternalStore(onHeldKeys, heldKeys);
  return held === '' ? null : <StatusKeys keys={held} />;
}

/** A row as a command's target. */
function target(key: string): { kind: 'row'; row: string } {
  return { kind: 'row', row: key };
}

/**
 * A row's button for command `id` on the row `row`: its words, and its key on the row the keyboard
 * is on alone, else in its tooltip; dimmed with why while it can't run, and busy, saying
 * `working`, while what it started is at work.
 */
function RowButton({
  id,
  row,
  busy,
  working,
  children,
}: {
  id: string;
  row: string;
  busy: boolean;
  working: string;
  children: string;
}) {
  const control = controlOf(id, target(row));
  if (!control) return null;
  // At work, it's busy, not dimmed with what's at work.
  const off = busy ? undefined : control.off;
  return (
    <Button
      variant="ghost"
      size="sm"
      // The table has the keyboard: its rows' buttons are for the pointer.
      tabIndex={-1}
      busy={busy}
      working={working}
      align="end"
      disabled={off !== undefined}
      hint={off ?? children}
      hintKeys={control.keys}
      {...keyAria(control.keys, control.shortcut)}
      onClick={(event) => {
        // The row's own click would move the keyboard to it under the dialog this opens.
        event.stopPropagation();
        if (off === undefined && !busy) runControl(id, target(row));
      }}
    >
      {children}
      {control.keys && (
        // Narrow, the key goes first, so the row's words still fit.
        <span className="contents queue-chip">
          <Key keys={control.keys} when="focus" decorative />
        </span>
      )}
    </Button>
  );
}

/** The `⋯` at a row's end, which opens the row's menu, as a right-click on it does. */
function More({ number }: { number: number }) {
  return <MoreButton label={`More actions for #${number}`} />;
}

/**
 * The queue's entries, with what can be done to each: its move to the front, for an `admin`,
 * unless it's there already, and its removal, each busy while it's at work; and what went wrong
 * with what was asked of it, under it.
 */
function withEntryActions(
  items: readonly QueueItem[],
  admin: boolean,
  working: (number: number) => Working | undefined,
  noteOf: (number: number) => ReactNode,
): QueueItem[] {
  const withActions = <E extends { key: string; position: number; number: number }>(entry: E) => {
    const at = working(entry.number);
    return {
      ...entry,
      actions: (
        <>
          <span className="flex queue-label items-center gap-4">
            {admin && (entry.position > 1 || at === 'jump') && (
              <RowButton
                id="queue.jump"
                row={entry.key}
                busy={at === 'jump'}
                working={workingWord('jump')}
              >
                Move to front…
              </RowButton>
            )}
            <RowButton
              id="queue.remove"
              row={entry.key}
              busy={at === 'remove'}
              working={workingWord('remove')}
            >
              Remove…
            </RowButton>
          </span>
          <More number={entry.number} />
        </>
      ),
      note: noteOf(entry.number),
    };
  };
  return items.map((item) =>
    item.kind === 'entry'
      ? { kind: 'entry', entry: withActions(item.entry) }
      : { kind: 'group', group: { ...item.group, entries: item.group.entries.map(withActions) } },
  );
}

/** Those waiting to join, with the button that turns auto-merge off, busy while it's at work. */
function withWaitingActions(
  waiting: readonly TableWaiting[],
  working: (number: number) => Working | undefined,
  noteOf: (number: number) => ReactNode,
): TableWaiting[] {
  return waiting.map((entry) => ({
    ...entry,
    actions: (
      <>
        <span className="flex queue-label items-center">
          <RowButton
            id="queue.autoMerge"
            row={entry.key}
            busy={working(entry.number) === 'autoMergeOff'}
            working={workingWord('autoMergeOff')}
          >
            Turn off auto-merge
          </RowButton>
        </span>
        <More number={entry.number} />
      </>
    ),
    note: noteOf(entry.number),
  }));
}

/** Those that left, with the `⋯` that opens their menu. */
function withLeftActions(
  left: readonly TableLeft[],
  noteOf: (number: number) => ReactNode,
): TableLeft[] {
  return left.map((entry) => ({
    ...entry,
    actions: <More number={entry.number} />,
    note: noteOf(entry.number),
  }));
}

/** What went wrong with what was asked of a row, under it, with what can be done about it. */
function RowNote({ problem }: { problem: RowProblem }) {
  const label = problem.unknown ? 'Check again' : nextLabel(problem.next);
  return (
    <Problem
      title={withoutBidi(problem.title)}
      reason={reasonOf(problem)}
      details={problem.details}
      action={
        label === undefined
          ? undefined
          : {
              label,
              onClick: () => problemAction(problem.id, problem.number),
              busy: problem.busy === true,
              working: 'Checking…',
            }
      }
    />
  );
}

/** Asks main what it has for merge queue tab `id`, unless it has said already. */
function useCatchUp(id: string): void {
  useEffect(() => {
    if (queuesStore.getState().states.has(id)) return;
    main()
      .state({ id })
      .then((state) => {
        if (state && !queuesStore.getState().states.has(id)) showQueue(state);
      })
      .catch((error: unknown) => console.error("Lo couldn't ask about a merge queue:", error));
  }, [id]);
}

/** "Try now": reads the queue and those waiting to join again, its button busy meanwhile. */
function useTryNow(id: string): { busy: boolean; run: () => void } {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: () => {
      if (busy) return;
      setBusy(true);
      main()
        .look({ id })
        .catch((error: unknown) => console.error("Lo couldn't read a merge queue:", error))
        .finally(() => setBusy(false));
    },
  };
}

/** Signs in to the queue's account again. */
function signIn(): void {
  registry().run('accounts.addAccount', { kind: 'none' });
}

/**
 * Why the queue can't be checked now, as the error's shape says it: its cause, and when it's read
 * again, with GitHub's own words behind Details; `view` when there's no queue drawn behind it.
 */
function Failed({ state, now, view }: { state: QueueState; now: number; view: boolean }) {
  const tryNow = useTryNow(state.id);
  const { failure } = state;
  if (!failure) return null;
  const layout = view ? 'view' : 'inline';
  if (state.away) {
    return (
      <Problem
        layout={layout}
        title="Can’t check the merge queue"
        reason={withoutBidi(failure.message)}
        action={{ label: 'Sign in again', onClick: signIn }}
      />
    );
  }
  const reason = [failure.reason, retryIn(failure.retryAt, now)]
    .filter((part) => part !== undefined)
    .join(' ');
  return (
    <Problem
      layout={layout}
      title="Can’t check the merge queue"
      reason={reason === '' ? undefined : withoutBidi(reason)}
      details={failure.message}
      action={{ label: 'Try now', onClick: tryNow.run, busy: tryNow.busy, working: 'Checking…' }}
    />
  );
}

/** That GitHub left part of the queue out, and when it's read again. */
function LeftOut({ state, now }: { state: QueueState; now: number }) {
  const tryNow = useTryNow(state.id);
  const again = state.readAt === null ? undefined : retryIn(state.readAt + QUEUE_EVERY, now);
  return (
    <Problem
      title="Can’t show the whole queue"
      reason={['GitHub left part of it out.', again].filter((part) => part !== undefined).join(' ')}
      action={{ label: 'Try now', onClick: tryNow.run, busy: tryNow.busy, working: 'Checking…' }}
    />
  );
}

/** The queue, or what stands in for it: that the branch has none. */
function Body({ tab, state, now }: { tab: QueueTab; state: QueueState; now: number }) {
  const focused = useTabState(focusedRows, tab.id);
  const writes = useStore(acting, (value) => value.working);
  const working = (number: number) => writes.get(workKey(tab.owner, tab.repo, number));
  const problems = useStore(acting, (value) => value.problems);
  const table = useRef<HTMLDivElement>(null);
  useEffect(() => setTable(tab.id, () => table.current), [tab.id]);
  const read: QueueRead = state.read;
  const noteOf = (number: number): ReactNode => {
    const problem = problems.get(problemKey(tab.id, number));
    return problem && <RowNote problem={problem} />;
  };
  switch (read.kind) {
    case 'reading':
      return null;
    case 'none':
      return (
        <EmptyState
          icon="git-merge"
          title={
            <>
              <code className="font-code">{withoutBidi(tab.branch)}</code> has no merge queue
            </>
          }
        />
      );
    case 'queue': {
      const { url } = read;
      const on = focusedRow(rowsOf(read), focused)?.key;
      return (
        <>
          <QueueTable
            label={`Merge queue for ${withoutBidi(tab.branch)}`}
            items={withEntryActions(itemsOf(read.entries, now), read.admin, working, noteOf)}
            waiting={withWaitingActions(waitingOf(read.waiting), working, noteOf)}
            left={withLeftActions(leftOf(read.left, now, openPage), noteOf)}
            more={
              read.more > 0 && url !== null
                ? { count: read.more, onOpen: () => void openOnGithub({ kind: 'none' }) }
                : undefined
            }
            // What's above the table says the entries may not all be there.
            empty={read.leftOut ? null : undefined}
            focused={on}
            onRowClick={(key) => focusRow(tab.id, key)}
            onRowOpen={(key) => {
              focusRow(tab.id, key);
              runControl('queue.open', target(key));
            }}
            tableRef={table}
            className="focus-visible:shadow-none"
          />
          {read.waitingCutShort && (
            <p className="m-0 px-12 text-fg-muted text-small">
              More pull requests are waiting to join.
            </p>
          )}
        </>
      );
    }
    default:
      read satisfies never;
      return null;
  }
}

/** The tab's header: what it shows, the queue's settings, the branch switch, and the account. */
function Header({ tab, state }: { tab: QueueTab; state: QueueState | undefined }) {
  const settings = settingsOf(state?.read);
  const branches = state?.branches ?? [];
  return (
    <header className="flex h-header-h min-w-0 flex-none items-center gap-12 bg-bg-chrome ps-16 pe-12">
      <h1 className="m-0 flex-none text-title">Merge queue</h1>
      <span className="flex min-w-0 items-center gap-6 truncate text-fg-muted text-small">
        <span className="flex-none">
          {tab.owner}/{tab.repo} into
        </span>
        <Branch name={tab.branch} base />
        {settings !== undefined && <span className="truncate">· {settings}</span>}
      </span>
      <span className="min-w-8 flex-1" />
      {branches.length > 1 && (
        <SegmentedControl
          kind="views"
          label="Branch"
          size="sm"
          items={branches.map(({ name, count }) => ({
            value: name,
            label: (
              <>
                {withoutBidi(name)}
                {count !== null && <span className="lo-num text-fg-muted">{count}</span>}
              </>
            ),
          }))}
          value={tab.branch}
          onChange={(branch) => void showBranch(tab.id, branch)}
          keys={keyOf('queue.nextBranch')}
        />
      )}
      <span className="inline-flex h-control-h flex-none items-center gap-6 px-6 whitespace-nowrap text-fg text-small">
        <span>
          <span className="text-fg-muted">as</span> {tab.login}
        </span>
      </span>
    </header>
  );
}

/** One of the status bar's hints: its command, and its label on the row the keyboard is on. */
interface Hint {
  readonly command: string;
  readonly label: string;
  /** On the row: the commands that act on one. */
  readonly onRow: boolean;
}

/**
 * What the status bar's hints give up after their key chips, a hint at a time: the one whose turn
 * is `drop1` first. One turn for each hint.
 */
const DROPS = ['drop1', 'drop2', 'drop3', 'drop4', 'drop5', 'drop6', 'drop7'];

/**
 * The status bar's hints: a button for each of the queue's keys, named as the row the keyboard is
 * on has it, each dimmed with why it can't run on it. The row measures itself, as the table does:
 * where it doesn't fit beside the bar's facts, it gives up its key chips, each hint giving its key
 * in its tooltip, then hints from the right, dimmed ones first. The facts on the left never shrink.
 */
function Hints({ tab, read }: { tab: QueueTab; read: QueueRead | undefined }) {
  // Drawn again as what's at work, and the row the keyboard is on, change what each can do.
  useStore(acting, (value) => value.working);
  useTabState(focusedRows, tab.id);
  const on: Target = rowTarget(tab.id);
  const row = on.kind === 'row' ? rowsOf(read).find((each) => each.key === on.row) : undefined;
  const hints: readonly Hint[] = [
    { command: 'queue.down', label: 'Next', onRow: false },
    { command: 'queue.up', label: 'Previous', onRow: false },
    { command: 'queue.open', label: 'Open', onRow: true },
    { command: 'queue.remove', label: 'Remove…', onRow: true },
    { command: 'queue.jump', label: 'Move to front…', onRow: true },
    {
      command: 'queue.autoMerge',
      label: row?.kind === 'left' ? 'Turn on auto-merge…' : 'Turn off auto-merge',
      onRow: true,
    },
    { command: 'queue.openOnGithub', label: 'Open on GitHub', onRow: true },
  ];
  const turns = dropTurns(
    hints.map((hint) => controlOf(hint.command, hint.onRow ? on : undefined)?.off !== undefined),
  );
  return (
    // As wide as the bar has room for, so it measures again as the bar widens.
    <HintRow className="min-w-0 flex-auto items-center justify-end gap-2" more={DROPS}>
      {hints.map((hint, index) => (
        <span key={hint.command} data-gives={`drop${turns[index]}`} className="flex flex-none">
          <HintButton command={hint.command} target={hint.onRow ? on : undefined}>
            {hint.label}
          </HintButton>
        </span>
      ))}
    </HintRow>
  );
}

/**
 * Each hint's turn to be given up, from 1, by its place, where `off` says which are dimmed: from
 * the right, dimmed ones first.
 */
export function dropTurns(off: readonly boolean[]): number[] {
  const order = [
    ...off.flatMap((dimmed, index) => (dimmed ? [index] : [])).toReversed(),
    ...off.flatMap((dimmed, index) => (dimmed ? [] : [index])).toReversed(),
  ];
  const turns = Array.from({ length: off.length }, () => 0);
  order.forEach((index, turn) => {
    turns[index] = turn + 1;
  });
  return turns;
}

/** A merge queue's tab, as its kind draws it. */
export function QueueTabView({ tab }: { tab: QueueTab }) {
  useKeys();
  useCatchUp(tab.id);
  const state = useStore(queuesStore, (value) => value.states.get(tab.id));
  const now = useNow();
  const root = useRef<HTMLDivElement>(null);

  // The queue is the middle of the window, so `Esc` brings focus here, as does showing it when
  // focus was nowhere in particular. Focus goes to its table, the rows, while there's one.
  useEffect(() => {
    const into = () => root.current?.querySelector<HTMLElement>('[role="grid"]') ?? root.current;
    const focusIn = () => into()?.focus();
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) focusIn();
    return setMiddle({
      focus: focusIn,
      holds: (element) => element === into(),
      here: () => undefined,
    });
  }, []);
  // A table drawn once the queue is read takes focus that was on the page itself. When the table
  // goes, as for a branch with no queue, focus that went with it comes back to the page, so the
  // queue's keys, such as `Tab` for the next branch, still work.
  const drawn = state?.read.kind === 'queue';
  useEffect(() => {
    const focused = document.activeElement;
    if (drawn && focused === root.current) {
      root.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    } else if (!drawn && (focused === null || focused === document.body)) {
      root.current?.focus();
    }
  }, [drawn]);
  useEffect(() => {
    const own = root.current;
    return own ? setScopeSource(own, { target: () => rowTarget(tab.id) }) : undefined;
  }, [tab.id]);

  // A right-click on a row, or its `⋯`: the row's menu, the keyboard moving to it.
  const menu = useMenuTarget((event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-key]') : null;
    const key = element instanceof HTMLElement ? element.dataset['key'] : undefined;
    if (key === undefined || !rowsOf(state?.read).some((row) => row.key === key)) return undefined;
    focusRow(tab.id, key);
    return { kind: 'row', row: key };
  });

  const read = state?.read;
  const reading = read === undefined || read.kind === 'reading';
  // Nothing read yet, and nothing failed: the whole view waits.
  const waiting = reading && !state?.failure;
  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="queue"
      data-lo-queue={tab.id}
      className="flex h-full min-h-0 flex-col focus-visible:shadow-none"
    >
      <Header tab={tab} state={state} />
      <main
        className="relative min-h-0 flex-1 overflow-auto sheet"
        aria-busy={waiting || undefined}
        {...menu}
      >
        {waiting ? (
          <Loading status="Opening merge queue…" />
        ) : reading ? (
          state && <Failed state={state} now={now} view />
        ) : (
          state && (
            <div className="flex min-h-full flex-col gap-12 px-24 pt-16 pb-64">
              <Failed state={state} now={now} view={false} />
              {state.read.kind === 'queue' && state.read.leftOut && (
                <LeftOut state={state} now={now} />
              )}
              <Body tab={tab} state={state} now={now} />
            </div>
          )
        )}
      </main>
      <StatusBar
        start={
          // Never shrunk: the hints give way to them.
          <span className="flex flex-none items-center gap-2">
            <StatusItem ball={state?.failure ? 'warn' : 'ready'}>{tab.login}</StatusItem>
            {state !== undefined && state.readAt !== null && (
              <StatusItem>{updated(state.readAt, now)}</StatusItem>
            )}
          </span>
        }
        end={
          <>
            <Hints tab={tab} read={read} />
            <HeldKeys />
          </>
        }
      />
    </div>
  );
}

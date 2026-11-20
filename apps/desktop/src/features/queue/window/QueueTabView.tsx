// A merge queue's tab: the repository, the branch and the queue's settings, with a switch of the
// branches it can show; the queue's entries in order, those tested together in a group, then those
// waiting to join, then those Lo saw leave and why; and a status bar of its own, with when the
// queue was last read. The row the keyboard is on carries what can be done to it, each with its
// key: an entry's removal and, for the repository's admins, its move to the front; the auto-merge
// of one waiting to join.

import {
  Branch,
  Button,
  Callout,
  Key,
  QueueTable,
  SegmentedControl,
  Spinner,
  StatusBar,
  StatusItem,
  StatusKeys,
  Switch,
  type QueueItem,
  type WaitingEntry as TableWaiting,
} from '@lo/ui';
import { keyLabels, setScopeSource } from '@lo/ui/commands';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import type { QueueTab } from '../../tab/contract.ts';
import { useTabState, withoutBidi } from '../../tab/window/shared.ts';
import type { QueueRead, QueueState } from '../contract.ts';
import { act, autoMerge } from './acting.ts';
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

/** A key hint in the status bar: its key, then what it does. */
function Hint({ id, children }: { id: string; children: ReactNode }) {
  const keys = keyOf(id);
  if (keys === undefined) return null;
  return (
    <StatusItem>
      <Key keys={keys} decorative />
      {children}
    </StatusItem>
  );
}

/** A row's button for command `id`, with its key, as the row the keyboard is on shows it. */
function RowButton({ id, run, children }: { id: string; run: () => void; children: ReactNode }) {
  const keys = keyOf(id);
  return (
    <Button
      variant="ghost"
      size="sm"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        run();
      }}
    >
      {children}
      {keys !== undefined && <Key keys={keys} decorative />}
    </Button>
  );
}

/** A row as a command's target. */
function target(key: string): { kind: 'row'; row: string } {
  return { kind: 'row', row: key };
}

/**
 * The queue's entries, with what can be done to the one the keyboard is on, `focused`: its move to
 * the front, for an `admin`, and its removal.
 */
function withEntryActions(
  items: readonly QueueItem[],
  focused: string | undefined,
  admin: boolean,
): QueueItem[] {
  const actions = (key: string): ReactNode =>
    key !== focused ? undefined : (
      <>
        {admin && (
          <RowButton id="queue.jump" run={() => act('jump', target(key))}>
            To the front
          </RowButton>
        )}
        <RowButton id="queue.remove" run={() => act('remove', target(key))}>
          Remove
        </RowButton>
      </>
    );
  return items.map((item) =>
    item.kind === 'entry'
      ? { kind: 'entry', entry: { ...item.entry, actions: actions(item.entry.key) } }
      : {
          kind: 'group',
          group: {
            ...item.group,
            entries: item.group.entries.map((entry) => ({
              ...entry,
              actions: actions(entry.key),
            })),
          },
        },
  );
}

/** Those waiting to join, with the auto-merge switch of the one the keyboard is on, `focused`. */
function withWaitingActions(
  waiting: readonly TableWaiting[],
  focused: string | undefined,
): TableWaiting[] {
  return waiting.map((entry) =>
    entry.key !== focused
      ? entry
      : {
          ...entry,
          actions: (
            <Switch
              checked
              aria-label="Auto-merge"
              onCheckedChange={() => autoMerge(target(entry.key))}
            />
          ),
        },
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

/** `text` as a sentence, ending with a full stop if it ends without one. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/** What the page says above the table: why the last read failed, and what Lo may not see. */
function Notes({ state, now }: { state: QueueState; now: number }) {
  const { failure, read } = state;
  const again = failure && retryIn(failure.retryAt, now);
  return (
    <>
      {failure && (
        <Callout tone="warning" role="status">
          Lo couldn’t read the merge queue for {withoutBidi(state.branch)}.{' '}
          {sentence(withoutBidi(failure.message))}
          {again === undefined ? '' : ` Lo reads it again ${again}.`}
        </Callout>
      )}
      {read.kind === 'queue' && read.leftOut && (
        <Callout tone="warning">
          Lo may not see every entry: GitHub left part of the queue out. Lo reads it again in 20 s.
        </Callout>
      )}
    </>
  );
}

/** The queue, or what stands in for it: that it's being read, or that the branch has none. */
function Body({
  tab,
  read,
  failed,
  now,
}: {
  tab: QueueTab;
  read: QueueRead;
  failed: boolean;
  now: number;
}) {
  const focused = useTabState(focusedRows, tab.id);
  const table = useRef<HTMLDivElement>(null);
  useEffect(() => setTable(tab.id, () => table.current), [tab.id]);
  const branch = withoutBidi(tab.branch);
  switch (read.kind) {
    case 'reading':
      return failed ? null : (
        <p className="m-0 flex items-center gap-8 px-12 py-16 text-fg-muted text-ui">
          <Spinner size="xs" />
          Reading the merge queue for {branch}
        </p>
      );
    case 'none':
      return (
        <p className="m-0 px-12 py-16 text-fg-muted text-ui">
          {branch} has no merge queue: its pull requests merge on their own.
        </p>
      );
    case 'queue': {
      const { url } = read;
      const on = focusedRow(rowsOf(read), focused)?.key;
      return (
        <>
          <QueueTable
            label={`Merge queue for ${branch}`}
            items={withEntryActions(itemsOf(read.entries, now), on, read.admin)}
            waiting={withWaitingActions(waitingOf(read.waiting), on)}
            left={leftOf(read.left, now, openPage)}
            more={
              read.more > 0 && url !== null
                ? { count: read.more, onOpen: () => void openOnGithub({ kind: 'none' }) }
                : undefined
            }
            empty={
              read.leftOut
                ? 'Lo couldn’t read the queue’s entries.'
                : 'Nothing is in the merge queue.'
            }
            focused={on}
            onRowClick={(key) => focusRow(tab.id, key)}
            tableRef={table}
            className="focus-visible:shadow-none"
          />
          {read.waitingCutShort && (
            <p className="m-0 px-12 text-fg-muted text-small">
              Lo may not see every pull request waiting to join.
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
      <span
        className="inline-flex h-control-h flex-none items-center gap-6 px-6 whitespace-nowrap text-fg text-small"
        title={`Reading as ${tab.login}`}
      >
        <span>
          <span className="text-fg-muted">as</span> {tab.login}
        </span>
      </span>
    </header>
  );
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
    const focusIn = () =>
      (root.current?.querySelector<HTMLElement>('[role="grid"]') ?? root.current)?.focus();
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) focusIn();
    return setMiddle({ focus: focusIn, here: () => undefined });
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

  // A right-click on a row: the row's menu, the keyboard moving to it.
  const menu = useMenuTarget((event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-key]') : null;
    const key = element instanceof HTMLElement ? element.dataset['key'] : undefined;
    if (key === undefined || !rowsOf(state?.read).some((row) => row.key === key)) return undefined;
    focusRow(tab.id, key);
    return { kind: 'row', row: key };
  });

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="queue"
      data-lo-queue={tab.id}
      className="flex h-full min-h-0 flex-col focus-visible:shadow-none"
    >
      <Header tab={tab} state={state} />
      <main className="relative min-h-0 flex-1 overflow-auto sheet" {...menu}>
        <div className="flex flex-col gap-12 px-24 pt-16 pb-64">
          {state && <Notes state={state} now={now} />}
          <Body
            tab={tab}
            read={state?.read ?? { kind: 'reading' }}
            failed={Boolean(state?.failure)}
            now={now}
          />
        </div>
      </main>
      <StatusBar
        start={
          <>
            <StatusItem dot={state?.failure ? 'warn' : 'ok'}>{tab.login}</StatusItem>
            {state !== undefined && state.readAt !== null && (
              <StatusItem>{updated(state.readAt, now)}</StatusItem>
            )}
          </>
        }
        end={
          <>
            <Hint id="queue.open">Open</Hint>
            <Hint id="queue.remove">Remove</Hint>
            {state?.read.kind === 'queue' && state.read.admin && (
              <Hint id="queue.jump">To the front</Hint>
            )}
            <Hint id="queue.autoMerge">Auto-merge</Hint>
            <Hint id="queue.openOnGithub">On GitHub</Hint>
            <HeldKeys />
          </>
        }
      />
    </div>
  );
}

// The header's merge status, a dot and one line, and the merge panel it opens under it, as `m`
// does: the verdict and what it merges into, a row for each reason it can't merge, the methods the
// repository allows, the squash commit's text, and what merging would do.

import {
  Branch,
  Checklist,
  CommitText,
  MergeFoot,
  MergeMethods,
  MergePanel,
  MergeStatus,
  type CheckItem,
} from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry, useKeys } from '../../../window/commands/registry.ts';
import { usePull, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import type { MergeState } from '../contract.ts';
import {
  closePanel,
  keepTitleField,
  nextConversation,
  openPage,
  reasonRow,
  STATUS_ROW,
  togglePanel,
} from './actions.ts';
import { main } from './main.ts';
import { panels, statuses, takeStatus, type Panel } from './store.ts';
import {
  headerLine,
  mergeLabel,
  methodLabel,
  methodNote,
  panelHead,
  rowsOf,
  shownMethod,
  type Row,
} from './words.ts';

/** The first key of command `id`, as this system shows it. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The time now, again each half minute while `ticking`, for how old a status is. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** The reason a right-click in the panel's reasons is on, as the menus take it. */
function reasonAt(event: MouseEvent<HTMLElement>) {
  const row =
    event.target instanceof Element ? event.target.closest('[role="option"][data-key]') : null;
  const key = row?.getAttribute('data-key');
  return key ? { kind: 'row' as const, row: reasonRow(key) } : undefined;
}

/** Asks main for view `id`'s status, once the window has none for it, as after a reload. */
function catchUp(id: string): void {
  main()
    .state({ id })
    .then((view) => {
      if (!statuses.getState().views.has(id)) takeStatus({ id, view });
    })
    .catch((error: unknown) => console.error('Lo couldn’t ask whether it can merge:', error));
}

/** Where the squash commit's text GitHub would start with is read: at a head, with a title. */
function squashAt(state: MergeState, title: string | undefined): string {
  return `${state.head}\n${title ?? ''}`;
}

/**
 * Reads the squash commit's text GitHub would start with for view `id`, unless it was read, or is
 * being read, at `at`.
 */
function readSquash(id: string, at: string): void {
  const now = panels.get(id).squash;
  if (now.kind !== 'none' && now.at === at) return;
  panels.update(id, (panel) => ({ ...panel, squash: { kind: 'reading', at } }));
  const settle = (squash: Panel['squash']) => {
    const current = panels.get(id).squash;
    if (current.kind === 'reading' && current.at === at) {
      panels.update(id, (panel) => ({ ...panel, squash }));
    }
  };
  main()
    .panel({ id })
    .then((read) => settle({ kind: 'read', at, title: read.title, message: read.message }))
    .catch((error: unknown) =>
      settle({ kind: 'failed', at, why: error instanceof Error ? error.message : String(error) }),
    );
}

/** A row of the reasons, as the checklist draws it, its links opening through main. */
function itemOf(id: string, row: Row): CheckItem {
  const open = (url: string) => () => openPage(id, url);
  return {
    key: row.key,
    kind: row.kind,
    glyph: row.glyph,
    title: row.title,
    detail: row.detail,
    link: row.link && { label: row.link.label, onOpen: open(row.link.url) },
    subs: row.subs.map((sub) => ({
      key: sub.key,
      name: sub.name,
      note: sub.note,
      tone: sub.tone,
      link: sub.link && { label: sub.link.label, onOpen: open(sub.link.url) },
    })),
    end: row.nextThread ? <NextThread /> : undefined,
  };
}

/** The conversations row's button, which goes to the next one, as `]t` does. */
function NextThread() {
  return (
    <button
      type="button"
      className="inline-flex h-control-h-sm items-center gap-6 rounded-sm px-6 text-fg text-small hover:bg-hover"
      onClick={nextConversation}
    >
      Next
      <span className="text-fg-muted code-small">
        {(keyOf('merge.nextThread') ?? []).join(' ')}
      </span>
    </button>
  );
}

/** The keys the panel's buttons show, which merging will take. */
const ENTER = ['⏎'];
const AUTO = ['a'];

/** The panel's body: its reasons, or the method and the squash commit's text; nothing for neither. */
function bodyOf(
  tab: PullTab,
  state: MergeState,
  panel: Panel,
  rows: readonly Row[],
  list: { id: string; ref: RefObject<HTMLUListElement | null> },
  menu: { onContextMenu: (event: MouseEvent<HTMLElement>) => void },
): ReactNode {
  const method = shownMethod(state, panel.method);
  const { action } = state;
  const parts: ReactNode[] = [];
  if (rows.length > 0) {
    parts.push(
      <div key="reasons" {...menu}>
        <Checklist
          label="Why it can’t merge"
          id={list.id}
          rows={rows.map((row) => itemOf(tab.id, row))}
          focused={panel.focused}
          listRef={list.ref}
          className="pb-8"
        />
      </div>,
    );
  }
  if (state.verdict === 'ready' && action.kind === 'merge') {
    const squash = panel.squash;
    parts.push(
      <div key="merge" className="flex flex-col gap-12 pb-8">
        <MergeMethods
          methods={action.methods.map((value) => ({ value, label: methodLabel(value) }))}
          value={method}
          onChange={(value) => panels.update(tab.id, (current) => ({ ...current, method: value }))}
          note={methodNote(state)}
          keys={keyOf('merge.nextMethod')}
        />
        {method === 'SQUASH' && (
          <div data-lo-scope="commit" data-lo-tab="browser">
            <CommitText
              titleRef={keepTitleField}
              title={{
                value: panel.title,
                onChange: (title) => panels.update(tab.id, (current) => ({ ...current, title })),
                // GitHub's text, which the pull request's author wrote, drawn without the
                // characters that turn text around.
                placeholder: squash.kind === 'read' ? withoutBidi(squash.title) : undefined,
              }}
              message={{
                value: panel.message,
                onChange: (message) =>
                  panels.update(tab.id, (current) => ({ ...current, message })),
                placeholder: squash.kind === 'read' ? withoutBidi(squash.message) : undefined,
              }}
            />
            {squash.kind === 'failed' && (
              <p className="m-0 mt-6 text-fg-muted text-small">{withoutBidi(squash.why)}</p>
            )}
          </div>
        )}
      </div>,
    );
  }
  if (state.verdict === 'ready' && action.kind === 'enqueue') {
    parts.push(
      <p key="queue" className="m-0 pb-8 text-fg-muted text-small">
        The queue’s settings choose the method and the message
        {action.method === null ? '.' : `: ${methodLabel(action.method).toLowerCase()}.`}
      </p>,
    );
  }
  return parts.length > 0 ? parts : undefined;
}

/** The panel's foot: what merging would do, named for it; nothing while it's queued. */
function footOf(state: MergeState, panel: Panel): ReactNode {
  const { action } = state;
  if (state.verdict === 'queued') return undefined;
  const method = shownMethod(state, panel.method);
  const enter = ENTER;
  const auto =
    state.autoMerge !== null
      ? { on: true, onChange: () => undefined, keys: AUTO }
      : action.kind === 'enqueue'
        ? undefined
        : { on: false, onChange: () => undefined, keys: AUTO };
  if (action.kind === 'enqueue') {
    return (
      <MergeFoot
        auto={auto}
        method={action.method === null ? undefined : methodLabel(action.method)}
        primary={{ label: 'Add to merge queue', keys: enter }}
      />
    );
  }
  if (action.kind === 'merge') {
    return (
      <MergeFoot
        auto={auto}
        primary={{ label: mergeLabel(method ?? action.method), keys: enter }}
      />
    );
  }
  return (
    <MergeFoot
      auto={auto}
      method={method === undefined ? undefined : methodLabel(method)}
      primary={{
        label: state.queue.required ? 'Add to merge queue' : 'Merge',
        keys: enter,
        disabled: true,
        quiet: state.autoMerge !== null,
      }}
    />
  );
}

/** The merge status in a pull request's header, and the merge panel under it. */
export function MergeHeader({ tab }: { tab: PullTab }) {
  useKeys();
  const view = useStore(statuses, (state) => state.views.get(tab.id));
  const panel = useTabState(panels, tab.id);
  const title = usePull(tab.id)?.header?.title;
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const known = view?.kind === 'known' ? view.state : undefined;
  const now = useNow(known !== undefined && known.verdict !== 'merged');
  const statusMenu = useMenuTarget({ kind: 'row', row: STATUS_ROW });
  const squashing =
    panel.open &&
    known?.verdict === 'ready' &&
    known.action.kind === 'merge' &&
    shownMethod(known, panel.method) === 'SQUASH';
  const at = known && squashAt(known, title);
  useEffect(() => {
    if (!statuses.getState().views.has(tab.id)) catchUp(tab.id);
    // The panel closes as its tab leaves the screen.
    return () => closePanel(tab.id);
  }, [tab.id]);
  // Read as the panel opens on a squash, and again when the head or the title moves.
  useEffect(() => {
    if (squashing && at !== undefined) readSquash(tab.id, at);
  }, [squashing, at, tab.id]);
  const line = headerLine(view, now);
  if (!line) return null;
  const keys = keyOf('merge.panel');
  return (
    <>
      <span className="contents" {...(line.opens ? statusMenu : {})}>
        <MergeStatus
          kind={line.kind}
          verdict={line.verdict}
          detail={line.detail}
          title={line.title}
          keys={keys}
          onClick={line.opens ? () => togglePanel(tab.id, tab.number) : undefined}
          expanded={line.opens ? panel.open : undefined}
          ref={setButton}
        />
      </span>
      {known && line.opens && (
        <PanelUnder
          tab={tab}
          state={known}
          panel={panel}
          anchor={button}
          listRef={listRef}
          now={now}
        />
      )}
    </>
  );
}

/** The merge panel, under the header's status. */
function PanelUnder({
  tab,
  state,
  panel,
  anchor,
  listRef,
  now,
}: {
  tab: PullTab;
  state: MergeState;
  panel: Panel;
  anchor: HTMLButtonElement | null;
  listRef: RefObject<HTMLUListElement | null>;
  now: number;
}) {
  const list = `merge-${useId()}`;
  const head = panelHead(state);
  const rows = rowsOf(state, now);
  const reasonMenu = useMenuTarget(reasonAt);
  return (
    <MergePanel
      open={panel.open}
      onOpenChange={(open) => {
        if (!open) closePanel(tab.id);
      }}
      anchor={anchor}
      container={document.getElementById('root')}
      scope="merge"
      kind={head.kind}
      verdict={head.verdict}
      sub={
        <>
          {head.into && (
            <>
              into <Branch name={state.base} base />
            </>
          )}
          {head.after !== undefined && (
            <span className="min-w-0 truncate">{withoutBidi(head.after)}</span>
          )}
        </>
      }
      closeKeys={keyOf('merge.close')}
      focusRef={rows.length > 0 ? listRef : undefined}
      foot={footOf(state, panel)}
    >
      {bodyOf(tab, state, panel, rows, { id: list, ref: listRef }, reasonMenu)}
    </MergePanel>
  );
}

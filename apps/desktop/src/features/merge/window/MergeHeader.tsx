// The header's merge status, a dot and one line, and the merge panel it opens under it, as `m`
// does: the verdict and what it merges into, a row for each reason it can't merge, the methods the
// repository allows, the squash commit's text, and what merging would do: with the layers below it
// in a GitHub stack, or, for a chain that isn't one, after making it one, which `gS` does from here
// as from anywhere in the tab, or a layer at a time from its bottom one.

import {
  Branch,
  Button,
  Callout,
  Checklist,
  CommitText,
  Key,
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

import { currentMenu, useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry, useKeys } from '../../../window/commands/registry.ts';
import stacks from '../../stacks/keys.ts';
import { usePull, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import type { MergeState, Placement } from '../contract.ts';
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
import { mergeFromPanel } from './merging.ts';
import { panels, placementOf, statuses, takeStatus, type Panel } from './store.ts';
import {
  headerLine,
  mergeLabel,
  methodLabel,
  methodNote,
  numbers,
  offWords,
  panelHead,
  placedLabel,
  rowsOf,
  shownMethod,
  type Row,
} from './words.ts';

/** The stacks feature's `gS`, which makes the chain on screen a GitHub stack. */
const CONVERT = `${stacks.feature}.${'convert' satisfies keyof typeof stacks.commands}`;

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

/** Where the place is asked about: at a head, into a base, with a verdict. */
function placeAt(state: MergeState): string {
  return `${state.head}\n${state.base}\n${state.verdict}`;
}

/**
 * Asks main where view `id`'s pull request sits, unless it was asked, or is being asked, at `at`.
 * What main can't say leaves the panel as for one alone: `⏎` asks again, and says why.
 */
function readPlace(id: string, at: string): void {
  const now = panels.get(id).place;
  if (now.kind !== 'none' && now.at === at) return;
  panels.update(id, (panel) => ({ ...panel, place: { kind: 'reading', at } }));
  const settle = (placement: Placement | undefined) => {
    const current = panels.get(id).place;
    if (current.kind !== 'reading' || current.at !== at) return;
    panels.update(id, (panel) => ({
      ...panel,
      place: placement === undefined ? { kind: 'none' } : { kind: 'read', at, placement },
    }));
  };
  main()
    .place({ id })
    .then(settle)
    .catch((error: unknown) => {
      console.error('Lo couldn’t ask where the pull request sits:', error);
      settle(undefined);
    });
}

/** Closes the panel and asks to make the chain on screen a GitHub stack, as `gS` does. */
function convert(id: string): void {
  closePanel(id);
  registry().run(CONVERT, { kind: 'none' });
}

/** What the panel says of where the pull request sits, when that changes what merging does. */
function placeOf(tab: PullTab, placement: Placement | undefined): ReactNode {
  switch (placement?.kind) {
    case undefined:
    case 'alone':
      return undefined;
    case 'stack':
      return (
        <p key="place" className="m-0 pb-8 text-fg-muted text-small">
          {numbers(placement.below)}, below it in GitHub stack #{placement.stack}, merge with it.
          GitHub merges them together.
        </p>
      );
    case 'convert': {
      const keys = keyOf(CONVERT);
      return (
        <div key="place" className="pb-8">
          <Callout tone="info">
            <p className="m-0">{withoutBidi(placement.offer)}</p>
            <div className="mt-8">
              <Button size="sm" onClick={() => convert(tab.id)}>
                Make this a GitHub stack
                {keys && <Key keys={keys} decorative />}
              </Button>
            </div>
          </Callout>
        </div>
      );
    }
    case 'chain':
      return (
        <div key="place" className="pb-8 text-fg-muted text-small">
          <p className="m-0">
            #{tab.number} merges into {withoutBidi(placement.into)} alone. Then Lo moves{' '}
            {numbers(placement.above)} onto {withoutBidi(placement.into)}, while Lo is open. These
            PRs can’t be a GitHub stack:
          </p>
          <ul className="m-0 ps-16">
            {placement.reasons.map((reason) => (
              <li key={reason}>{withoutBidi(reason)}</li>
            ))}
          </ul>
        </div>
      );
    case 'refused':
      return (
        <div key="place" className="pb-8">
          <Callout tone="warning" role="status">
            {withoutBidi(placement.why)}
          </Callout>
        </div>
      );
    default:
      placement satisfies never;
      return undefined;
  }
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
  const place = placeOf(tab, placementOf(tab.id));
  if (place !== undefined && (action.kind === 'merge' || action.kind === 'enqueue')) {
    parts.push(place);
  }
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
  // Why merging is off now, whatever GitHub says.
  if (state.off !== null && (action.kind === 'merge' || action.kind === 'enqueue')) {
    parts.push(
      <p key="off" role="status" className="m-0 pb-8 text-fg-muted text-small">
        {offWords(state.off)}
      </p>,
    );
  }
  return parts.length > 0 ? parts : undefined;
}

/** The panel's foot: what merging would do, named for it; nothing while it's queued. */
function footOf(state: MergeState, panel: Panel, placement: Placement | undefined): ReactNode {
  const { action } = state;
  if (state.verdict === 'queued') return undefined;
  const method = shownMethod(state, panel.method);
  const enter = ENTER;
  // Where it sits keeps it from merging from here: a chain that becomes a GitHub stack first.
  const placed = placement?.kind === 'convert' || placement?.kind === 'refused';
  const auto =
    state.autoMerge !== null
      ? { on: true, onChange: () => undefined, keys: AUTO }
      : action.kind === 'enqueue'
        ? undefined
        : { on: false, onChange: () => undefined, keys: AUTO };
  // Off, with why, while GitHub can't be reached or asked Lo to hold off writing.
  const off = state.off !== null;
  if (action.kind === 'enqueue') {
    return (
      <MergeFoot
        auto={auto}
        method={action.method === null ? undefined : methodLabel(action.method)}
        primary={{
          label: placedLabel(placement, true, 'Add to merge queue'),
          keys: enter,
          disabled: off || placed,
          onClick: mergeFromPanel,
        }}
      />
    );
  }
  if (action.kind === 'merge') {
    return (
      <MergeFoot
        auto={auto}
        primary={{
          label: placedLabel(placement, false, mergeLabel(method ?? action.method)),
          keys: enter,
          disabled: off || placed,
          onClick: mergeFromPanel,
        }}
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
  // Where it sits, asked as the panel opens on one that can merge, and again when it moves.
  const placing =
    panel.open && known !== undefined && known.verdict !== 'merged' && known.verdict !== 'closed';
  const placeKey = known && placeAt(known);
  useEffect(() => {
    if (placing && placeKey !== undefined) readPlace(tab.id, placeKey);
  }, [placing, placeKey, tab.id]);
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
        // A right-click menu over the panel is part of it: choosing from one closes nothing.
        if (!open && currentMenu() === undefined) closePanel(tab.id);
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
      foot={footOf(state, panel, placementOf(tab.id))}
    >
      {bodyOf(tab, state, panel, rows, { id: list, ref: listRef }, reasonMenu)}
    </MergePanel>
  );
}

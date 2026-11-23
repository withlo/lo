// The header's merge status, a dot and one line, and the merge panel it opens under it, as `m`
// does: the verdict and what it merges into, a row for each reason it can't merge, the methods the
// repository allows, the squash commit's text, and what merging would do: with the layers below it
// in a GitHub stack, or, for a chain that isn't one, after converting it to one, which `gS` does
// from here as from anywhere in the tab, or a layer at a time from its bottom one. Where it sits is
// asked each time the panel opens and as its stack's layers move, and until main first says, the
// main button is busy, "Checking…". It reads the same whatever is in the way, dimmed, with why as
// its tooltip. Before the first read the status says "Checking…", and once a read failed the panel
// says why. For a pull request in a merge queue, or ready to join one, its place there or what's
// ahead, and why it left. Each of the panel's keys has its control there.

import {
  Branch,
  Button,
  Callout,
  Checklist,
  CommitText,
  HintButton,
  Key,
  MergeFoot,
  MergeMethods,
  MergePanel,
  MergeStatus,
  Problem,
  type CheckItem,
  type MergeFootProps,
} from '@lo/ui';
import { controlOf, keyLabels, runControl } from '@lo/ui/commands';
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
import type { InQueue, MergeState, MergeView, Placement } from '../contract.ts';
import {
  closePanel,
  keepTitleField,
  openPage,
  reasonRow,
  seeQueue,
  STATUS_ROW,
  togglePanel,
  whoOf,
} from './actions.ts';
import { withBranch } from './chips.tsx';
import { main } from './main.ts';
import { turningOff } from './merging.ts';
import { panelRows, queueHead } from './places.ts';
import { aheads, catchUpQueue, forgetAhead, queues, readAhead } from './queued.ts';
import { placeKey, readPlace, shapes } from './placing.ts';
import {
  jobOf,
  merging,
  panels,
  placementOf,
  placeUnknown,
  shipping,
  statuses,
  takeStatus,
  type Panel,
} from './store.ts';
import {
  CANT_CHECK,
  cantMerge,
  headerLine,
  methodLabel,
  methodNote,
  numbers,
  panelHead,
  panelLabel,
  placedWhy,
  queueLine,
  shownMethod,
  type HeaderLine,
  type Row,
  type Who,
} from './words.ts';

/** The queue feature's `gq`, which shows the merge queue of the branch on screen. */
const QUEUE = 'queue.show';

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

/**
 * How long the panel waits to ask again where a pull request sits, while listing may settle it: 3 s
 * the first few times, then 10 s, as when merged pull requests are looked up over several lists.
 */
function placeAgain(tries: number): number {
  return tries < 5 ? 3_000 : 10_000;
}

/** How many times the panel asks again, while it's open: for 8 minutes or so. */
const PLACE_TRIES = 50;

/** Closes the panel and asks to convert the chain on screen to a GitHub stack, as `gS` does. */
function convert(id: string): void {
  closePanel(id);
  registry().run(CONVERT, { kind: 'none' });
}

/** What the panel says of where the pull request sits, when that changes what merging does. */
function placeOf(tab: PullTab, state: MergeState, placement: Placement | undefined): ReactNode {
  switch (placement?.kind) {
    case undefined:
    case 'alone':
      return undefined;
    case 'stack':
      return (
        <p key="place" className="m-0 pb-8 text-fg-muted text-small">
          {numbers(placement.below)} {placement.below.length === 1 ? 'merges' : 'merge'} too, below
          it in the GitHub stack.
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
                Convert to GitHub stack…
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
            #{tab.number} merges alone. {numbers(placement.above)} then{' '}
            {placement.above.length === 1 ? 'moves' : 'move'} onto{' '}
            <Branch name={placement.into} base />, while Lo is open.
          </p>
          {placement.reasons.length > 0 && (
            <>
              <p className="m-0 mt-6 text-fg">Can’t convert to GitHub stack</p>
              <ul className="m-0 ps-16">
                {placement.reasons.map((reason) => (
                  <li key={reason}>{withoutBidi(reason)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
    case 'refused':
      // Asked again soon, while the main button is busy.
      if (placement.again) return undefined;
      return (
        <div key="place" className="pb-8">
          <Problem
            title={`Can’t merge #${tab.number}`}
            reason={withoutBidi(placement.why)}
            action={{ label: 'Open on GitHub', onClick: () => openPage(tab.id, state.url) }}
          />
        </div>
      );
    default:
      placement satisfies never;
      return undefined;
  }
}

/** A row of the reasons, as the checklist draws it, its links opening through main. */
function itemOf(id: string, row: Row, base: string): CheckItem {
  const open = (url: string) => () => openPage(id, url);
  return {
    key: row.key,
    kind: row.kind,
    glyph: row.glyph,
    title: row.title,
    // The base branch a reason names is drawn as one: "`e4/gated` requires a code owner's approval."
    detail: typeof row.detail === 'string' ? withBranch(row.detail, base) : row.detail,
    link: row.link && { label: row.link.label, onOpen: open(row.link.url) },
    subs: row.subs.map((sub) => ({
      key: sub.key,
      name: sub.name,
      note: sub.note,
      tone: sub.tone,
      link: sub.link && { label: sub.link.label, onOpen: open(sub.link.url) },
    })),
    // Closes the panel and goes to the next unresolved thread, as `]t` does.
    end: row.nextThread ? (
      <HintButton command="merge.nextThread">Next thread</HintButton>
    ) : undefined,
  };
}

/**
 * Whether the pull request the header stands for has just merged, from a status drawn before, with
 * neither the merge's dialog nor approve and ship's open to end on the mark's kiss: then the
 * header's dot fills instead.
 */
function useLanded(kind: string | undefined): boolean {
  const [seen, setSeen] = useState(kind);
  const [landed, setLanded] = useState(false);
  if (seen !== kind) {
    setSeen(kind);
    setLanded(
      kind === 'merged' &&
        seen !== undefined &&
        merging.getState().dialog === undefined &&
        shipping.getState().dialog === undefined,
    );
  }
  return landed;
}

/** What the main button says until Lo knows where the pull request sits, and so what merges. */
const CHECKING = 'Checking…';

/** Whether the panel shows "Bypass rules and merge…": for an account that may, or dimmed with why. */
function bypasses(state: MergeState): boolean {
  const { override } = state;
  return (
    override.kind === 'override' ||
    (override.kind === 'notPossible' && override.reason === 'stackLayer')
  );
}

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
  const place = placeOf(tab, state, placementOf(tab.id));
  if (place !== undefined && (action.kind === 'merge' || action.kind === 'enqueue')) {
    parts.push(place);
  }
  if (rows.length > 0) {
    parts.push(
      <div key="reasons" className="pb-8" {...menu}>
        <Checklist
          label="Reasons"
          id={list.id}
          rows={rows.map((row) => itemOf(tab.id, row, state.base))}
          focused={panel.focused}
          listRef={list.ref}
        />
        {rows.length > 1 && (
          // The keys that move between the reasons, as buttons: focus stays on the list.
          <div className="flex justify-end gap-6 pt-6">
            <HintButton command="merge.up" />
            <HintButton command="merge.down" />
          </div>
        )}
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
              <div className="mt-6">
                <Problem
                  title="Can’t show GitHub’s commit message"
                  reason={squash.why === '' ? undefined : withoutBidi(squash.why)}
                />
              </div>
            )}
          </div>
        )}
      </div>,
    );
  }
  // The queue's own method, which merges it whatever its auto-merge says, where the method
  // control would stand.
  const queueMethod =
    state.verdict === 'queued'
      ? state.queue.method
      : state.verdict === 'ready' && action.kind === 'enqueue'
        ? action.method
        : undefined;
  if (queueMethod !== undefined) {
    parts.push(
      <p key="queue" className="m-0 pb-8 text-fg-muted text-small">
        {queueLine(queueMethod)}
      </p>,
    );
  }
  if (bypasses(state)) {
    parts.push(
      <div key="override" className="flex justify-end pb-8">
        <HintButton command="merge.override" />
      </div>,
    );
  }
  if (panel.trouble) {
    parts.push(
      <div key="trouble" className="pb-8">
        <Problem
          title={panel.trouble.title}
          reason={panel.trouble.reason}
          details={panel.trouble.details}
        />
      </div>,
    );
  }
  return parts.length > 0 ? parts : undefined;
}

/** The button that shows the branch's merge queue, as `gq` does. */
function SeeQueue({ id }: { id: string }) {
  const control = controlOf(QUEUE);
  const keys = control?.keys ?? keyOf(QUEUE);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={control?.off !== undefined}
      hint={control?.off ?? null}
      onClick={() => seeQueue(id)}
    >
      {control?.label ?? 'Merge queue'}
      {keys && <Key keys={keys} decorative />}
    </Button>
  );
}

/**
 * The auto-merge button: "Turn on auto-merge…", which its dialog confirms, or with it on, "Turn off
 * auto-merge", busy while it's turned off. Dimmed with why when it can't be pressed now.
 */
function autoOf(tab: PullTab, state: MergeState): MergeFootProps['auto'] {
  const on = state.autoMerge !== null;
  // The queue does the waiting.
  if (!on && state.action.kind === 'enqueue') return undefined;
  const control = controlOf('merge.autoMerge');
  return {
    label: on ? 'Turn off auto-merge' : 'Turn on auto-merge…',
    keys: control?.keys,
    reason: control?.off,
    busy: turningOff(tab),
    working: 'Turning off…',
    onClick: () => runControl('merge.autoMerge'),
  };
}

/**
 * The panel's foot: what merging would do, named for the pull request, with the queue it would
 * join, and the auto-merge button; while it's queued, only the queue. The main button reads the
 * same whatever is in the way, dimmed, with why as its tooltip, but when the reasons above say it.
 */
function footOf(
  tab: PullTab,
  state: MergeState,
  panel: Panel,
  placement: Placement | undefined,
  who: Who,
): ReactNode {
  const { action } = state;
  if (state.verdict === 'queued') return <SeeQueue id={tab.id} />;
  const method = shownMethod(state, panel.method);
  const keys = controlOf('merge.merge')?.keys;
  const blocked = action.kind === 'notPossible' && action.reason === 'blocked';
  const why = cantMerge(state, tab.number, who) ?? placedWhy(placement);
  // Until Lo knows where it sits, it can't say what merges with it: a GitHub stack's layers below.
  const busy = placeUnknown(panel.place) || (placement?.kind === 'refused' && placement.again);
  const auto = autoOf(tab, state);
  const queued =
    action.kind === 'enqueue' || (action.kind === 'notPossible' && state.queue.required);
  const primary = {
    label: panelLabel(placement, queued, tab.number),
    keys,
    // The reasons above say why it's blocked; else its tooltip does.
    disabled: why !== undefined,
    reason: blocked || why === undefined ? undefined : withoutBidi(why),
    busy: action.kind === 'notPossible' ? false : busy,
    working: CHECKING,
    quiet: action.kind === 'notPossible' && state.autoMerge !== null,
    onClick: () => runControl('merge.merge'),
  };
  if (action.kind === 'enqueue') {
    return (
      <MergeFoot
        auto={auto}
        start={<SeeQueue id={tab.id} />}
        method={action.method === null ? undefined : methodLabel(action.method)}
        primary={primary}
      />
    );
  }
  // With auto-merge on, the head says the method it merges with, and the foot names no other.
  const named = action.kind === 'merge' || state.autoMerge !== null ? undefined : method;
  return (
    <MergeFoot
      auto={auto}
      method={named === undefined ? undefined : methodLabel(named)}
      primary={primary}
    />
  );
}

/**
 * The header's line for `view`, but merged or closed as soon as the pull request is, by its header
 * or the merge Lo sent, before its merge status is read again.
 */
function lineOf(
  view: MergeView | undefined,
  queue: InQueue | undefined,
  ended: 'merged' | 'closed' | undefined,
): HeaderLine | undefined {
  const line = headerLine(view, queue);
  if (!line || ended === undefined) return line;
  return {
    kind: ended,
    verdict: ended === 'merged' ? 'Merged' : 'Closed',
    detail: undefined,
    opens: false,
  };
}

/** The merge status in a pull request's header, and the merge panel under it. */
export function MergeHeader({ tab }: { tab: PullTab }) {
  useKeys();
  const view = useStore(statuses, (state) => state.views.get(tab.id));
  const queue = useStore(queues, (state) => state.views.get(tab.id));
  // Read for its changes: a merge Lo sent, which may have merged it, and auto-merge turning off.
  useStore(merging);
  const panel = useTabState(panels, tab.id);
  const pull = usePull(tab.id);
  const title = pull?.header?.title;
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
  const joining = panel.open && known?.verdict === 'ready' && known.action.kind === 'enqueue';
  useEffect(() => {
    if (!statuses.getState().views.has(tab.id)) catchUp(tab.id);
    if (!queues.getState().views.has(tab.id)) catchUpQueue(tab.id);
    // The panel closes as its tab leaves the screen.
    return () => closePanel(tab.id);
  }, [tab.id]);
  // What's ahead in the queue it would join, read once as the panel opens on it.
  useEffect(() => {
    if (joining) readAhead(tab.id);
    else forgetAhead(tab.id);
  }, [joining, tab.id]);
  // Read as the panel opens on a squash, and again when the head or the title moves.
  useEffect(() => {
    if (squashing && at !== undefined) readSquash(tab.id, at);
  }, [squashing, at, tab.id]);
  // Where it sits, asked each time the panel opens on one that can merge, and again when it moves
  // or its stack's layers do.
  const placing =
    panel.open && known !== undefined && known.verdict !== 'merged' && known.verdict !== 'closed';
  const shape = useTabState(shapes, tab.id);
  const asked = known && placeKey(known, panel.round, shape);
  // Asked again a while later, while Lo lists the open pull requests again, which may settle it.
  const [tries, setTries] = useState(0);
  const unsettled =
    panel.place.kind === 'read' &&
    panel.place.placement.kind === 'refused' &&
    panel.place.placement.again;
  useEffect(() => {
    if (!placing) {
      setTries(0);
      return undefined;
    }
    if (!unsettled || tries >= PLACE_TRIES) return undefined;
    const timer = setTimeout(() => {
      setTries((count) => count + 1);
      panels.update(tab.id, (current) => ({ ...current, round: current.round + 1 }));
    }, placeAgain(tries));
    return () => clearTimeout(timer);
  }, [placing, unsettled, tries, tab.id]);
  useEffect(() => {
    if (placing && asked !== undefined) void readPlace(tab.id, asked);
  }, [placing, asked, tab.id]);
  const state = pull?.header?.state;
  const ended =
    state === 'merged' || jobOf(tab)?.state.kind === 'merged'
      ? 'merged'
      : state === 'closed'
        ? 'closed'
        : undefined;
  const line = lineOf(view, queue, ended);
  const landed = useLanded(line?.kind);
  if (!line) return null;
  const keys = keyOf('merge.panel');
  const who = whoOf(tab);
  return (
    <>
      <span className="contents" {...(line.opens ? statusMenu : {})}>
        <MergeStatus
          kind={line.kind}
          verdict={line.verdict}
          detail={line.detail}
          keys={keys}
          onClick={line.opens ? () => togglePanel(tab.id, tab.number) : undefined}
          expanded={line.opens ? panel.open : undefined}
          ref={setButton}
          landed={landed}
        />
      </span>
      {known && line.opens && (
        <PanelUnder
          tab={tab}
          state={known}
          queue={queue}
          panel={panel}
          anchor={button}
          listRef={listRef}
          now={now}
          who={who}
        />
      )}
      {!known && line.opens && view && (
        <StatusPanel tab={tab} view={view} open={panel.open} anchor={button} />
      )}
    </>
  );
}

/** The merge panel before Lo has read a status, or once a read failed: what's going on, alone. */
function StatusPanel({
  tab,
  view,
  open,
  anchor,
}: {
  tab: PullTab;
  view: MergeView;
  open: boolean;
  anchor: HTMLButtonElement | null;
}) {
  const failed = view.kind === 'failed';
  return (
    <MergePanel
      open={open}
      onOpenChange={(next) => {
        if (!next && currentMenu() === undefined) closePanel(tab.id);
      }}
      anchor={anchor}
      container={document.getElementById('root')}
      scope="merge"
      kind="waiting"
      verdict={failed ? CANT_CHECK : 'Checking…'}
      closeKeys={keyOf('merge.close')}
    >
      {failed && (
        <div className="pb-8">
          <Problem
            title={CANT_CHECK}
            reason={view.why === '' ? undefined : withoutBidi(view.why)}
            details={view.details}
          />
        </div>
      )}
    </MergePanel>
  );
}

/** The merge panel, under the header's status. */
function PanelUnder({
  tab,
  state,
  queue,
  panel,
  anchor,
  listRef,
  now,
  who,
}: {
  tab: PullTab;
  state: MergeState;
  queue: InQueue | undefined;
  panel: Panel;
  anchor: HTMLButtonElement | null;
  listRef: RefObject<HTMLUListElement | null>;
  now: number;
  who: Who;
}) {
  const list = `merge-${useId()}`;
  const ahead = useTabState(aheads, tab.id);
  const head = queueHead(panelHead(state, who), state, queue, ahead);
  const rows = panelRows(state, queue, now, who);
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
          {/* The spaces between the parts are read, not drawn: the line's gap spaces them. */}
          {head.before !== undefined && <span className="flex-none">{head.before}</span>}
          {head.before !== undefined && ' '}
          {head.branch !== undefined && <Branch name={head.branch} base />}
          {head.branch !== undefined && ' '}
          {head.after !== undefined && (
            <span className="min-w-0 truncate">{withoutBidi(head.after)}</span>
          )}
        </>
      }
      closeKeys={keyOf('merge.close')}
      focusRef={rows.length > 0 ? listRef : undefined}
      foot={footOf(tab, state, panel, placementOf(tab.id), who)}
    >
      {bodyOf(tab, state, panel, rows, { id: list, ref: listRef }, reasonMenu)}
    </MergePanel>
  );
}

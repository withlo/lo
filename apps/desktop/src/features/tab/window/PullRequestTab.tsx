// A pull request's tab: its header, its banner, a row of the left panel, one middle sheet or two,
// with what goes across the top of the code, and the right panel other features fill, each panel
// with its edge and its button at an end of the header's cluster, as the window's layout draws
// them, and its status bar, which ends with the keys held for a command still to come, and Vim's
// mode while code has focus. With the code beside, the middle is a reading view on the left and
// the code on the right, each a sheet. It opens on the middle view Settings names, once Settings is
// known. Until the diff and the threads arrive, the middle says what's coming, and a pull request
// the tab can't show says why there.

import { Panes, PRHeader, StatusBar, StatusKeys, StatusMode, Swap, type ViewFocus } from '@lo/ui';
import { focusedMode, onFocusedMode } from '@lo/ui/code';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { Slot, useViews } from '../../../window/slots.tsx';
import { useKnownSetting } from '../../settings/window/shared.ts';
import { before, open as openOn } from '../settings.ts';
import { blocked } from './banners.ts';
import { Banners, LimitItem, LocalItem, TabFailed, useHeaderConnection } from './Notes.tsx';
import {
  focusNowhere,
  header,
  headerStatus,
  left,
  middle,
  over,
  right,
  setViewsShown,
  status,
  useLocalCopy,
  usePull,
  type PullTab,
} from './shared.ts';
import {
  focusPanel,
  kindOf,
  middleIds,
  opening,
  panels,
  rightIds,
  takeRightFocus,
  useTabPanels,
  viewsOf,
} from './panels.ts';
import { layout, row, useBesideDrawn, usePanelDrawn, viewCounts, viewFocus } from './layout.ts';
import { MiddleViewOf, Placeholder, useAllWaiting } from './Placeholder.tsx';
import { LeftPanel, RightPanel, ViewsRow, type Sheet } from './Row.tsx';
import { BesideToggle, LeftToggle, RightToggle } from './Toggles.tsx';
import { ViewSwitch } from './ViewSwitch.tsx';

/**
 * Gives the right panel focus as it's drawn, once after it opens: its scope's element, so its keys
 * work at once.
 */
function focusRight(panel: HTMLElement | null): void {
  if (!panel || !takeRightFocus()) return;
  focusPanel(panel);
}

/** Keeps the row's width, as it's measured, for the panels to fit in. */
const setRowWidth = (width: number) => row.setState({ width });

/** Which sheet a middle view is drawn in: code on the right, anything else on the left. */
function sheetOf(id: string): Sheet {
  return kindOf(id) === 'code' ? 'code' : 'reading';
}

/**
 * Moves focus that was in a middle view as it's hidden to the window's middle, where it's nowhere
 * in particular, before the browser drops it: so keys typed meanwhile go on in the view that comes,
 * as it takes focus, rather than being dropped with it.
 */
function catchHidden(views: HTMLElement | null): void {
  const focused = document.activeElement;
  const hidden = focused?.closest('[inert]');
  if (views && hidden && views.contains(hidden)) focusNowhere();
}

const onHeldKeys = (listener: () => void) => registry().onHeldKeys(listener);
const heldKeys = () => registry().heldKeys();

/**
 * The keys held for a command still to come, and Vim's mode in the code view that has focus,
 * while one has, as the status bar's end shows them.
 */
function FocusedMode() {
  const held = useSyncExternalStore(onHeldKeys, heldKeys);
  const mode = useSyncExternalStore(onFocusedMode, focusedMode);
  return (
    <>
      {held !== '' && <StatusKeys keys={held} />}
      {mode !== undefined && <StatusMode name={mode} />}
    </>
  );
}

/** A pull request's tab, as its kind draws it. */
export function PullRequestTab({ tab }: { tab: PullTab }) {
  const view = usePull(tab.id);
  const local = useLocalCopy(tab.id);
  const connection = useHeaderConnection(tab, view);
  // A pull request the tab can't show takes the middle's place, with why, over what's drawn.
  const failed = blocked(view);
  const kept = useTabPanels(tab.id);
  const { right: rightChosen, middle: chosen, opened } = kept;
  const lefts = useViews(left);
  const middles = useViews(middle);
  const rights = useViews(right);
  const readings = middles.filter((each) => each.kind === 'reading').length;
  const codes = middles.filter((each) => each.kind === 'code').length;
  const there = {
    left: lefts.length > 0,
    threads: rights.length > 0,
    beside: readings > 0 && codes > 0,
  };
  const saved = useKnownSetting(openOn);
  // A `diff` saved under the key `tab.open` replaced, until main has carried it over.
  const earlier = useKnownSetting(before);
  const open = saved === openOn.fallback && earlier === 'diff' ? 'diff' : saved;
  viewCounts.left = lefts.length;
  viewCounts.middle = middles.length;
  viewCounts.right = rights.length;
  viewCounts.reading = readings;
  viewCounts.code = codes;
  if (middleIds.ids.join('\n') !== middles.map((each) => each.id).join('\n')) {
    middleIds.ids = middles.map((each) => each.id);
    middleIds.labeled = middles.map((each) => each.label !== undefined);
    middleIds.kinds = middles.map((each) => each.kind);
    middleIds.empty = middles.map((each) => each.empty);
  }
  if (rightIds.length !== rights.length)
    rightIds.splice(0, Infinity, ...rights.map((each) => each.id));
  const heading = view?.header;
  const acting = view?.acting;
  // As the window's layout has them, less what the row has no room for.
  const showLeft = usePanelDrawn('left', there);
  const showRight = usePanelDrawn('threads', there);
  // One of its views at a time: the one shown last, or the first, the threads.
  const shownRight = rights.find((each) => each.id === rightChosen) ?? rights[0];
  const threadsShown = showRight && shownRight !== undefined;
  // The view Settings names, once it's known, until the tab has one of its own; then that, or the
  // timeline while it's gone. With the code beside, a reading view and the code, the one Settings
  // names, or the tab showed alone, with focus.
  const beside = useStore(layout, (window) => window.beside) && there.beside;
  const want = viewsOf(tab.id, kept, open, beside);
  const single = want.beside ? (want.focus === 'code' ? want.code : want.reading) : want.single;
  const shownId = single;
  if (chosen === undefined && shownId !== undefined) opening.set(tab.id, shownId);
  const focus: ViewFocus = want.beside ? want.focus : sheetOf(shownId ?? '');
  viewFocus.now = focus;
  // Two views as there's room for them, but one across the middle while both only wait.
  const roomForTwo = useBesideDrawn(there, focus);
  const bothWait = useAllWaiting(tab.id, want.beside ? [want.reading, want.code] : []);
  const two = want.beside && roomForTwo && !bothWait;
  const onScreen = two ? [want.reading, want.code] : shownId === undefined ? [] : [shownId];
  // What it opened on, kept, so a change in Settings moves no tab that's open.
  useLayoutEffect(() => {
    if (opened !== undefined || shownId === undefined) return;
    opening.delete(tab.id);
    panels.update(tab.id, (current) => ({
      ...current,
      middle: current.middle ?? shownId,
      opened: shownId,
    }));
  }, [tab.id, opened, shownId]);
  const shownMiddle = middles.find((each) => each.id === shownId);
  // The middle views shown since the tab was drawn stay drawn, hidden while another is on screen.
  const [drawnViews, setDrawnViews] = useState<readonly string[]>([]);
  const fresh = onScreen.filter((id) => !drawnViews.includes(id));
  if (fresh.length > 0) setDrawnViews([...drawnViews, ...fresh]);
  useLayoutEffect(() => setViewsShown(tab.id, onScreen));
  // Focus left in a view as it's hidden goes where keys typed meanwhile go on.
  const views = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => catchHidden(views.current));
  // Focus coming into one of two views makes it the one with focus, which stays as the code goes.
  const onViewFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const id = event.target.closest('[data-lo-middle-view]')?.getAttribute('data-lo-middle-view');
      if (!two || !id || panels.get(tab.id).middle === id) return;
      panels.update(tab.id, (current) => ({ ...current, middle: id }));
    },
    [tab.id, two],
  );
  const sheetViews = (sheet: Sheet): ReactNode => {
    const here = onScreen.find((id) => sheetOf(id) === sheet);
    const drawnHere = middles.filter(
      (each) => sheetOf(each.id) === sheet && (each.id === here || drawnViews.includes(each.id)),
    );
    // One shown in another's place fades in over it, a Swap that keeps them all drawn; the first
    // the sheet shows is just there.
    return (
      <Swap id={here} keep className="absolute inset-0">
        {drawnHere.map((each) => {
          const shown = each.id === here;
          const seen = shown && !failed;
          return (
            <div
              key={each.id}
              className={
                seen ? 'absolute inset-0 middle-view' : 'invisible absolute inset-0 middle-view'
              }
              inert={!seen}
              data-lo-middle-view={each.id}
            >
              <MiddleViewOf value={each.id}>
                <each.render tab={tab} shown={shown} />
              </MiddleViewOf>
            </div>
          );
        })}
      </Swap>
    );
  };
  const readingLabel = middles.find((each) => each.id === onScreen[0])?.label ?? 'Pull request';
  return (
    <div className="flex h-full min-h-0 flex-col" data-lo-pull={tab.id}>
      <PRHeader
        number={tab.number}
        title={heading?.title ?? tab.title}
        missing={failed ? { repo: `${tab.owner}/${tab.repo}` } : undefined}
        state={heading?.state ?? tab.state}
        author={heading?.author}
        head={heading?.head}
        base={heading?.base}
        acting={
          acting === undefined || acting === null
            ? undefined
            : acting.kind === 'anonymous'
              ? 'anonymous'
              : { login: acting.login }
        }
        connection={connection}
        // A pull request the tab can't show has no merge status, review or revisions to offer, and
        // nothing for its views and panels to show: their controls stay, dimmed and inert.
        status={failed ? undefined : <Slot slot={headerStatus} props={{ tab }} />}
      >
        {!failed && <Slot slot={header} props={{ tab }} />}
        <span className="min-w-8 flex-1" />
        <div
          className={`flex flex-none items-center gap-12 ${failed ? 'controls-off' : ''}`}
          inert={failed}
        >
          {there.left && <LeftToggle there={there} />}
          <ViewSwitch tab={tab} views={middles} shown={shownMiddle?.id} onScreen={onScreen} />
          {there.beside && <BesideToggle there={there} />}
          {there.threads && <RightToggle tab={tab} there={there} views={rights} />}
        </div>
      </PRHeader>
      <Banners tab={tab} view={view} />
      <Panes className="min-h-0 flex-1" onWidth={setRowWidth}>
        {showLeft && (
          <LeftPanel there={there} failed={failed}>
            <Slot slot={left} props={{ tab }} />
          </LeftPanel>
        )}
        <div ref={views} className="flex min-h-0 min-w-0 flex-1">
          <ViewsRow
            there={there}
            focus={focus}
            drawn={two ? 'both' : sheetOf(shownId ?? '')}
            failed={failed}
            reading={shownMiddle ? sheetViews('reading') : <Placeholder tab={tab.id} />}
            code={sheetViews('code')}
            over={<Slot slot={over} props={{ tab }} />}
            labels={{ reading: readingLabel, code: 'Code beside' }}
            onFocus={onViewFocus}
          >
            {/* A pull request the tab can't show says why over the whole middle, and stays still
            as the views change under it. */}
            <TabFailed tab={tab} view={view} />
          </ViewsRow>
        </div>
        {threadsShown && (
          <RightPanel
            // Another view is another panel, which takes focus as it's drawn.
            key={shownRight.id}
            ref={focusRight}
            there={there}
            failed={failed}
            label={shownRight.label}
            view={shownRight.id}
          >
            <shownRight.render tab={tab} />
          </RightPanel>
        )}
      </Panes>
      <StatusBar
        start={
          <>
            <LocalItem tab={tab} local={local} view={view} />
            <Slot slot={status} props={{ tab }} />
            {/* Last, as it comes and goes, so the items that stay keep their places. */}
            <LimitItem connection={view?.connection} />
          </>
        }
        end={<FocusedMode />}
      />
    </div>
  );
}

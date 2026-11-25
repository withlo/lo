// A pull request's tab: its header, its banner, the left panel, the middle sheet, with what goes
// across its top, and the right panel other features fill, with the header's toggle for it, and its
// status bar, which ends with the keys held for a command still to come, and Vim's mode while code
// has focus. It opens on the middle view Settings names, once Settings is known. Until the diff and
// the threads arrive, the middle says what's coming, and a pull request the tab can't show says why
// there.

import { PRHeader, StatusBar, StatusKeys, StatusMode, Swap } from '@lo/ui';
import { focusedMode, onFocusedMode } from '@lo/ui/code';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { Slot, useViews } from '../../../window/slots.tsx';
import { useKnownSetting } from '../../settings/window/shared.ts';
import { before, open as openOn } from '../settings.ts';
import { blocked } from './banners.ts';
import { Banners, LimitItem, LocalItem, TabFailed, useHeaderConnection } from './Notes.tsx';
import {
  header,
  headerStatus,
  left,
  middle,
  over,
  right,
  status,
  useLocalCopy,
  usePull,
  type PullTab,
} from './shared.ts';
import {
  focusPanel,
  middleIds,
  middleOf,
  opening,
  panels,
  rightIds,
  takeRightFocus,
  useRightOpen,
  useTabPanels,
  viewCounts,
} from './panels.ts';
import { Placeholder } from './Placeholder.tsx';
import { RightToggle } from './RightToggle.tsx';
import { ViewSwitch } from './ViewSwitch.tsx';

/**
 * Gives the right panel focus as it's drawn, once after it opens: its scope's element, so its keys
 * work at once.
 */
function focusRight(panel: HTMLElement | null): void {
  if (!panel || !takeRightFocus()) return;
  focusPanel(panel);
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
  const { leftOpen, right: rightChosen, middle: chosen, opened } = useTabPanels(tab.id);
  const lefts = useViews(left);
  const middles = useViews(middle);
  const rights = useViews(right);
  const rightOpen = useRightOpen();
  const saved = useKnownSetting(openOn);
  // A `diff` saved under the key `tab.open` replaced, until main has carried it over.
  const earlier = useKnownSetting(before);
  const open = saved === openOn.fallback && earlier === 'diff' ? 'diff' : saved;
  viewCounts.left = lefts.length;
  viewCounts.middle = middles.length;
  viewCounts.right = rights.length;
  if (middleIds.ids.join('\n') !== middles.map((each) => each.id).join('\n')) {
    middleIds.ids = middles.map((each) => each.id);
    middleIds.labeled = middles.map((each) => each.label !== undefined);
  }
  if (rightIds.length !== rights.length)
    rightIds.splice(0, Infinity, ...rights.map((each) => each.id));
  const heading = view?.header;
  const acting = view?.acting;
  const showLeft = leftOpen && lefts.length > 0;
  // Only as the reader opens or closes it, so the middle's width changes by their asking alone.
  const showRight = rightOpen && rights.length > 0;
  // One of its views at a time: the one shown last, or the first, the threads.
  const shownRight = rights.find((each) => each.id === rightChosen) ?? rights[0];
  // The view Settings names, once it's known, until the tab has one of its own; then that, or the
  // timeline while it's gone.
  const shownId = middleOf(chosen, middleIds.ids, open);
  if (chosen === undefined && shownId !== undefined) opening.set(tab.id, shownId);
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
  const [kept, setKept] = useState<readonly string[]>([]);
  if (shownMiddle && !kept.includes(shownMiddle.id)) setKept([...kept, shownMiddle.id]);
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
          <ViewSwitch tab={tab} views={middles} shown={shownMiddle?.id} />
          {rights.length > 0 && <RightToggle tab={tab} views={rights} />}
        </div>
      </PRHeader>
      <Banners tab={tab} view={view} />
      <div className="flex min-h-0 flex-1">
        {showLeft && (
          <aside
            className={`flex w-panel-left-w min-w-0 flex-none flex-col bg-bg-chrome ${failed ? 'controls-off' : ''}`}
            aria-label="Files"
            inert={failed}
          >
            <Slot slot={left} props={{ tab }} />
          </aside>
        )}
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sheet"
          aria-label="Pull request"
        >
          <Slot slot={over} props={{ tab }} />
          <div className="relative min-h-0 flex-1">
            {/* One shown in another's place fades in over it, a Swap that keeps them all drawn; the
            first the tab shows is just there. A pull request the tab can't show says why over
            them, and stays still as they change under it. */}
            <Swap id={shownMiddle?.id} keep className="absolute inset-0">
              {shownMiddle ? (
                middles
                  .filter((each) => each === shownMiddle || kept.includes(each.id))
                  .map((each) => {
                    const shown = each === shownMiddle;
                    const seen = shown && !failed;
                    return (
                      <div
                        key={each.id}
                        className={seen ? 'absolute inset-0' : 'invisible absolute inset-0'}
                        inert={!seen}
                        data-lo-middle-view={each.id}
                      >
                        <each.render tab={tab} shown={shown} />
                      </div>
                    );
                  })
              ) : (
                <Placeholder tab={tab.id} />
              )}
            </Swap>
            <TabFailed tab={tab} view={view} />
          </div>
        </section>
        {showRight && shownRight && (
          <aside
            // Another view is another panel, which takes focus as it's drawn.
            key={shownRight.id}
            ref={focusRight}
            className="flex w-panel-right-w min-w-0 flex-none flex-col bg-bg-chrome"
            aria-label={shownRight.label}
            data-lo-right={shownRight.id}
          >
            <shownRight.render tab={tab} />
          </aside>
        )}
      </div>
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

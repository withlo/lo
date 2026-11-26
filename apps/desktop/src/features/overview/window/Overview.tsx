// The overview, the first of a pull request's tab's middle views. A tab that opens on it, as
// Settings says, draws the tab's placeholder until it knows whether the overview shows, for
// `holdLimit()` at most, then stays, or hands the middle to the timeline before either has drawn
// anything. After that it shows the overview, or why there's none to show; one that comes later is
// offered, never switched to. A tab that opened on another view shows it as it is whenever the
// reader comes to it. A run of a stack's layers on screen as one diff has none, which it says.
// While it's on screen the overview's keys act on it (`follow.ts`), and with code beside, the diff
// follows the block focus lands on to its code.

import { NO_TARGET, setScopeSource } from '@lo/ui/commands';
import { generationOf } from '@lo/ui/markdown';
import { blockNumber, blockOf as blockAround, cardsOpen, closeCards } from '@lo/ui/overview';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { focusMiddle, registry, setMiddle } from '../../../window/commands/registry.ts';
import { afterHold } from '../../revisions/window/shared.ts';
import {
  besideNow,
  MiddlePlaceholder,
  openedOn,
  showInstead,
  useTabState,
  type PullTab,
} from '../../tab/window/shared.ts';
import { onStep, stepsChanged } from './blocks.ts';
import { knownOf, type Known, type Standing } from './facts.ts';
import {
  drawnIn,
  focusedBlock,
  followBlock,
  hereIn,
  loadedNewer,
  placesFor,
  setDrawn,
  takeReveal,
  targetOf,
  trees,
  type DrawnOverview,
} from './follow.ts';
import { useStanding } from './hooks.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import { openingOf, openings, type Opening } from './opening.ts';
import { Shown } from './Shown.tsx';
import { CantShow, NoneInRun, NoOverview, ReadFailed } from './States.tsx';

/**
 * What tab `tab` stays on, where it opened on the overview, chosen once: until then, `waiting`,
 * which wakes at the bound. Once chosen, the timeline is shown if that's the choice and this view
 * is on screen, as it is when the tab opens, unless the reader picked a view while it waited: where
 * they are wins. A tab that opened on another view, as Settings said, is on the overview at once,
 * with the bound long passed.
 */
export function useOpening(tab: string, known: Known, shown: boolean): Opening {
  const here = openedOn(tab) === OVERVIEW_VIEW;
  const opened = useTabState(openings, tab);
  const [now, setNow] = useState(Date.now);
  const since = opened.since ?? (here ? now : 0);
  const decided = here ? (opened.on ?? openingOf(known, now - since)) : 'overview';

  // The overview leaves the screen while the tab waits only when the reader shows another view.
  useLayoutEffect(() => {
    const current = openings.get(tab);
    if (here && !shown && current.on === undefined && !current.chose) {
      openings.set(tab, { ...current, chose: true });
    }
  }, [tab, here, shown]);

  useLayoutEffect(() => {
    const current = openings.get(tab);
    if (current.on !== undefined) return;
    if (decided === 'waiting') {
      if (current.since === undefined) openings.set(tab, { ...current, since });
      return;
    }
    openings.set(tab, { ...current, since: current.since ?? since, on: decided });
    if (here && decided === 'timeline' && shown && !current.chose) showInstead(tab);
  }, [tab, here, decided, since, shown]);

  // The bound: past it, the tab goes to the timeline, whatever is still to come.
  useEffect(() => {
    if (decided !== 'waiting') return undefined;
    return afterHold(since, () => setNow(Date.now()));
  }, [decided, since]);

  return decided;
}

/** What the view shows, once the tab has opened, for what the overview is. */
function Body({
  tab,
  standing,
  scroller,
  onScreen,
  focused,
}: {
  tab: PullTab;
  standing: Standing;
  scroller: (element: HTMLDivElement | null) => void;
  onScreen: boolean;
  /** The block that has focus, by its number. */
  focused: number | undefined;
}) {
  switch (standing.kind) {
    case 'reading':
      return <MiddlePlaceholder tab={tab} status="Fetching overview…" />;
    case 'checking':
      return <MiddlePlaceholder tab={tab} status="Checking overview…" />;
    case 'none':
      return <NoOverview tab={tab} standing={standing} onScreen={onScreen} />;
    case 'failed':
      return <ReadFailed tab={tab} problem={standing.problem} />;
    case 'unchecked':
    case 'invalid':
    case 'tooLarge':
    case 'newer':
      return <CantShow tab={tab} standing={standing} onScreen={onScreen} />;
    case 'shown':
      return (
        <Shown
          tab={tab}
          standing={standing}
          scroller={scroller}
          onScreen={onScreen}
          focused={focused}
        />
      );
    default:
      standing satisfies never;
      return null;
  }
}

/**
 * Whether focus is nowhere in particular, on the view itself, or left behind in a middle view now
 * hidden, so the overview can take it as it comes on screen.
 */
function focusIsFree(own: HTMLElement): boolean {
  const focused = document.activeElement;
  return (
    !focused ||
    focused === document.body ||
    own.contains(focused) ||
    focused.hasAttribute('data-lo-middle') ||
    focused.closest('[inert]') !== null
  );
}

/**
 * A pull request's tab's overview, in its middle; or, for a run of a stack's layers, that it has
 * none.
 */
export function OverviewView({ tab, shown }: { tab: PullTab; shown: boolean }) {
  return tab.run ? <InRun tab={tab} shown={shown} /> : <Overview tab={tab} shown={shown} />;
}

/** The view in a run of layers: no overview, and the way to the diff. */
function InRun({ tab, shown }: { tab: PullTab; shown: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  // While it's on screen, it's the middle view `Esc` gives focus back to.
  useEffect(() => {
    if (!shown) return undefined;
    const take = () => root.current?.focus({ preventScroll: true });
    take();
    return setMiddle({
      focus: take,
      root: () => root.current,
      holds: (element) => element === root.current,
      here: () => undefined,
    });
  }, [shown]);
  return (
    <div ref={root} className="h-full outline-none" tabIndex={-1} data-lo-overview="run">
      <NoneInRun tab={tab} />
    </div>
  );
}

/** A pull request's tab's overview, in its middle. */
function Overview({ tab, shown }: { tab: PullTab; shown: boolean }) {
  const standing = useStanding(tab.id);
  const known = knownOf(standing);
  const opening = useOpening(tab.id, known, shown);
  const root = useRef<HTMLDivElement>(null);
  /** The overview's scrolling article, while one shows: what takes focus. */
  const article = useRef<HTMLDivElement | null>(null);
  const scroller = useCallback((element: HTMLDivElement | null) => {
    article.current = element;
    if (element) element.tabIndex = -1;
  }, []);
  const tree = standing.kind === 'shown' ? standing.parsed.tree : undefined;
  const generation = tree && generationOf(tree);
  // A walkthrough's step changing changes the code it points at.
  useSyncExternalStore(onStep, stepsChanged);

  // The block with focus, for its ring.
  const [focused, setFocused] = useState<number | undefined>(undefined);

  // The tab's places in the overview, for `⌃o` and `⌃i`.
  useEffect(() => placesFor(tab.id), [tab.id]);

  // Seen on screen as it shows, it's no longer offered.
  useEffect(() => {
    if (shown && known === 'shown' && !openings.get(tab.id).seen) {
      openings.update(tab.id, (current) => ({ ...current, seen: true }));
    }
  }, [tab.id, shown, known]);

  // While it's on screen, the middle view, which `Esc` gives focus back to, after closing a term's
  // card; and where the tab is in it, for history. While the tab still chooses what to open on, it's
  // the overview's place too, so a file opened from the tree has a way back.
  const waiting = opening === 'waiting';
  useEffect(() => {
    if (!shown) {
      // Hidden, it gives focus it had to the middle view now, as `Esc` gives it back, or to the
      // middle of the window while there's none. As it hands the tab to the timeline there's none,
      // since this runs before the view shown in its place takes the middle: focus is nowhere in
      // particular, for that view to take as it draws. Left on a hidden view, focus stays there
      // until the browser drops it, and that drops the keys typed meanwhile. Focus elsewhere, as in
      // the stack's tree, stays where it is.
      if (root.current?.contains(document.activeElement)) focusMiddle();
      return undefined;
    }
    const take = () => (article.current ?? root.current)?.focus({ preventScroll: true });
    // A block history brought back has focus already.
    const own = root.current;
    const active = document.activeElement;
    const placed = active !== own && active !== article.current && own?.contains(active);
    if (own && !placed && focusIsFree(own)) take();
    return setMiddle({
      focus: take,
      root: () => root.current,
      holds: (element) => element === (article.current ?? root.current),
      // The block the reader is at, or with none, the overview itself: a file opened from here
      // still has a way back.
      here: () => {
        const now = drawnIn(tab.id);
        return (now && hereIn(now)) ?? { view: 'overview', at: NO_TARGET };
      },
      escape: () => (cardsOpen() ? closeCards : undefined),
    });
  }, [tab.id, shown, waiting]);

  // While it's on screen and shows an overview, the keys act on it, and a block history asked
  // for meanwhile is shown.
  useLayoutEffect(() => {
    const element = root.current;
    if (!shown || waiting || !tree || generation === undefined || !element) return undefined;
    trees.set(tab.id, generation);
    // The places in blocks this overview doesn't have are gone from the tab's history.
    registry().history.dropGone(tab.id);
    const drawn: DrawnOverview = {
      tab: tab.id,
      tree,
      generation,
      root: element,
      scroller: () => article.current,
    };
    const stop = setDrawn(drawn);
    // A newer overview asked for replaced the blocks, and what had focus with them.
    const newer = loadedNewer(tab.id, generation);
    const active = document.activeElement;
    const lost = active === null || active === document.body || element.contains(active);
    if (!takeReveal(drawn) && newer && lost) {
      (article.current ?? element).focus({ preventScroll: true });
    }
    return stop;
  }, [tab.id, shown, waiting, tree, generation]);

  // What a key acts on: the block with focus.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    return setScopeSource(element, {
      target: () => {
        const drawn = drawnIn(tab.id);
        const block = drawn && focusedBlock(drawn);
        return (drawn && block && targetOf(drawn, block)) ?? NO_TARGET;
      },
    });
  }, [tab.id, waiting]);

  // The block with focus, as focus moves. With code beside, focus landing on another block, by a
  // key or a click, has the diff follow it to its code.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const track = (event: FocusEvent) => {
      const drawn = drawnIn(tab.id);
      const block = drawn && focusedBlock(drawn);
      setFocused(block && blockNumber(block));
      if (event.type !== 'focusin' || !drawn || !block || !besideNow()) return;
      const blocks = drawn.scroller()?.querySelector('.lo-ov__article');
      const from = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (blocks && blockAround(blocks, from) !== block) followBlock(drawn, block);
    };
    element.addEventListener('focusin', track);
    element.addEventListener('focusout', track);
    return () => {
      element.removeEventListener('focusin', track);
      element.removeEventListener('focusout', track);
    };
  }, [tab.id, waiting]);

  // A right-click on a block: the block's menu.
  const menu = useMenuTarget((event) => {
    const drawn = drawnIn(tab.id);
    const box = article.current?.querySelector('.lo-ov__article');
    if (!drawn || !box || !(event.target instanceof Element)) return undefined;
    const block = blockAround(box, event.target);
    return block && targetOf(drawn, block);
  });

  if (waiting) {
    // It stands in for the middle of the window until the tab has a view to show: focus on it is
    // nowhere in particular, so keys typed as the tab opens go on in the view that draws and takes
    // focus from it, as they do on the middle itself.
    return (
      <div ref={root} className="h-full outline-none" tabIndex={-1} data-lo-middle>
        <MiddlePlaceholder tab={tab} />
      </div>
    );
  }
  return (
    <div
      ref={root}
      className="h-full outline-none"
      tabIndex={-1}
      data-lo-scope="overview"
      data-lo-overview={standing.kind}
      {...menu}
    >
      <Body tab={tab} standing={standing} scroller={scroller} onScreen={shown} focused={focused} />
    </div>
  );
}

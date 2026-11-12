// The overview, the first of a pull request's tab's middle views. As the tab opens it draws the
// tab's placeholder until it knows whether the overview shows, for `HOLD_LIMIT` at most, then
// stays, or hands the middle to the diff before either has drawn anything. After that it shows the
// overview, or why there's none to show; one that comes later is offered, never switched to.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { setMiddle } from '../../../window/commands/registry.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { HOLD_LIMIT } from '../../revisions/contract.ts';
import { useKnownSetting } from '../../settings/window/shared.ts';
import { MiddlePlaceholder, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { open } from '../settings.ts';
import { knownOf, type Known, type Standing } from './facts.ts';
import { useStanding } from './hooks.ts';
import { openingOf, openings, type Opening } from './opening.ts';
import { Shown } from './Shown.tsx';
import { CantShow, NoOverview, Quiet, ReadFailed } from './States.tsx';

/**
 * What tab `tab` opens on, chosen once, once Settings is known: until then, `waiting`, which wakes
 * at the bound. Once chosen, the diff is shown if that's the choice and this view is on screen, as
 * it is when the tab opens, unless the reader picked a view while it waited: where they are wins.
 */
export function useOpening(tab: string, known: Known, shown: boolean): Opening {
  const setting = useKnownSetting(open);
  const opened = useTabState(openings, tab);
  const [now, setNow] = useState(Date.now);
  const since = opened.since ?? now;
  const decided = opened.on ?? openingOf(setting, known, now - since);

  // The overview leaves the screen while the tab waits only when the reader shows another view.
  useLayoutEffect(() => {
    const current = openings.get(tab);
    if (!shown && current.on === undefined && !current.chose) {
      openings.set(tab, { ...current, chose: true });
    }
  }, [tab, shown]);

  useLayoutEffect(() => {
    const current = openings.get(tab);
    if (current.on !== undefined) return;
    if (decided === 'waiting') {
      if (current.since === undefined) openings.set(tab, { ...current, since });
      return;
    }
    openings.set(tab, {
      ...current,
      since: current.since ?? since,
      on: decided,
      late: decided === 'diff' && setting !== 'diff',
    });
    if (decided === 'diff' && shown && !current.chose) showDiff(tab);
  }, [tab, decided, since, setting, shown]);

  // The bound: past it, the tab opens on the diff, whatever is still to come.
  useEffect(() => {
    if (decided !== 'waiting') return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, since + HOLD_LIMIT - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [decided, since]);

  return decided;
}

/** What the view shows, once the tab has opened, for what the overview is. */
function Body({
  tab,
  standing,
  scroller,
  onScreen,
}: {
  tab: PullTab;
  standing: Standing;
  scroller: (element: HTMLDivElement | null) => void;
  onScreen: boolean;
}) {
  switch (standing.kind) {
    case 'reading':
      return <Quiet>Looking for an overview…</Quiet>;
    case 'checking':
      return <Quiet>Checking the overview…</Quiet>;
    case 'none':
      return <NoOverview tab={tab} standing={standing} />;
    case 'failed':
      return <ReadFailed tab={tab} problem={standing.problem} />;
    case 'unchecked':
    case 'invalid':
    case 'tooLarge':
    case 'newer':
      return <CantShow tab={tab} standing={standing} />;
    case 'shown':
      return <Shown tab={tab} standing={standing} scroller={scroller} onScreen={onScreen} />;
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

/** A pull request's tab's overview, in its middle. */
export function OverviewView({ tab, shown }: { tab: PullTab; shown: boolean }) {
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

  // Seen on screen as it shows, it's no longer offered.
  useEffect(() => {
    if (shown && known === 'shown' && !openings.get(tab.id).seen) {
      openings.update(tab.id, (current) => ({ ...current, seen: true }));
    }
  }, [tab.id, shown, known]);

  // While it's on screen, the middle view, which `Esc` gives focus back to.
  const waiting = opening === 'waiting';
  useEffect(() => {
    if (!shown || waiting) return undefined;
    const take = () => (article.current ?? root.current)?.focus({ preventScroll: true });
    if (root.current && focusIsFree(root.current)) take();
    return setMiddle({ focus: take, here: () => undefined });
  }, [shown, waiting]);

  if (waiting) return <MiddlePlaceholder tab={tab} />;
  return (
    <div
      ref={root}
      className="h-full outline-none"
      tabIndex={-1}
      data-lo-scope="overview"
      data-lo-overview={standing.kind}
    >
      <Body tab={tab} standing={standing} scroller={scroller} onScreen={shown} />
    </div>
  );
}

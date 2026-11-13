// The overview, the first of a pull request's tab's middle views. As the tab opens it draws the
// tab's placeholder until it knows whether the overview shows, for `holdLimit()` at most, then
// stays, or hands the middle to the diff before either has drawn anything. After that it shows the
// overview, or why there's none to show; one that comes later is offered, never switched to. A run
// of a stack's layers on screen as one diff has none, which it says. While
// it's on screen the overview's keys act on it (`follow.ts`), and the code of one of its blocks can
// sit beside it, which `o` and `Esc` take away again, the block the reader is at staying put.

import { Button, Key } from '@lo/ui';
import { NO_TARGET, setScopeSource } from '@lo/ui/commands';
import { generationOf } from '@lo/ui/markdown';
import { blockNumber, blockOf as blockAround, closeCards } from '@lo/ui/overview';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { DiffBeside, showDiff } from '../../diff/window/shared.ts';
import { holdLimit } from '../../revisions/window/shared.ts';
import { useKnownSetting } from '../../settings/window/shared.ts';
import { MiddlePlaceholder, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { open } from '../settings.ts';
import { blockIn, codeOf, onStep, stepsChanged } from './blocks.ts';
import { knownOf, type Known, type Standing } from './facts.ts';
import {
  besides,
  blockElement,
  closeBeside,
  closeBesideAt,
  drawnIn,
  focusedBlock,
  hereIn,
  holdBlock,
  keptPlace,
  loadedNewer,
  placesFor,
  setDrawn,
  takeReveal,
  targetOf,
  trees,
  type DrawnOverview,
} from './follow.ts';
import { useStanding } from './hooks.ts';
import { keyOf } from './labels.ts';
import { openingOf, openings, type Opening } from './opening.ts';
import { placeOnHead, placing } from './since.ts';
import { Shown } from './Shown.tsx';
import { CantShow, NoneInRun, NoOverview, Quiet, ReadFailed } from './States.tsx';

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
      Math.max(0, since + holdLimit() - Date.now()),
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
  focused,
  beside,
}: {
  tab: PullTab;
  standing: Standing;
  scroller: (element: HTMLDivElement | null) => void;
  onScreen: boolean;
  /** The block that has focus, by its number. */
  focused: number | undefined;
  /** Whether the code is beside it. */
  beside: boolean;
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
      return (
        <Shown
          tab={tab}
          standing={standing}
          scroller={scroller}
          onScreen={onScreen}
          focused={focused}
          beside={beside}
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
 * A pull request's tab's overview, in its middle, with the code of one of its blocks beside it; or,
 * for a run of a stack's layers, that it has none.
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
    return setMiddle({ focus: take, here: () => undefined });
  }, [shown]);
  return (
    <div ref={root} className="h-full outline-none" tabIndex={-1} data-lo-overview="run">
      <NoneInRun tab={tab} />
    </div>
  );
}

/** A pull request's tab's overview, in its middle, with the code of one of its blocks beside it. */
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

  // The block with focus, for its ring; the block whose code is beside, while that's open.
  const [focused, setFocused] = useState<number | undefined>(undefined);
  const besideId = useTabState(besides, tab.id);
  const besideAt =
    besideId === undefined || generation === undefined ? undefined : blockIn(besideId, generation);
  const besideNode = besideAt === undefined ? undefined : tree?.blocks[besideAt];
  const besideCode = besideNode && codeOf(besideNode);
  // Its file and line at the head on screen, drawn again once Lo has worked out where they are; a
  // file gone from it shows as the diff has it, from its top.
  const besidePath = besideCode?.path;
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (besidePath === undefined) return undefined;
    let live = true;
    const done = () => {
      if (live) redraw();
    };
    void placing(tab.id, besidePath)?.then(done, done);
    return () => {
      live = false;
    };
  }, [tab.id, besidePath]);
  const besideOnHead = besideCode && placeOnHead(tab.id, besideCode.path, besideCode.lines);
  const beside = besideCode && (besideOnHead ?? { path: besideCode.path, line: undefined });

  // The tab's places in the overview, for `⌃o` and `⌃i`.
  useEffect(() => placesFor(tab.id), [tab.id]);

  // Code beside a block of an overview no longer on screen goes with it.
  useEffect(() => {
    if (besideId !== undefined && besideAt === undefined && generation !== undefined) {
      besides.set(tab.id, undefined);
    }
  }, [tab.id, besideId, besideAt, generation]);

  // Seen on screen as it shows, it's no longer offered.
  useEffect(() => {
    if (shown && known === 'shown' && !openings.get(tab.id).seen) {
      openings.update(tab.id, (current) => ({ ...current, seen: true }));
    }
  }, [tab.id, shown, known]);

  // While it's on screen, the middle view, which `Esc` gives focus back to, after closing a term's
  // card or the code beside; and where the tab is in it, for history.
  const waiting = opening === 'waiting';
  useEffect(() => {
    if (!shown || waiting) return undefined;
    const take = () => (article.current ?? root.current)?.focus({ preventScroll: true });
    // A block history brought back has focus already.
    const own = root.current;
    const active = document.activeElement;
    const placed = active !== own && active !== article.current && own?.contains(active);
    if (own && !placed && focusIsFree(own)) take();
    return setMiddle({
      focus: take,
      here: () => {
        const now = drawnIn(tab.id);
        return now && hereIn(now);
      },
      escape: () => {
        if (closeCards()) return true;
        const now = drawnIn(tab.id);
        if (!now || !root.current?.contains(document.activeElement)) return false;
        return closeBesideAt(now);
      },
    });
  }, [tab.id, shown, waiting]);

  // While it's on screen and shows an overview, the keys act on it, and a block history asked
  // for meanwhile is shown.
  useLayoutEffect(() => {
    const element = root.current;
    if (!shown || waiting || !tree || generation === undefined || !element) return undefined;
    trees.set(tab.id, generation);
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

  // The block with focus, as focus moves; the code beside follows it to each block with code.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const track = () => {
      const drawn = drawnIn(tab.id);
      const block = drawn && focusedBlock(drawn);
      setFocused(block && blockNumber(block));
      if (!drawn || !block || besides.get(tab.id) === undefined) return;
      const at = targetOf(drawn, block);
      const index = blockNumber(block);
      const node = index === undefined ? undefined : drawn.tree.blocks[index];
      if (at?.kind === 'block' && node && codeOf(node) && besides.get(tab.id) !== at.block) {
        besides.set(tab.id, at.block);
      }
    };
    element.addEventListener('focusin', track);
    element.addEventListener('focusout', track);
    return () => {
      element.removeEventListener('focusin', track);
      element.removeEventListener('focusout', track);
    };
  }, [tab.id, waiting]);

  // The block the reader is at stays where it is on the page as the code beside comes and goes:
  // as the overview takes its new width, and as the blocks above it settle to it.
  const split = beside !== undefined;
  useLayoutEffect(() => {
    const drawn = drawnIn(tab.id);
    const kept = keptPlace(tab.id);
    const block = drawn && kept && blockElement(drawn, kept.block);
    return drawn && kept && block ? holdBlock(drawn, block, kept.top) : undefined;
  }, [tab.id, split]);

  // A right-click on a block: the block's menu.
  const menu = useMenuTarget((event) => {
    const drawn = drawnIn(tab.id);
    const box = article.current?.querySelector('.lo-ov__article');
    if (!drawn || !box || !(event.target instanceof Element)) return undefined;
    const block = blockAround(box, event.target);
    return block && targetOf(drawn, block);
  });

  if (waiting) return <MiddlePlaceholder tab={tab} />;
  const ring = focused ?? (split ? besideAt : undefined);
  return (
    <div
      ref={root}
      className="h-full outline-none"
      tabIndex={-1}
      data-lo-scope="overview"
      data-lo-overview={standing.kind}
      {...menu}
    >
      <div className={split ? 'lo-split' : 'lo-split lo-split--single'}>
        <section className="lo-split__pane" aria-label="Overview">
          {split && <OverviewBar />}
          <div className="lo-split__body">
            <Body
              tab={tab}
              standing={standing}
              scroller={scroller}
              onScreen={shown}
              focused={ring}
              beside={split}
            />
          </div>
        </section>
        {beside && (
          <section className="lo-split__pane" aria-label="Code beside">
            <DiffBeside
              tab={tab}
              path={beside.path}
              line={beside.line}
              end={<CloseBeside tab={tab.id} />}
            />
          </section>
        )}
      </div>
    </div>
  );
}

/** A key's caps for command `id`, as this system shows its first key, if it has one. */
function KeyFor({ id }: { id: string }) {
  useKeys();
  const keys = keyOf(id);
  return keys ? <Key keys={keys} quiet decorative /> : null;
}

/** Over the overview while its code is beside it: what it is, and how the code follows. */
function OverviewBar() {
  return (
    <div className="lo-split__bar">
      <span className="text-fg">Overview</span>
      <span className="min-w-8 flex-1" />
      <span className="flex items-center gap-6">
        <KeyFor id="overview.nextBlock" />
        Next block; the code follows
      </span>
    </div>
  );
}

/** Back to the overview alone, as `Esc` and `o` go. */
function CloseBeside({ tab }: { tab: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        const drawn = drawnIn(tab);
        if (drawn) closeBesideAt(drawn);
        else closeBeside(tab);
      }}
    >
      Close code beside
      <KeyFor id="keys.escape" />
    </Button>
  );
}

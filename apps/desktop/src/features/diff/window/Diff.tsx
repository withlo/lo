// The diff, the middle of a pull request's tab: every changed file in one scroll, in the left
// panel's order, drawn by `@lo/ui/code`'s view once each file that shows its lines has them. The
// order is worked out from the diff's own files, as the panel works it out, so the view is drawn
// in it from the start, and kept until the reader orders the files another way: what the files
// say of themselves changing doesn't reorder them under the reader. A new order, or other files,
// is a new view, which puts the cursor's line back where it was on the page, or else what was at
// the top of the screen. What's drawn stays while the next view's files load, or while main waits
// for what they need, marked as at work in the diff bar and taking no input, with the bar's line
// and the tree held with it; a tab that comes back on screen meanwhile draws it again, from what
// the loader kept of it. The next is drawn in a layer of its own over it, unseen until its editors
// have laid it out, and then takes its place in one Swap, in the frame the bar's line and the tree
// change in: no frame shows the box empty. A view is drawn before the frame it's first seen in, so
// a tab coming back on screen shows its code at once.
// What arrives after it's drawn goes into the view in place (`drawing.ts`). The tree follows the
// file on screen, and asks the diff to show the files it picks.

import {
  EmptyState,
  Glyphs,
  HintButton,
  Problem,
  Spinner,
  motionReduced,
  swapIn,
  whenSettled,
} from '@lo/ui';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { Slot } from '../../../window/slots.tsx';
import {
  comparedIn,
  revisionLabel,
  useRevisions,
  useViewedMarks,
} from '../../revisions/window/shared.ts';
import { useSetting } from '../../settings/window/shared.ts';
import {
  MiddlePlaceholder,
  tabState,
  useBeside,
  usePull,
  useSides,
  type PullTab,
} from '../../tab/window/shared.ts';
import { holdTree, orderIn, useOrderMode } from '../../tree/window/shared.ts';
import type { DiffProblem } from '../contract.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { draw, type DrawOptions, type Drawing, type Place } from './drawing.ts';
import { drawsView, inOrder, keepsBox, keptOrder, type KeptOrder, viewKey } from './files.ts';
import { problemSays, type Snapshot } from './loader.ts';
import { main } from './main.ts';
import { usePage } from './page.ts';
import { placesFor } from './places.ts';
import { notes } from './shared.ts';
import { loaderOf, onDrawn, useSnapshot } from './tabs.ts';
import { useSaysWaiting, useThreadsSettled } from './settled.ts';

/** Where each tab's view was when it last went, to come back to. */
const places = tabState<Place | undefined>(() => undefined);

/** The order each tab's diff is drawn in. */
const orders = tabState<KeptOrder | undefined>(() => undefined);

/**
 * What each tab's last view compared: two revisions by their comparison's key, or the whole pull
 * request at a head, from where it starts. Another comparison is the reader's own doing, and draws
 * with the cursor's file at the top.
 */
const compared = tabState<string | undefined>(() => undefined);

/** What `ready` compares, as {@link compared} keeps it. */
function comparisonOf(ready: {
  at: string;
  comparison: string | null;
  compareFrom: string | null;
}): string {
  return ready.comparison ?? `head:${ready.at}:${ready.compareFrom ?? ''}`;
}

/** The file a view's cursor was in, when it was in one. */
function cursorFile(place: Place | undefined): string | undefined {
  const cursor = place?.cursor;
  if (cursor?.kind === 'line') return cursor.at.file;
  if (cursor?.kind === 'header' || cursor?.kind === 'file') return cursor.file;
  return undefined;
}

/**
 * A pull request's tab's diff. While another middle view is on screen it stays drawn, hidden, so
 * coming back to it moves nothing.
 */
export function Diff({ tab, shown }: { tab: PullTab; shown: boolean }) {
  const loader = loaderOf(tab.id);
  const snapshot = useSnapshot(loader);
  const { ready } = snapshot;
  const settled = useThreadsSettled(tab.id, ready !== undefined);
  const saysWaiting = useSaysWaiting(tab.id, settled);
  // The panel's order, worked out from the diff's own files as the tree works it out from its
  // own, so the first view is drawn in it: the tree has its files a while after. It stays until
  // the reader orders the files another way.
  const mode = useOrderMode();
  const order = useMemo(() => {
    if (!ready) return undefined;
    const kept = keptOrder(
      orders.get(tab.id),
      comparisonOf(ready),
      ready.entries,
      mode,
      (changes) => orderIn(changes, mode),
    );
    orders.set(tab.id, kept);
    return kept.order;
  }, [ready, mode, tab.id]);
  // Code beside a reading view is inline, whatever Settings says: it's half the width.
  const beside = useBeside(tab.id);
  const chosen = useSetting(layoutSetting);
  const layout = beside ? 'inline' : chosen;
  const besideWas = useRef(beside);
  const whitespace = useSetting(whitespaceSetting);
  const marks = useViewedMarks(tab.id);
  const page = usePage();
  const nonceValue = page?.nonce;
  const packaged = page?.packaged ?? true;
  const box = useRef<HTMLDivElement>(null);
  /** The view on screen. */
  const view = useRef<Kept>(undefined);
  /** The next view, drawn unseen over it until its editors have laid it out. */
  const coming = useRef<{ made: Kept; frame: number }>(undefined);
  /** Views the one on screen fades in over, until it has. */
  const going = useRef(new Set<Kept>());
  useEffect(() => loader.setWhitespace(whitespace === 'show'), [loader, whitespace]);
  // The tab's places in the diff and the whole-file view, for `⌃o` and `⌃i`.
  useEffect(() => placesFor(tab.id), [tab.id]);

  const entries = useMemo(
    () =>
      ready && order ? inOrder(ready.entries, order, (key) => loader.ids.find(key)) : undefined,
    [ready, order, loader],
  );
  const key = ready && entries ? keyOf(ready, entries) : undefined;
  // What was drawn before the loader started on what's next, in the order it was drawn in, while
  // that's on its way: a tab that comes back on screen meanwhile draws it again, held.
  const { held } = snapshot;
  const again = useMemo(() => {
    if (!held) return undefined;
    const kept = keptOrder(orders.get(tab.id), comparisonOf(held), held.entries, mode, (changes) =>
      orderIn(changes, mode),
    );
    const listed = inOrder(held.entries, kept.order, (found) => loader.ids.find(found));
    return { ready: held, entries: listed, key: keyOf(held, listed) };
  }, [held, mode, tab.id, loader]);
  // What a new view is drawn with, read as it's drawn: a change of layout alone needs no new view.
  const comparison = ready && comparisonOf(ready);
  const compareFrom = ready?.compareFrom ?? null;
  const revisions = ready?.comparison ?? null;
  const latest = useRef({
    entries,
    layout,
    packaged,
    shown,
    marks,
    comparison,
    revisions,
    compareFrom,
    held: again,
  });
  latest.current = {
    entries,
    layout,
    packaged,
    shown,
    marks,
    comparison,
    revisions,
    compareFrom,
    held: again,
  };

  // Where the view is as it goes, read while it's still on the page, before it's taken down: as
  // the tab goes off screen, and as another view takes its place.
  useLayoutEffect(
    () => () => {
      const made = view.current;
      if (made) places.set(tab.id, made.place());
    },
    [key, nonceValue, tab.id],
  );

  // Drawn before the frame it's first seen in. Until there's a view to draw, the one drawn stays,
  // held: it hears nothing more of the loader, which has started on the next, and takes no input.
  // A tab that comes back on screen meanwhile draws the one it had again, held, from what the
  // loader kept of it. The next is drawn over it, unseen; once its editors have measured it, in the
  // next frame, it fades in over it in one Swap, and the bar's line and the tree change with it.
  const drawable = drawsView({ key, entries, nonce: nonceValue, settled });
  const want = drawable ? key : undefined;
  /** What the view on screen shows, held or not, by its key. */
  const [drawnKey, setDrawnKey] = useState<string>();
  const restorable =
    want === undefined && drawnKey === undefined && again !== undefined && nonceValue !== undefined;
  const stale = restorable || (drawnKey !== undefined && drawnKey !== want);
  useLayoutEffect(() => {
    const parent = box.current;
    const drawing = latest.current;
    dropComing(coming);
    if (!parent || nonceValue === undefined || !drawing.entries || want === undefined) {
      const last = view.current;
      if (last) {
        stop(last);
        return;
      }
      // Nothing drawn, as the tab comes back on screen before what's next is ready: the view it
      // had, again, held.
      const copy = loader.heldCopy();
      const kept = drawing.held;
      if (!parent || !copy || !kept || nonceValue === undefined) return;
      const made = drawIn(parent, {
        tab,
        loader: copy,
        entries: kept.entries,
        at: kept.ready.at,
        comparison: kept.ready.comparison,
        compareFrom: kept.ready.compareFrom,
        layout: drawing.layout,
        nonce: nonceValue,
        packaged: drawing.packaged,
        shown: drawing.shown,
        before: places.get(tab.id),
        marks: drawing.marks,
        held: true,
      });
      stop(made);
      view.current = made;
      setDrawnKey(kept.key);
      return;
    }
    const at = want.slice(0, want.indexOf('|'));
    // Another comparison than the last view's: the cursor's file at the top, if this one has it.
    const before = places.get(tab.id);
    const last = compared.get(tab.id);
    const another = last !== undefined && last !== drawing.comparison;
    compared.set(tab.id, drawing.comparison);
    const made = drawIn(parent, {
      tab,
      loader,
      entries: drawing.entries,
      at,
      comparison: drawing.revisions,
      compareFrom: drawing.compareFrom,
      layout: drawing.layout,
      nonce: nonceValue,
      packaged: drawing.packaged,
      shown: drawing.shown,
      before: another ? undefined : before,
      onTop: another ? cursorFile(before) : undefined,
      marks: drawing.marks,
    });
    const under = view.current;
    if (!under) {
      // The first is just there.
      view.current = made;
      setDrawnKey(want);
      return;
    }
    // Over the view on screen, unseen, until the editors have measured it in the next frame; then
    // in its place, with the bar's line and the tree, before that frame is drawn.
    made.layer.classList.add(...UNSEEN);
    const frame = requestAnimationFrame(() => {
      coming.current = undefined;
      view.current = made;
      flushSync(() => setDrawnKey(want));
      made.layer.classList.remove(...UNSEEN);
      fadeOver(made, under, going.current);
    });
    coming.current = { made, frame };
    // A new view only for new files, or a new order of them; one held, as the tab comes back.
  }, [want, nonceValue, restorable]);

  // The box stays while a view is drawn in it, held or not, until there's nothing to draw and the
  // loader has said why: a wait for what's next, such as the local copy, leaves the view held.
  const pull = usePull(tab.id);
  const revisionsOf = useRevisions(tab.id);
  const said = waitingSays(snapshot, pull, revisionsOf);
  const showsBox = keepsBox({
    drawable,
    held: stale,
    said: said?.text,
    waiting: snapshot.state?.waiting,
  });
  const holding = stale && showsBox;
  useLayoutEffect(() => {
    if (showsBox) return;
    takeAllDown(view, coming, going.current);
    setDrawnKey(undefined);
  }, [showsBox]);
  // The tree holds the rows it drew while the diff holds its view, and changes with it.
  useLayoutEffect(() => {
    holdTree(tab.id, holding);
  }, [holding, tab.id]);
  // Taken down with the tab.
  useLayoutEffect(
    () => () => {
      takeAllDown(view, coming, going.current);
    },
    [],
  );

  // The layout changes in the frame the code goes beside a reading view or comes back, and focus
  // stays where it was, in the code or out of it; a layout chosen in Settings takes focus to the
  // line the cursor's on.
  useLayoutEffect(() => {
    const moved = besideWas.current !== beside;
    besideWas.current = beside;
    const focus = !moved || box.current?.contains(document.activeElement) === true;
    view.current?.view.setLayout(layout, { focus });
  }, [layout, beside]);

  // The sides share the width as the window's layout keeps it for every side-by-side diff, changed
  // here, in another tab, or by Reset layout: in the frame it changes in.
  const sides = useSides();
  useLayoutEffect(() => {
    view.current?.view.setSides(sides);
    coming.current?.made.view.setSides(sides);
  }, [sides]);

  useEffect(() => {
    live(view.current)?.setShown(shown);
  }, [shown]);

  // While it's on screen, main reads its files first.
  useEffect(() => {
    main()
      .shown({ id: tab.id, shown })
      .catch((error: unknown) => console.error("Lo couldn't say the diff was shown:", error));
  }, [tab.id, shown]);

  // Its place on the page is held from the first frame it's seen in, as it's shown.
  useLayoutEffect(() => {
    if (shown) view.current?.view.seen();
  }, [shown]);

  // Viewed marks change the headers' balls, and close the files marked viewed elsewhere, or that
  // GitHub said were viewed after the view was drawn, where the reader isn't looking.
  useEffect(() => {
    live(view.current)?.setMarks(marks);
  }, [marks]);

  // The local copy's files, taken in place of GitHub's, say more of each, and may start out
  // otherwise.
  useEffect(() => {
    if (ready) live(view.current)?.update(ready.entries);
  }, [ready]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Slot
        slot={notes}
        props={{
          tab,
          held: holding,
          end: (
            <>
              {holding && <Spinner />}
              <ChangeJumps tab={tab.id} />
            </>
          ),
        }}
      />
      {showsBox ? (
        // Each view is drawn in a layer of its own, the next over the last until it's in its place.
        // The next, drawn, can take focus as it's drawn, unseen, so the box takes input again then.
        <div
          ref={box}
          className="relative min-h-0 flex-1"
          data-lo-diff={tab.id}
          data-lo-held={stale || undefined}
          aria-busy={stale || undefined}
          inert={stale && want === undefined}
        />
      ) : (
        <Waiting tab={tab} said={said} threads={saysWaiting} />
      )}
    </div>
  );
}

/**
 * A view drawn, in its layer of the box, and whether it has stopped hearing the loader while it
 * stays, stale.
 */
type Kept = Drawing & { layer: HTMLElement; stopped?: boolean };

/** A view's layer: the whole box, over the page, so the one under it shows nowhere through it. */
const LAYER = 'absolute inset-0 bg-bg';

/** A layer drawn but not yet seen, over the view on screen. */
const UNSEEN = ['opacity-0', 'pointer-events-none'];

/** Draws a view in a new layer of `parent`, over whatever's there. */
function drawIn(parent: HTMLElement, options: Omit<DrawOptions, 'parent'>): Kept {
  const layer = document.createElement('div');
  layer.className = LAYER;
  parent.append(layer);
  return Object.assign(draw({ ...options, parent: layer }), { layer });
}

/**
 * Brings `made` in over `under`, the view it takes the place of, which takes no more input: in a
 * Swap, after which `under` goes, or at once where moves are off. `going` holds the views a Swap
 * still runs over, which go at once as another starts.
 */
function fadeOver(made: Kept, under: Kept, going: Set<Kept>): void {
  for (const each of going) takeDown(each);
  going.clear();
  stop(under);
  under.layer.inert = true;
  under.layer.setAttribute('aria-hidden', 'true');
  if (motionReduced()) {
    takeDown(under);
    return;
  }
  going.add(under);
  swapIn(made.layer);
  whenSettled(made.layer, () => {
    if (going.delete(under)) takeDown(under);
  });
}

/** Stops a view hearing the loader, which has started on the next. */
function stop(made: Kept): void {
  if (!made.stopped) made.stop();
  made.stopped = true;
}

/** The view drawn, unless it's stale: what comes now is the next one's, and isn't for it. */
function live(made: Kept | undefined): Kept | undefined {
  return made?.stopped ? undefined : made;
}

/** Takes a view off the page, stopping it first unless it has stopped already. */
function takeDown(made: Kept): void {
  stop(made);
  made.view.destroy();
  made.layer.remove();
}

/** Takes down the view `coming`, unseen yet, if there is one. */
function dropComing(coming: { current: { made: Kept; frame: number } | undefined }): void {
  const next = coming.current;
  if (!next) return;
  coming.current = undefined;
  cancelAnimationFrame(next.frame);
  takeDown(next.made);
}

/** Takes down every view in the box: the one on screen, the one coming and those going. */
function takeAllDown(
  view: { current: Kept | undefined },
  coming: { current: { made: Kept; frame: number } | undefined },
  going: Set<Kept>,
): void {
  dropComing(coming);
  for (const each of going) takeDown(each);
  going.clear();
  const last = view.current;
  view.current = undefined;
  if (last) takeDown(last);
}

/** What makes a view of `ready`'s files, in the order of `entries`, a new one. */
function keyOf(
  ready: { at: string; comparison: string | null; compareFrom: string | null },
  entries: Parameters<typeof viewKey>[1],
): string {
  return viewKey(`${ready.at}|${ready.comparison ?? ''}|${ready.compareFrom ?? ''}`, entries);
}

/**
 * The diff bar's buttons for the change jumps, which say why they're dimmed until the diff is
 * drawn, and are drawn again each time it is.
 */
function ChangeJumps({ tab }: { tab: string }) {
  const [, redraw] = useReducer((times: number) => times + 1, 0);
  useEffect(
    () =>
      onDrawn((id) => {
        if (id === tab) redraw();
      }),
    [tab],
  );
  return (
    <span className="flex flex-none items-center gap-2">
      <HintButton command="diff.previousChange" />
      <HintButton command="diff.nextChange" />
    </span>
  );
}

/**
 * Why the middle has no diff to draw, and what it says of it: what the diff waits for, that no file
 * changed, or what couldn't be read. `text` is its words.
 */
type Said =
  | { readonly kind: 'waiting'; readonly text: string }
  | { readonly kind: 'none'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string; readonly problem: DiffProblem };

/**
 * What the middle says in place of the diff, when there's something to say: why there's nothing to
 * draw. Nothing while the diff is on its way, or while the tab hasn't opened, since the tab says
 * why it can't in place of its view.
 */
function waitingSays(
  snapshot: Snapshot,
  pull: ReturnType<typeof usePull>,
  revisions: ReturnType<typeof useRevisions>,
): Said | undefined {
  const { state } = snapshot;
  if (!pull?.shown) return undefined;
  if (state?.waiting) return { kind: 'waiting', text: state.waiting };
  if (state?.files?.length === 0) {
    const ends = state.comparison === null ? undefined : comparedIn(revisions);
    const from = ends && (ends.from === null ? 'base' : revisionLabel(revisions, ends.from));
    const to = ends && revisionLabel(revisions, ends.to);
    const text = from && to ? `No files changed in ${from} → ${to}` : 'No files changed';
    return { kind: 'none', text };
  }
  if (state?.problem && state.files === null) {
    return { kind: 'failed', text: problemSays(state.problem), problem: state.problem };
  }
  return undefined;
}

/**
 * Why the diff couldn't be read, as a failed view says it: the words of a read that failed, or,
 * for changes over the limit, that the diff can't show, and why.
 */
function DiffFailed({ said }: { said: Extract<Said, { kind: 'failed' }> }) {
  const large = said.problem.kind === 'tooLarge';
  return (
    <Problem
      layout="view"
      title={large ? 'Can’t show the diff' : said.text}
      reason={large ? said.text : undefined}
    />
  );
}

/**
 * What the middle shows until the diff is drawn. While the tab opens and its files are read, it's
 * the tab's own wait, which this view carries on from whichever drew it before: one mark from the
 * tab opening until the diff is there, over what's read now, or what the diff waits for, as the
 * local copy. A diff with nothing to draw says why, `said`: no files changed, or what couldn't be
 * read. `threads` says the view has waited a while for its threads.
 */
function Waiting({
  tab,
  said,
  threads,
}: {
  tab: PullTab;
  said: Said | undefined;
  threads: boolean;
}) {
  const pull = usePull(tab.id);
  if (said?.kind === 'none') {
    // A range of revisions reads with its arrow drawn as an icon: `r1 → r3`.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState icon="file-diff" title={<Glyphs text={said.text} size={14} />} />
      </div>
    );
  }
  if (said?.kind === 'failed') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DiffFailed said={said} />
      </div>
    );
  }
  let status: string | undefined;
  if (said?.kind === 'waiting') status = said.text;
  else if (pull?.shown) status = threads ? 'Reading review threads…' : 'Reading changed files…';
  return (
    <div className="min-h-0 flex-1">
      <MiddlePlaceholder tab={tab} status={status} />
    </div>
  );
}

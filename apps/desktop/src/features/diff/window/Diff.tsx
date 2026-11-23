// The diff, the middle of a pull request's tab: every changed file in one scroll, in the left
// panel's order, drawn by `@lo/ui/code`'s view once each file that shows its lines has them. The
// order is worked out from the diff's own files, as the panel works it out, so the view is drawn
// in it from the start, and kept until the reader orders the files another way: what the files
// say of themselves changing doesn't reorder them under the reader. A new order, or other files,
// is a new view, which puts the cursor's line back where it was on the page, or else what was at
// the top of the screen. What's drawn stays while the next view's files load, or while main waits
// for what they need, marked as at work in the diff bar, and the next takes its place in one Swap;
// a tab that comes back on screen meanwhile draws it again, from what the loader kept of it. A view
// is drawn before the frame it's first seen in, so a tab coming back on screen shows its code at
// once.
// What arrives after it's drawn goes into the view in place (`drawing.ts`). The tree follows the
// file on screen, and asks the diff to show the files it picks.

import { HintButton, Spinner, Swap } from '@lo/ui';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Slot } from '../../../window/slots.tsx';
import {
  comparedIn,
  revisionLabel,
  useRevisions,
  useViewedMarks,
} from '../../revisions/window/shared.ts';
import { useSetting } from '../../settings/window/shared.ts';
import { MiddlePlaceholder, tabState, usePull, type PullTab } from '../../tab/window/shared.ts';
import { orderIn, useOrderMode } from '../../tree/window/shared.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { draw, type Drawing, type Place } from './drawing.ts';
import { inOrder, keepsBox, keptOrder, type KeptOrder, viewKey } from './files.ts';
import type { Snapshot } from './loader.ts';
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
  const layout = useSetting(layoutSetting);
  const whitespace = useSetting(whitespaceSetting);
  const marks = useViewedMarks(tab.id);
  const page = usePage();
  const nonceValue = page?.nonce;
  const packaged = page?.packaged ?? true;
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<Kept>(undefined);
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
  // loader kept of it. The next is drawn in the frame the last is taken down in, and fades in over
  // it, in one Swap.
  const drawable = key !== undefined && nonceValue !== undefined && settled;
  /** What the view drawn shows, held or not, by its key: what the Swap names. */
  const [drawnKey, setDrawnKey] = useState<string>();
  const restorable =
    !drawable && drawnKey === undefined && again !== undefined && nonceValue !== undefined;
  const stale = (drawnKey !== undefined || restorable) && !drawable;
  useLayoutEffect(() => {
    const parent = box.current;
    const drawing = latest.current;
    if (!parent || nonceValue === undefined || !drawing.entries || key === undefined || !settled) {
      const last = view.current;
      if (last) {
        if (!last.stopped) last.stop();
        last.stopped = true;
        return;
      }
      // Nothing drawn, as the tab comes back on screen before what's next is ready: the view it
      // had, again, held.
      const copy = loader.heldCopy();
      const kept = drawing.held;
      if (!parent || !copy || !kept || nonceValue === undefined) return;
      const made: Kept = draw({
        parent,
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
      made.stop();
      made.stopped = true;
      view.current = made;
      setDrawnKey(kept.key);
      return;
    }
    const at = key.slice(0, key.indexOf('|'));
    // Another comparison than the last view's: the cursor's file at the top, if this one has it.
    const before = places.get(tab.id);
    const last = compared.get(tab.id);
    const another = last !== undefined && last !== drawing.comparison;
    compared.set(tab.id, drawing.comparison);
    const replaced = view.current;
    if (replaced) takeDown(replaced);
    const made: Kept = draw({
      parent,
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
    view.current = made;
    setDrawnKey(key);
    // A new view only for new files, or a new order of them; one held, as the tab comes back.
  }, [key, nonceValue, settled, restorable]);

  // The box stays while a view is drawn in it, held or not, until there's nothing to draw and the
  // loader has said why: a wait for what's next, such as the local copy, leaves the view held.
  const pull = usePull(tab.id);
  const revisionsOf = useRevisions(tab.id);
  const said = waitingSays(snapshot, pull, revisionsOf);
  const showsBox = keepsBox({ drawable, held: stale, said, waiting: snapshot.state?.waiting });
  useLayoutEffect(() => {
    if (showsBox) return;
    const last = view.current;
    view.current = undefined;
    if (last) takeDown(last);
    setDrawnKey(undefined);
  }, [showsBox]);
  // Taken down with the tab.
  useLayoutEffect(
    () => () => {
      const last = view.current;
      view.current = undefined;
      if (last) takeDown(last);
    },
    [],
  );

  useEffect(() => {
    view.current?.view.setLayout(layout);
  }, [layout]);

  useEffect(() => {
    live(view.current)?.setShown(shown);
  }, [shown]);

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
          end: (
            <>
              {stale && showsBox && <Spinner size="xs" />}
              <ChangeJumps tab={tab.id} />
            </>
          ),
        }}
      />
      {showsBox ? (
        <Swap id={drawnKey} keep className="flex min-h-0 flex-1 flex-col">
          <div
            ref={box}
            className="min-h-0 flex-1"
            data-lo-diff={tab.id}
            data-lo-held={stale || undefined}
            aria-busy={stale || undefined}
            inert={stale}
          />
        </Swap>
      ) : (
        <Waiting tab={tab} said={said} threads={saysWaiting} />
      )}
    </div>
  );
}

/** A view drawn, and whether it has stopped hearing the loader while it stays, stale. */
type Kept = Drawing & { stopped?: boolean };

/** The view drawn, unless it's stale: what comes now is the next one's, and isn't for it. */
function live(made: Kept | undefined): Kept | undefined {
  return made?.stopped ? undefined : made;
}

/** Takes a view off the page, stopping it first unless it has stopped already. */
function takeDown(made: Kept): void {
  if (!made.stopped) made.stop();
  made.stopped = true;
  made.view.destroy();
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
 * What the middle says in place of the diff, when there's something to say: why there's nothing to
 * draw. Nothing while the diff is on its way, or while the tab hasn't opened, since the tab says
 * why it can't in place of its view.
 */
function waitingSays(
  snapshot: Snapshot,
  pull: ReturnType<typeof usePull>,
  revisions: ReturnType<typeof useRevisions>,
): string | undefined {
  const { state } = snapshot;
  if (!pull?.shown) return undefined;
  if (state?.waiting) return state.waiting;
  if (state?.files?.length === 0) {
    const ends = state.comparison === null ? undefined : comparedIn(revisions);
    const from = ends && (ends.from === null ? 'base' : revisionLabel(revisions, ends.from));
    const to = ends && revisionLabel(revisions, ends.to);
    return from && to ? `No files changed in ${from} → ${to}` : 'No files changed';
  }
  if (state?.problem && state.files === null) return state.problem;
  return undefined;
}

/**
 * What the middle shows until the diff is drawn. While the tab opens and its files are read, it's
 * the tab's own wait, which this view carries on from whichever drew it before: one mark from the
 * tab opening until the diff is there, over what's read now. A diff with nothing to draw says why,
 * `said`. `threads` says the view has waited a while for its threads.
 */
function Waiting({
  tab,
  said,
  threads,
}: {
  tab: PullTab;
  said: string | undefined;
  threads: boolean;
}) {
  const pull = usePull(tab.id);
  if (said !== undefined) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-32 text-center text-fg-muted text-ui">
        <p className="max-w-read-measure">{said}</p>
      </div>
    );
  }
  let status: string | undefined;
  if (pull?.shown) status = threads ? 'Reading review threads…' : 'Reading changed files…';
  return (
    <div className="min-h-0 flex-1">
      <MiddlePlaceholder tab={tab} status={status} />
    </div>
  );
}

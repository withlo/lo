// The diff, the middle of a pull request's tab: every changed file in one scroll, in the left
// panel's order, drawn by `@lo/ui/code`'s view once each file that shows its lines has them. The
// order is worked out from the diff's own files, as the panel works it out, so the view is drawn
// in it from the start, and kept until the reader orders the files another way: what the files
// say of themselves changing doesn't reorder them under the reader. A new order, or other files,
// is a new view, which puts the cursor's line back where it was on the page, or else what was at
// the top of the screen.
// What arrives after it's drawn goes into the view in place (`drawing.ts`). The tree follows the
// file on screen, and asks the diff to show the files it picks.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { Slot } from '../../../window/slots.tsx';
import { useViewedMarks } from '../../revisions/window/shared.ts';
import { useSetting } from '../../settings/window/shared.ts';
import { tabState, usePull, type PullTab } from '../../tab/window/shared.ts';
import { orderIn, useOrderMode } from '../../tree/window/shared.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { draw, type Drawing, type Place } from './drawing.ts';
import { inOrder, keptOrder, type KeptOrder, viewKey } from './files.ts';
import type { Snapshot } from './loader.ts';
import { usePage } from './page.ts';
import { placesFor } from './places.ts';
import { notes } from './shared.ts';
import { loaderOf, useSnapshot } from './tabs.ts';

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
  // The panel's order, worked out from the diff's own files as the tree works it out from its
  // own, so the first view is drawn in it: the tree has its files a while after. It stays until
  // the reader orders the files another way.
  const mode = useOrderMode(tab.id);
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
  const view = useRef<Drawing>(undefined);
  useEffect(() => loader.setWhitespace(whitespace === 'show'), [loader, whitespace]);
  // The tab's places in the diff and the whole-file view, for `⌃o` and `⌃i`.
  useEffect(() => placesFor(tab.id), [tab.id]);

  const entries = useMemo(
    () =>
      ready && order ? inOrder(ready.entries, order, (key) => loader.ids.find(key)) : undefined,
    [ready, order, loader],
  );
  const key =
    ready && entries
      ? viewKey(`${ready.at}|${ready.comparison ?? ''}|${ready.compareFrom ?? ''}`, entries)
      : undefined;
  // What a new view is drawn with, read as it's drawn: a change of layout alone needs no new view.
  const comparison = ready && comparisonOf(ready);
  const compareFrom = ready?.compareFrom ?? null;
  const latest = useRef({ entries, layout, packaged, shown, marks, comparison, compareFrom });
  latest.current = { entries, layout, packaged, shown, marks, comparison, compareFrom };

  useEffect(() => {
    const parent = box.current;
    const drawn = latest.current;
    if (!parent || nonceValue === undefined || !drawn.entries || key === undefined) {
      return undefined;
    }
    const at = key.slice(0, key.indexOf('|'));
    // Another comparison than the last view's: the cursor's file at the top, if this one has it.
    const before = places.get(tab.id);
    const last = compared.get(tab.id);
    const another = last !== undefined && last !== drawn.comparison;
    compared.set(tab.id, drawn.comparison);
    const made = draw({
      parent,
      tab,
      loader,
      entries: drawn.entries,
      at,
      compareFrom: drawn.compareFrom,
      layout: drawn.layout,
      nonce: nonceValue,
      packaged: drawn.packaged,
      shown: drawn.shown,
      before: another ? undefined : before,
      onTop: another ? cursorFile(before) : undefined,
      marks: drawn.marks,
    });
    view.current = made;
    return () => {
      view.current = undefined;
      made.stop();
      made.view.destroy();
    };
    // A new view only for new files, or a new order of them.
  }, [key, nonceValue]);

  // Where the view is as it goes, read while it's still on the page: as the tab goes off screen,
  // its view is taken off the page before the effects above are undone.
  useLayoutEffect(
    () => () => {
      const made = view.current;
      if (made) places.set(tab.id, made.place());
    },
    [key, nonceValue, tab.id],
  );

  useEffect(() => {
    view.current?.view.setLayout(layout);
  }, [layout]);

  useEffect(() => {
    view.current?.setShown(shown);
  }, [shown]);

  // Viewed marks change the headers' balls, and close the files marked viewed elsewhere, or that
  // GitHub said were viewed after the view was drawn, where the reader isn't looking.
  useEffect(() => {
    view.current?.setMarks(marks);
  }, [marks]);

  // The local copy's files, taken in place of GitHub's, say more of each, and may start out
  // otherwise.
  useEffect(() => {
    if (ready) view.current?.update(ready.entries);
  }, [ready]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Slot slot={notes} props={{ tab }} />
      {!ready || nonceValue === undefined ? (
        <Waiting tab={tab} snapshot={snapshot} />
      ) : (
        <div ref={box} className="min-h-0 flex-1" data-lo-diff={tab.id} />
      )}
    </div>
  );
}

/** What the middle says until the diff is drawn. */
function Waiting({ tab, snapshot }: { tab: PullTab; snapshot: Snapshot }) {
  const pull = usePull(tab.id);
  const { state, progress } = snapshot;
  let text = 'Reading what the pull request changes…';
  // Until the tab knows its head, it's still opening, or can't.
  if (!pull?.shown) text = pull?.problem ? 'Nothing to show yet.' : 'Opening the pull request…';
  else if (state?.waiting) text = state.waiting;
  else if (state?.files?.length === 0) {
    text =
      state.comparison === null
        ? 'The pull request changes no files.'
        : 'No file changed between these revisions.';
  } else if (state?.problem && state.files === null) text = state.problem;
  else if (progress.of > 0) text = `Diffing the files: ${progress.done} of ${progress.of}…`;
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-32 text-center text-fg-muted text-ui">
      <p className="max-w-read-measure">{text}</p>
    </div>
  );
}

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

import { useSetting } from '../../settings/window/shared.ts';
import { tabState, usePull, type PullTab } from '../../tab/window/shared.ts';
import { orderIn, useOrderMode } from '../../tree/window/shared.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { draw, type Drawing, type Place } from './drawing.ts';
import { inOrder, keptOrder, type KeptOrder, viewKey } from './files.ts';
import type { Snapshot } from './loader.ts';
import { usePage } from './page.ts';
import { placesFor } from './places.ts';
import { loaderOf, useSnapshot } from './tabs.ts';

/** Where each tab's view was when it last went, to come back to. */
const places = tabState<Place | undefined>(() => undefined);

/** The order each tab's diff is drawn in. */
const orders = tabState<KeptOrder | undefined>(() => undefined);

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
    const kept = keptOrder(orders.get(tab.id), ready.at, ready.entries, mode, (changes) =>
      orderIn(changes, mode),
    );
    orders.set(tab.id, kept);
    return kept.order;
  }, [ready, mode, tab.id]);
  const layout = useSetting(layoutSetting);
  const whitespace = useSetting(whitespaceSetting);
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
  const key = ready && entries ? viewKey(ready.at, entries) : undefined;
  // What a new view is drawn with, read as it's drawn: a change of layout alone needs no new view.
  const latest = useRef({ entries, layout, packaged, shown });
  latest.current = { entries, layout, packaged, shown };

  useEffect(() => {
    const parent = box.current;
    const drawn = latest.current;
    if (!parent || nonceValue === undefined || !drawn.entries || key === undefined) {
      return undefined;
    }
    const at = key.slice(0, key.indexOf('|'));
    const made = draw({
      parent,
      tab,
      loader,
      entries: drawn.entries,
      at,
      layout: drawn.layout,
      nonce: nonceValue,
      packaged: drawn.packaged,
      shown: drawn.shown,
      before: places.get(tab.id),
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

  // The local copy's files, taken in place of GitHub's, say more of each, and may start out
  // otherwise.
  useEffect(() => {
    if (ready) view.current?.update(ready.entries);
  }, [ready]);

  if (!ready || nonceValue === undefined) return <Waiting tab={tab} snapshot={snapshot} />;
  return <div ref={box} className="h-full min-h-0" data-lo-diff={tab.id} />;
}

/** What the middle says until the diff is drawn. */
function Waiting({ tab, snapshot }: { tab: PullTab; snapshot: Snapshot }) {
  const pull = usePull(tab.id);
  const { state, progress } = snapshot;
  let text = 'Reading what the pull request changes…';
  // Until the tab knows its head, it's still opening, or can't.
  if (!pull?.shown) text = pull?.problem ? 'Nothing to show yet.' : 'Opening the pull request…';
  else if (state?.files?.length === 0) text = 'The pull request changes no files.';
  else if (state?.problem && state.files === null) text = state.problem;
  else if (progress.of > 0) text = `Diffing the files: ${progress.done} of ${progress.of}…`;
  return (
    <div className="grid h-full place-items-center p-32 text-center text-fg-muted text-ui">
      <p className="max-w-read-measure">{text}</p>
    </div>
  );
}

// The diff, the middle of a pull request's tab: every changed file in one scroll, in the left
// panel's order, drawn by `@lo/ui/code`'s view once each file that shows its lines has them. The
// order is worked out from the diff's own files, as the panel works it out, so the view is drawn
// in it from the start, and kept until the reader orders the files another way: what the files
// say of themselves changing doesn't reorder them under the reader. A new order, or other files,
// is a new view, which puts the cursor's line back where it was on the page, or else what was at
// the top of the screen.
// What arrives after it's drawn goes into the view in place (`drawing.ts`). The tree follows the
// file on screen, and asks the diff to show the files it picks.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import { useSetting } from '../../settings/window/shared.ts';
import { tabState, usePull, type PullTab } from '../../tab/window/shared.ts';
import { orderIn, useOrderMode } from '../../tree/window/shared.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { draw, type Drawing, type Place } from './drawing.ts';
import { inOrder, keptOrder, type KeptOrder, viewKey } from './files.ts';
import type { Loader, Snapshot } from './loader.ts';
import { loaderOf } from './tabs.ts';

/** Where each tab's view was when it last went, to come back to. */
const places = tabState<Place | undefined>(() => undefined);

/** The order each tab's diff is drawn in. */
const orders = tabState<KeptOrder | undefined>(() => undefined);

let page: Promise<{ nonce: string; packaged: boolean }> | undefined;

/**
 * The nonce in the page's content security policy, which the view's style elements carry, from
 * `app.info`, once per page load, and whether Lo runs as it ships.
 */
function pageInfo(): Promise<{ nonce: string; packaged: boolean }> {
  page ??= client(app)
    .info()
    .then(({ nonce, packaged: shipped }) => ({ nonce, packaged: shipped }));
  return page;
}

/** Whether Lo runs as it ships, once `app.info` has said. */
let packaged = true;

function useNonce(): string | undefined {
  const [found, setFound] = useState<string>();
  useEffect(() => {
    let live = true;
    pageInfo()
      .then((info) => {
        packaged = info.packaged;
        if (live) setFound(info.nonce);
      })
      .catch((error: unknown) => {
        console.error("Lo couldn't read the page's nonce:", error);
        if (live) setFound('');
      });
    return () => {
      live = false;
    };
  }, []);
  return found;
}

function useSnapshot(loader: Loader): Snapshot {
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  return useSyncExternalStore(subscribe, () => loader.snapshot());
}

/** A pull request's tab's diff. */
export function Diff({ tab }: { tab: PullTab }) {
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
  const nonceValue = useNonce();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<Drawing>(undefined);
  useEffect(() => loader.setWhitespace(whitespace === 'show'), [loader, whitespace]);

  const entries = useMemo(
    () =>
      ready && order ? inOrder(ready.entries, order, (key) => loader.ids.find(key)) : undefined,
    [ready, order, loader],
  );
  const key = ready && entries ? viewKey(ready.at, entries) : undefined;
  // What a new view is drawn with, read as it's drawn: a change of layout alone needs no new view.
  const latest = useRef({ entries, layout });
  latest.current = { entries, layout };

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
      packaged,
      before: places.get(tab.id),
    });
    view.current = made;
    return () => {
      view.current = undefined;
      places.set(tab.id, made.place());
      made.stop();
      made.view.destroy();
    };
    // A new view only for new files, or a new order of them.
  }, [key, nonceValue]);

  useEffect(() => {
    view.current?.view.setLayout(layout);
  }, [layout]);

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

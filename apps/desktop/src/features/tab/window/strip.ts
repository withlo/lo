// How the tab strip draws a pull request's tab. Nothing here touches the DOM.

import type { Tab as StripTab } from '@lo/ui';

import { layerOf, runViewId, shownLayerOf, viewId, type PullView, type Tab } from '../contract.ts';
import { withoutBidi } from './title.ts';

/**
 * The id of the view whose pull request the strip names for `tab`: a run's own view, whose pull
 * request is its top layer's, else the layer on screen's.
 */
export function stripViewId(tab: Tab): string {
  if (tab.kind !== 'pull') return tab.id;
  return tab.run ? runViewId(tab, tab.run.layers) : viewId(tab, layerOf(tab));
}

/**
 * How the strip draws `tab`, given what main said of each view, by id: a pull request's by the
 * pull request its view shows, a run's top layer's as the header names it, with its view still
 * opening until its title arrives, unless main has said it can't be shown or isn't opening it yet. A
 * stack's tab says how many layers it has. A pull request's or a merge queue's tab is `refreshing`
 * while it's read again, as the reader asked.
 */
export function stripTab(
  tab: Tab,
  views: ReadonlyMap<string, PullView>,
  refreshing = false,
): StripTab {
  const turning = refreshing ? { refreshing: true } : {};
  switch (tab.kind) {
    case 'pull': {
      const { id, repo, title, state, stack, run } = tab;
      const view = views.get(stripViewId(tab));
      const header = view?.header;
      // What the tab holds of its title and state is its layer on screen's, not a run's top layer's.
      const shownTitle = header?.title ?? (run ? undefined : title);
      return {
        kind: 'pull',
        id,
        repo,
        number: shownLayerOf(tab),
        title: shownTitle === undefined ? undefined : withoutBidi(shownTitle),
        state: header?.state ?? (run ? undefined : state),
        stack: stack?.layers.length,
        loading: view === undefined || (view.loading && view.problem === null),
        ...turning,
      };
    }
    case 'recent':
    case 'settings':
      return { kind: tab.kind, id: tab.id };
    case 'queue':
      return { kind: 'queue', id: tab.id, repo: tab.repo, branch: tab.branch, ...turning };
    default:
      tab satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(tab)}.`);
  }
}

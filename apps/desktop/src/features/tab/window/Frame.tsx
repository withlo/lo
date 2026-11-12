// The window's frame: the strip of tabs, and under it the tab on screen, drawn by the view its
// kind's feature puts in the `tab.kinds` slot, with whatever covers it over it.

import { TabBar, type Tab as StripTab } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { focusMiddle, registry } from '../../../window/commands/registry.ts';
import { Slot } from '../../../window/slots.tsx';
import type { PullView, Tab } from '../contract.ts';
import { main } from './main.ts';
import { moreStore, setFolded, setMoreOpen } from './more.ts';
import { dropTab, movedStore } from './order.ts';
import { cover, kinds, useActiveTab, useTabs } from './shared.ts';
import { pullsStore } from './store.ts';
import { withoutBidi } from './title.ts';

/**
 * How the strip draws `tab`: a pull request's still opening, until its title arrives, unless main
 * has said it can't be shown or isn't opening it yet.
 */
function stripTab(tab: Tab, view: PullView | undefined): StripTab {
  switch (tab.kind) {
    case 'pull': {
      const { id, repo, number, title, state } = tab;
      const header = view?.header;
      const shownTitle = header?.title ?? title;
      return {
        kind: 'pull',
        id,
        repo,
        number,
        title: shownTitle === undefined ? undefined : withoutBidi(shownTitle),
        state: header?.state ?? state,
        loading: view === undefined || (view.loading && view.problem === null),
      };
    }
    case 'recent':
    case 'settings':
      return { kind: tab.kind, id: tab.id };
    default:
      tab satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(tab)}.`);
  }
}

/** The tab a right-click landed on, by the id the strip gives each. */
function tabAt(target: EventTarget): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest('[data-tab]')?.getAttribute('data-tab') ?? undefined;
}

/**
 * The strip. A click shows a tab; its close button closes it as `⌘W` would, and a right-click on
 * it lists what can be done to it. A tab dragged along it moves there, and a screen reader hears
 * where a tab moved to, however it was moved.
 */
export function TabStrip() {
  const { tabs, active } = useTabs();
  const views = useStore(pullsStore, (state) => state.views);
  const moreOpen = useStore(moreStore, (state) => state.open);
  const said = useStore(movedStore, (state) => state.said);
  const menu = useMenuTarget((event) => {
    const id = tabAt(event.target);
    return id === undefined ? undefined : { kind: 'tab', tab: id };
  });
  return (
    <div className="contents" {...menu}>
      <TabBar
        tabs={tabs.map((tab) => stripTab(tab, views.get(tab.id)))}
        selected={active}
        moreOpen={moreOpen}
        onMoreOpenChange={setMoreOpen}
        onFold={setFolded}
        onSelect={(id) => {
          main()
            .select({ id })
            .catch((error: unknown) => console.error("Lo couldn't show the tab:", error));
        }}
        onClose={(id) => registry().run('tab.close', { kind: 'tab', tab: id })}
        onNew={() => registry().run('open.box', NO_TARGET)}
        onMove={(id, to) =>
          dropTab(id, to).catch((error: unknown) =>
            console.error("Lo couldn't move the tab:", error),
          )
        }
        menuContainer={document.getElementById('root')}
      />
      <div role="status" className="sr-only">
        {said}
      </div>
    </div>
  );
}

/**
 * The tab on screen. Only it is drawn, and afresh each time it's shown, so nothing of one tab's
 * view carries over to another's. Focus that left with the last tab's view goes to the middle of
 * this one; Lo starts with nothing focused.
 */
export function TabPage() {
  const tab = useActiveTab();
  const id = tab?.id;
  const last = useRef(id);
  useEffect(() => {
    const before = last.current;
    last.current = id;
    if (before === undefined || before === id) return;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) focusMiddle();
  }, [id]);
  return tab ? (
    <>
      <Slot key={tab.id} slot={kinds} props={{ tab }} />
      <Slot key={`${tab.id}-cover`} slot={cover} props={{ tab }} />
    </>
  ) : null;
}

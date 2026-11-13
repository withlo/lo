// The window's frame: the strip of tabs, and under it the tab on screen, drawn by the view its
// kind's feature puts in the `tab.kinds` slot, with whatever covers it over it.

import { TabBar } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { focusMiddle, registry } from '../../../window/commands/registry.ts';
import { Slot } from '../../../window/slots.tsx';
import { main } from './main.ts';
import { moreStore, setFolded, setMoreOpen } from './more.ts';
import { dropTab, movedStore } from './order.ts';
import { cover, kinds, useActiveTab, useTabs } from './shared.ts';
import { pullsStore } from './store.ts';
import { stripTab } from './strip.ts';

/** The tab a right-click landed on, by the id the strip gives each. */
function tabAt(target: EventTarget): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest('[data-tab]')?.getAttribute('data-tab') ?? undefined;
}

/**
 * The strip, a tab for each pull request, or each stack, open. A click shows a tab; its close
 * button closes it as `⌘W` would, and a right-click on it lists what can be done to it. A tab
 * dragged along it moves there, and a screen reader hears where a tab moved to, however it was
 * moved.
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
        tabs={tabs.map((tab) => stripTab(tab, views))}
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
 * The tab on screen, a pull request's as its view on screen. Only it is drawn, and afresh each time
 * it's shown, or shows another layer, so nothing of one view carries over to another. Focus that
 * left with the last view goes to the middle of this one; Lo starts with nothing focused.
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

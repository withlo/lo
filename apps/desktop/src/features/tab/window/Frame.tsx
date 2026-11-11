// The window's frame: the strip of tabs, and under it the tab on screen, drawn by the view its
// kind's feature puts in the `tab.kinds` slot.

import { TabBar, type Tab as StripTab } from '@lo/ui';
import { useEffect, useRef } from 'react';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { focusMiddle, registry } from '../../../window/commands/registry.ts';
import { Slot } from '../../../window/slots.tsx';
import type { Tab } from '../contract.ts';
import { main } from './main.ts';
import { kinds, useActiveTab, useTabs } from './shared.ts';
import { withoutBidi } from './title.ts';

/** How the strip draws `tab`. */
function stripTab(tab: Tab): StripTab {
  switch (tab.kind) {
    case 'pull': {
      const { id, repo, number, title, state } = tab;
      return {
        kind: 'pull',
        id,
        repo,
        number,
        title: title === undefined ? undefined : withoutBidi(title),
        state,
      };
    }
    case 'recent':
    case 'settings':
      return { kind: tab.kind, id: tab.id };
    default:
      tab satisfies never;
      throw new Error('A tab of an unknown kind.');
  }
}

/** The tab a right-click landed on, by the id the strip gives each. */
function tabAt(target: EventTarget): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest('[data-tab]')?.getAttribute('data-tab') ?? undefined;
}

/**
 * The strip. A click shows a tab; its close button closes it as `⌘W` would, and a right-click on
 * it lists what can be done to it.
 */
export function TabStrip() {
  const { tabs, active } = useTabs();
  const menu = useMenuTarget((event) => {
    const id = tabAt(event.target);
    return id === undefined ? undefined : { kind: 'tab', tab: id };
  });
  return (
    <div className="contents" {...menu}>
      <TabBar
        tabs={tabs.map(stripTab)}
        selected={active}
        onSelect={(id) => {
          main()
            .select({ id })
            .catch((error: unknown) => console.error("Lo couldn't show the tab:", error));
        }}
        onClose={(id) => registry().run('tab.close', { kind: 'tab', tab: id })}
      />
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
  return tab ? <Slot key={tab.id} slot={kinds} props={{ tab }} /> : null;
}

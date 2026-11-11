import { Registry, type Entry } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type { Tab } from '../contract.ts';
import { follow } from './follow.ts';
import type { TabsState } from './store.ts';

const fd: Tab = { id: 'fd', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
const bat: Tab = {
  id: 'bat',
  kind: 'pull',
  owner: 'sharkdp',
  repo: 'bat',
  number: 7,
  title: 'Page with less',
  state: 'open',
};
const recent: Tab = { id: 'recent', kind: 'recent' };

/** A place in a file, as a diff view records one. */
const at = (file: string): Entry => ({ view: 'diff', at: { kind: 'file', file } });

/** A registry and the tabs, followed, with every title the window was given. */
function followed() {
  const registry = new Registry({ system: 'mac', commands: [] });
  const store = createStore<TabsState>()(() => ({ tabs: [], active: undefined }));
  const titles: string[] = [];
  follow(registry, store, (title) => titles.push(title));
  const revealed: string[] = [];
  /** Lets each tab's diff reveal its places, saying which tab it was. */
  const views = (...tabs: string[]) => {
    for (const tab of tabs) {
      registry.history.register(tab, 'diff', (target) => {
        revealed.push(`${tab}:${target.kind === 'file' ? target.file : ''}`);
        return true;
      });
    }
  };
  const show = (tabs: Tab[], active: string) => store.setState({ tabs, active });
  return { registry, titles, revealed, views, show };
}

describe('the history ⌃o and ⌃i walk', () => {
  it('is the tab on screen’s, so each tab walks only its own places', () => {
    const { registry, revealed, views, show } = followed();
    views('fd', 'bat');
    show([fd, bat], 'fd');
    registry.history.record(at('a.ts'));
    registry.history.record(at('b.ts'));
    show([fd, bat], 'bat');
    registry.history.record(at('c.ts'));

    expect(registry.history.back()).toEqual(at('c.ts'));
    expect(registry.history.back()).toBeUndefined();
    show([fd, bat], 'fd');
    expect(registry.history.back()).toEqual(at('b.ts'));
    expect(registry.history.back()).toEqual(at('a.ts'));
    expect(registry.history.forward()).toEqual(at('b.ts'));
    expect(revealed).toEqual(['bat:c.ts', 'fd:b.ts', 'fd:a.ts', 'fd:b.ts']);
  });

  it('of a closed tab goes with it', () => {
    const { registry, views, show } = followed();
    views('fd', 'bat');
    show([fd, bat], 'fd');
    registry.history.record(at('a.ts'));
    show([bat], 'bat');
    // Were it to come back by the same id, it would start with nothing.
    registry.history.tab('fd');
    expect(registry.history.entries()).toEqual([]);
  });
});

describe("the window's title", () => {
  it('follows the tab on screen, and what GitHub says of it', () => {
    const { titles, show } = followed();
    show([recent], 'recent');
    show([fd, bat], 'fd');
    show([fd, bat], 'bat');
    show([fd, { ...bat, title: 'Page with less, always' }], 'bat');
    expect(titles).toEqual([
      'Lo',
      'sharkdp/fd#2212',
      'sharkdp/bat#7 — Page with less',
      'sharkdp/bat#7 — Page with less, always',
    ]);
  });
});

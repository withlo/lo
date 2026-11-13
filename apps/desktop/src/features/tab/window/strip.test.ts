import { describe, expect, it } from 'vitest';

import type { PullView, Tab } from '../contract.ts';
import { stripTab, stripViewId } from './strip.ts';

/** What main says of a view whose pull request is open and titled `title`. */
function viewOf(id: string, title: string): PullView {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the header is read.
  return { id, loading: false, problem: null, header: { title, state: 'open' } } as PullView;
}

const stack: Tab = {
  id: 'a',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 82,
  title: 'Stack B',
  state: 'open',
  layer: 83,
  layers: [82, 83, 84],
  stack: { layers: [82, 83, 84, 85], root: 'stack/root' },
};

describe('the strip’s tab for a stack', () => {
  it('names the layer on screen, with its title', () => {
    const views = new Map([['a:83', viewOf('a:83', 'Stack B: rate limit')]]);
    expect(stripViewId(stack)).toBe('a:83');
    expect(stripTab(stack, views)).toMatchObject({
      number: 83,
      title: 'Stack B: rate limit',
      stack: 4,
      loading: false,
    });
  });

  it('names a run’s top layer, as the header does, not the layer the run was chosen from', () => {
    const run: Tab = { ...stack, run: { layers: [83, 84], start: 'c'.repeat(40), from: 83 } };
    const views = new Map([
      ['a:83', viewOf('a:83', 'Stack B: rate limit')],
      ['a:83-84', viewOf('a:83-84', 'Stack C: count a query’s nodes')],
    ]);
    expect(stripViewId(run)).toBe('a:83-84');
    expect(stripTab(run, views)).toMatchObject({
      number: 84,
      title: 'Stack C: count a query’s nodes',
      loading: false,
    });
  });

  it('shows no title, rather than the layer’s, while a run’s view is opening', () => {
    const run: Tab = { ...stack, run: { layers: [83, 84], start: 'c'.repeat(40), from: 83 } };
    expect(stripTab(run, new Map())).toMatchObject({
      number: 84,
      title: undefined,
      state: undefined,
      loading: true,
    });
  });
});

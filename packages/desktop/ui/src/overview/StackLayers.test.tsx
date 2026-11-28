// @vitest-environment jsdom
// A stack overview's list of the stack's layers: a button for each, with the tree's rails.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../../test/classes.ts';
import { cleanUp, click, render } from '../../test/dom.ts';
import { StackLayers, type StackLayer } from './StackLayers.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const LAYERS: StackLayer[] = [
  {
    key: '81',
    number: 81,
    title: 'Add the token bucket',
    state: 'merged',
    summary: { kind: 'tldr', text: 'Requests now wait for a token.' },
  },
  {
    key: '82',
    number: 82,
    title: 'Refill buckets on a timer',
    state: 'open',
    review: 'approved',
    summary: { kind: 'description', text: 'Moves the refill off the request path.' },
  },
  {
    key: '83',
    number: 83,
    title: 'Expose bucket metrics',
    state: 'draft',
    summary: { kind: 'none' },
  },
  {
    key: '84',
    number: 84,
    title: 'Docs for limits',
    state: 'open',
    review: 'required',
    sitsOn: 82,
    summary: { kind: 'reading' },
  },
  {
    key: '85',
    number: 85,
    title: 'Limits for internal tools',
    state: 'closed',
    sitsOn: 82,
    summary: { kind: 'description', text: 'Per-key overrides.' },
  },
];

/** The row of layer `key`. */
function rowOf(host: HTMLElement, key: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)!;
}

describe('StackLayers', () => {
  it('is a list of the layers, each its title, number, state and summary', () => {
    const host = render(<StackLayers layers={LAYERS} current="82" />);
    const list = host.querySelector('[role="list"]')!;
    expect(list.getAttribute('aria-label')).toBe('Layers');
    expect([...list.querySelectorAll('[role="listitem"]')].map((item) => item.textContent)).toEqual(
      [
        'Add the token bucket#81MergedRequests now wait for a token.',
        'Refill buckets on a timer#82ApprovedMoves the refill off the request path.',
        'Expose bucket metrics#83DraftNo description',
        'Docs for limits#84Review required',
        'Limits for internal tools#85ClosedPer-key overrides.',
      ],
    );
    expect(rowOf(host, '84').querySelector('.skeleton')).not.toBeNull();
  });

  it('marks the layer in the header, and shows the one clicked', () => {
    const shown = vi.fn<(key: string) => void>();
    const host = render(<StackLayers layers={LAYERS} current="82" onShow={shown} />);
    expect(rowOf(host, '82').getAttribute('aria-current')).toBe('true');
    expect(rowOf(host, '83').hasAttribute('aria-current')).toBe(false);
    expect(rowOf(host, '82').querySelector('.stack-ball-current')).not.toBeNull();
    expect(rowOf(host, '81').querySelector('.stack-ball-merged')).not.toBeNull();
    click(rowOf(host, '83'));
    expect(shown).toHaveBeenCalledWith('83');
  });

  it('draws the tree’s rails: each branch bends off the trunk, and the bottom’s starts at its ball', () => {
    const host = render(<StackLayers layers={LAYERS} />);
    const shape = (key: string) => {
      const row = rowOf(host, key);
      const rail = row.querySelector('[aria-hidden]')!;
      return [
        row.classList.contains('stack-branch') && 'branch',
        row.classList.contains('stack-sprout') && 'elbow',
        row.classList.contains('stack-trunk') && 'trunk',
        rail.classList.contains('stack-rail-sprout') && 'starts',
        rail.classList.contains('stack-rail-last') && 'ends',
      ]
        .filter(Boolean)
        .join(' ');
    };
    expect(Object.fromEntries(LAYERS.map(({ key }) => [key, shape(key)]))).toEqual({
      81: 'starts',
      82: '',
      83: '',
      84: 'branch elbow trunk starts ends',
      85: 'branch elbow starts ends',
    });
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    const host = render(<StackLayers layers={LAYERS} current="82" />);
    expect(await missingRules(host)).toEqual([]);
  });
});

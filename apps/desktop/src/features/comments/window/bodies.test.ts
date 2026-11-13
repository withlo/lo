import { describe, expect, it, vi } from 'vitest';

import type { Bodies } from '../contract.ts';
import { BodyStore, FIRST_WAIT } from './bodies.ts';

const DESCRIPTION = { kind: 'description' } as const;
const post = (id: string) => ({ kind: 'post', id }) as const;

/** A store whose waits run when a test says, and the asks it made. */
function storeOf(answer: (posts: string[], description: boolean) => Promise<Bodies>) {
  const waits: { run: () => void; wait: number }[] = [];
  const asks: { view: string; posts: string[]; description: boolean }[] = [];
  let now = 1_000;
  const store = new BodyStore({
    ask: (view, posts, description) => {
      asks.push({ view, posts, description });
      return answer(posts, description);
    },
    now: () => now,
    later: (run, wait) => {
      const entry = { run, wait };
      waits.push(entry);
      return () => waits.splice(waits.indexOf(entry), 1);
    },
    log: () => undefined,
  });
  return {
    store,
    asks,
    waits,
    /** Runs the waits due, and lets their asks answer. */
    tick: async () => {
      for (const { run } of waits.splice(0)) run();
      await vi.waitFor(() => Promise.resolve());
    },
    pass: (ms: number) => {
      now += ms;
    },
  };
}

const answered = (posts: string[], description: boolean): Promise<Bodies> =>
  Promise.resolve({
    description: description ? '<p>Description</p>' : null,
    posts: posts.filter((id) => id !== 'gone').map((id) => ({ id, html: `<p>${id}</p>` })),
    gone: posts.filter((id) => id === 'gone'),
  });

describe('BodyStore', () => {
  it('asks for the posts wanted together in one ask, and holds what came back', async () => {
    const { store, asks, tick } = storeOf(answered);
    const heard = vi.fn<() => void>();
    store.subscribe('v1', post('a'), heard);
    store.want('v1', post('a'));
    store.want('v1', post('gone'));
    store.want('v1', DESCRIPTION);
    await tick();
    expect(asks).toEqual([{ view: 'v1', posts: ['a', 'gone'], description: true }]);
    expect(store.held('v1', post('a'))).toEqual({ html: '<p>a</p>', at: 1_000 });
    expect(store.held('v1', DESCRIPTION)?.html).toBe('<p>Description</p>');
    expect(store.gone('v1', post('gone'))).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    store.want('v1', post('a'));
    store.want('v1', post('gone'));
    await tick();
    expect(asks).toHaveLength(1);
  });

  it('asks a hundred at a time, one ask at a time', async () => {
    const { store, asks, tick } = storeOf(answered);
    for (let at = 0; at < 150; at += 1) store.want('v1', post(`p${at}`));
    await tick();
    await vi.waitFor(() => expect(asks).toHaveLength(2));
    expect(asks.map((ask) => ask.posts.length)).toEqual([100, 50]);
    expect(store.held('v1', post('p149'))).toBeDefined();
  });

  it('asks again for a post it holds, once its images’ addresses are old', async () => {
    const { store, asks, tick, pass } = storeOf(answered);
    store.want('v1', post('a'));
    await tick();
    pass(4 * 60_000);
    store.again('v1', post('a'));
    await tick();
    expect(asks).toHaveLength(2);
    expect(store.held('v1', post('a'))?.at).toBe(1_000 + 4 * 60_000);
  });

  it('tries a failed ask again after a wait that doubles', async () => {
    let fail = 2;
    const { store, asks, waits, tick } = storeOf((posts, description) =>
      fail-- > 0 ? Promise.reject(new Error('offline')) : answered(posts, description),
    );
    store.want('v1', post('a'));
    await tick();
    expect(waits.map(({ wait }) => wait)).toEqual([FIRST_WAIT]);
    await tick();
    expect(waits.map(({ wait }) => wait)).toEqual([2 * FIRST_WAIT]);
    await tick();
    expect(asks).toHaveLength(3);
    expect(store.held('v1', post('a'))).toBeDefined();
  });

  it('forgets a closed tab’s views, and asks nothing more for them', async () => {
    const { store, asks, waits, tick } = storeOf(answered);
    store.want('v1', post('a'));
    store.want('v2', post('b'));
    store.keepOnly(new Set(['v2']));
    expect(waits).toHaveLength(1);
    await tick();
    expect(asks.map((ask) => ask.view)).toEqual(['v2']);
    expect(store.held('v1', post('a'))).toBeUndefined();
  });
});

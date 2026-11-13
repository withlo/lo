import { describe, expect, it, vi } from 'vitest';

import type { Bodies } from '../contract.ts';
import { BodyStore, FIRST_WAIT } from './bodies.ts';

const DESCRIPTION = { kind: 'description' } as const;
const post = (id: string) => ({ kind: 'post', id }) as const;

/** A post's Markdown, the version of it its HTML is read for. */
const TEXT = 'Some text';

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
    store.want('v1', post('a'), TEXT);
    store.want('v1', post('gone'), TEXT);
    store.want('v1', DESCRIPTION, TEXT);
    await tick();
    expect(asks).toEqual([{ view: 'v1', posts: ['a', 'gone'], description: true }]);
    expect(store.held('v1', post('a'), TEXT)).toEqual({
      html: '<p>a</p>',
      at: 1_000,
      version: TEXT,
    });
    expect(store.held('v1', DESCRIPTION, TEXT)?.html).toBe('<p>Description</p>');
    expect(store.gone('v1', post('gone'), TEXT)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    store.want('v1', post('a'), TEXT);
    store.want('v1', post('gone'), TEXT);
    await tick();
    expect(asks).toHaveLength(1);
  });

  it('shows an edited post from its new Markdown, and asks for its HTML again', async () => {
    const { store, asks, tick } = storeOf(answered);
    const heard = vi.fn<() => void>();
    store.subscribe('v1', post('a'), heard);
    store.want('v1', post('a'), 'Old text');
    await tick();
    expect(store.held('v1', post('a'), 'Old text')?.html).toBe('<p>a</p>');
    // Edited: the HTML read for the old text isn't the post's.
    expect(store.held('v1', post('a'), 'Edited text')).toBeUndefined();
    store.want('v1', post('a'), 'Edited text');
    await tick();
    expect(asks.map((ask) => ask.posts)).toEqual([['a'], ['a']]);
    expect(store.held('v1', post('a'), 'Edited text')?.version).toBe('Edited text');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('holds what an ask brought for the version it asked for, when the post was edited meanwhile', async () => {
    let answer: (() => void) | undefined;
    const { store, asks, tick } = storeOf(
      (posts, description) =>
        new Promise((resolve) => {
          answer = () => resolve(answered(posts, description));
        }),
    );
    store.want('v1', post('a'), 'Old text');
    await tick();
    store.want('v1', post('a'), 'Edited text');
    answer?.();
    await vi.waitFor(() => expect(asks).toHaveLength(2));
    expect(store.held('v1', post('a'), 'Edited text')).toBeUndefined();
    answer?.();
    await vi.waitFor(() =>
      expect(store.held('v1', post('a'), 'Edited text')?.version).toBe('Edited text'),
    );
  });

  it('asks again for the text a post shows when it was edited back while it was read', async () => {
    let answer: (() => void) | undefined;
    const { store, asks, tick } = storeOf((posts, description) => {
      const ready = answered(posts, description);
      return asks.length === 1
        ? ready
        : new Promise((resolve) => {
            answer = () => resolve(ready);
          });
    });
    store.want('v1', post('a'), 'Old text');
    await tick();
    store.want('v1', post('a'), 'Edited text');
    await tick();
    // Edited back while the edit's HTML is read: what's held is the old text's still.
    store.want('v1', post('a'), 'Old text');
    expect(store.held('v1', post('a'), 'Old text')).toBeDefined();
    answer?.();
    await vi.waitFor(() => expect(asks).toHaveLength(3));
    expect(store.held('v1', post('a'), 'Old text')).toBeUndefined();
    answer?.();
    await vi.waitFor(() =>
      expect(store.held('v1', post('a'), 'Old text')?.version).toBe('Old text'),
    );
  });

  it('asks a hundred at a time, one ask at a time', async () => {
    const { store, asks, tick } = storeOf(answered);
    for (let at = 0; at < 150; at += 1) store.want('v1', post(`p${at}`), TEXT);
    await tick();
    await vi.waitFor(() => expect(asks).toHaveLength(2));
    expect(asks.map((ask) => ask.posts.length)).toEqual([100, 50]);
    expect(store.held('v1', post('p149'), TEXT)).toBeDefined();
  });

  it('asks again for a post it holds, once its images’ addresses are old', async () => {
    const { store, asks, tick, pass } = storeOf(answered);
    store.want('v1', post('a'), TEXT);
    await tick();
    pass(4 * 60_000);
    store.again('v1', post('a'), TEXT);
    await tick();
    expect(asks).toHaveLength(2);
    expect(store.held('v1', post('a'), TEXT)?.at).toBe(1_000 + 4 * 60_000);
  });

  it('tries a failed ask again after a wait that doubles', async () => {
    let fail = 2;
    const { store, asks, waits, tick } = storeOf((posts, description) =>
      fail-- > 0 ? Promise.reject(new Error('offline')) : answered(posts, description),
    );
    store.want('v1', post('a'), TEXT);
    await tick();
    expect(waits.map(({ wait }) => wait)).toEqual([FIRST_WAIT]);
    await tick();
    expect(waits.map(({ wait }) => wait)).toEqual([2 * FIRST_WAIT]);
    await tick();
    expect(asks).toHaveLength(3);
    expect(store.held('v1', post('a'), TEXT)).toBeDefined();
  });

  it('forgets a closed tab’s views, and asks nothing more for them', async () => {
    const { store, asks, waits, tick } = storeOf(answered);
    store.want('v1', post('a'), TEXT);
    store.want('v2', post('b'), TEXT);
    store.keepOnly(new Set(['v2']));
    expect(waits).toHaveLength(1);
    await tick();
    expect(asks.map((ask) => ask.view)).toEqual(['v2']);
    expect(store.held('v1', post('a'), TEXT)).toBeUndefined();
  });
});

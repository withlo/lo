import { describe, expect, it, vi } from 'vitest';

import { EXCERPT_SOURCE, EXCERPTS_AN_ASK } from '../jobs.ts';
import { ExcerptStore, KEPT } from './excerpts.ts';

/** A store whose asks run when a test says, and the asks it made. */
function storeOf(read: (bodies: string[]) => Promise<readonly string[]>) {
  const waits: (() => void)[] = [];
  const asks: string[][] = [];
  const logged: string[] = [];
  const store = new ExcerptStore({
    read: (bodies) => {
      asks.push(bodies);
      return read(bodies);
    },
    later: (run) => {
      waits.push(run);
      return () => waits.splice(waits.indexOf(run), 1);
    },
    log: (line) => logged.push(line),
  });
  return {
    store,
    asks,
    logged,
    /** Runs the asks due, and lets their answers come. */
    tick: async () => {
      for (const run of waits.splice(0)) run();
      await vi.waitFor(() => Promise.resolve());
    },
  };
}

/** Stands in for the background process: words only. */
const words = (bodies: string[]): Promise<readonly string[]> =>
  Promise.resolve(bodies.map((body) => body.replaceAll('**', '')));

describe('ExcerptStore', () => {
  it('shows nothing of a comment until its opening is read, then its words', async () => {
    const { store, tick } = storeOf(words);
    const heard = vi.fn<() => void>();
    store.subscribe(heard);
    store.want(['**Use** the guide']);
    expect(store.of('**Use** the guide')).toBe('');
    await tick();
    expect(store.of('**Use** the guide')).toBe('Use the guide');
    expect(heard).toHaveBeenCalledOnce();
    expect(store.version).toBe(1);
  });

  it('asks once for the comments wanted together, and never for one it holds or has none to read', async () => {
    const { store, asks, tick } = storeOf(words);
    store.want(['one', 'two', 'one', '', '  \n']);
    await tick();
    expect(asks).toEqual([['one', 'two']]);
    store.want(['two', 'three']);
    await tick();
    expect(asks).toEqual([['one', 'two'], ['three']]);
    expect(store.of('')).toBe('');
  });

  it('reads only the opening of a long comment, and holds it under that', async () => {
    const { store, asks, tick } = storeOf(words);
    const long = `${'x'.repeat(EXCERPT_SOURCE)}tail`;
    store.want([long]);
    await tick();
    expect(asks).toEqual([['x'.repeat(EXCERPT_SOURCE)]]);
    expect(store.of(`${'x'.repeat(EXCERPT_SOURCE)}another tail`)).toBe('x'.repeat(EXCERPT_SOURCE));
  });

  it('asks for no more than it may at once, then for the rest', async () => {
    const { store, asks, tick } = storeOf(words);
    store.want(Array.from({ length: EXCERPTS_AN_ASK + 2 }, (_, index) => `comment ${index}`));
    await tick();
    expect(asks.map((each) => each.length)).toEqual([EXCERPTS_AN_ASK]);
    await tick();
    expect(asks.map((each) => each.length)).toEqual([EXCERPTS_AN_ASK, 2]);
    expect(store.of(`comment ${EXCERPTS_AN_ASK + 1}`)).toBe(`comment ${EXCERPTS_AN_ASK + 1}`);
  });

  it('gives up an ask that fails, says so, and asks again for a comment wanted again', async () => {
    let fail = true;
    const { store, asks, logged, tick } = storeOf((bodies) =>
      fail ? Promise.reject(new Error('The process stopped.')) : words(bodies),
    );
    const heard = vi.fn<() => void>();
    store.subscribe(heard);
    store.want(['one']);
    await tick();
    expect(logged).toEqual(["Lo couldn't read comments' openings: The process stopped."]);
    expect(store.of('one')).toBe('');
    expect(heard).not.toHaveBeenCalled();
    // Nothing asks again by itself.
    await tick();
    expect(asks).toHaveLength(1);
    fail = false;
    store.want(['one']);
    await tick();
    expect(store.of('one')).toBe('one');
  });

  it('keeps the newest openings, and lets the oldest go', async () => {
    const { store, tick } = storeOf(words);
    store.want(Array.from({ length: EXCERPTS_AN_ASK }, (_, index) => `old ${index}`));
    await tick();
    for (let round = 0; round < KEPT / EXCERPTS_AN_ASK; round++) {
      store.want(Array.from({ length: EXCERPTS_AN_ASK }, (_, index) => `new ${round} ${index}`));
      await tick();
    }
    expect(store.of('old 0')).toBe('');
    expect(store.of(`new ${KEPT / EXCERPTS_AN_ASK - 1} 0`)).toBe(
      `new ${KEPT / EXCERPTS_AN_ASK - 1} 0`,
    );
  });
});

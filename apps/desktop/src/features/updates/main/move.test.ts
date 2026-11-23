// Moving Lo to Applications: it asks before it replaces a Lo already there, and only then, and moves
// nothing unless the reader says "Replace Lo".

import { describe, expect, it, vi } from 'vitest';

import { type Conflict, type Move, moveAsking } from './move.ts';

/**
 * Electron's move, with `there` in Applications: it answers each Lo in the way with `conflict`, and
 * moves unless that says not to. What it was asked, and whether it moved, are kept.
 */
function electron(there: Conflict | undefined) {
  const asked: Conflict[] = [];
  let moved = 0;
  const move: Move = (conflict) => {
    if (there !== undefined) {
      asked.push(there);
      if (!conflict(there)) return false;
    }
    moved++;
    return true;
  };
  return { move, asked, moved: () => moved };
}

describe('moveAsking', () => {
  it('moves without asking when nothing is in Applications', async () => {
    const { move, moved } = electron(undefined);
    const ask = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
    await expect(moveAsking(move, ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(moved()).toBe(1);
  });

  it('asks before it replaces a Lo there, and moves nothing until the reader says to', async () => {
    const { move, asked, moved } = electron('exists');
    const answer = Promise.withResolvers<boolean>();
    const ask = vi.fn<() => Promise<boolean>>(() => answer.promise);
    const moving = moveAsking(move, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(moved()).toBe(0);
    answer.resolve(true);
    await expect(moving).resolves.toBe(true);
    // Asked again by the second move, which replaces it.
    expect(asked).toEqual(['exists', 'exists']);
    expect(moved()).toBe(1);
  });

  it('moves nothing when the reader cancels', async () => {
    const { move, moved } = electron('exists');
    await expect(moveAsking(move, () => Promise.resolve(false))).resolves.toBe(false);
    expect(moved()).toBe(0);
  });

  it('brings a Lo running from Applications forward without asking, as Electron does', async () => {
    const { move, moved } = electron('existsAndRunning');
    const ask = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
    await expect(moveAsking(move, ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(moved()).toBe(1);
  });
});

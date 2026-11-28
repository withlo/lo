// @vitest-environment jsdom
// `⏎` on an overview note's lines: just after `c` was refused there, it takes the toast's offer of
// a comment on the file, as `⏎` on a thread's line does; else it opens the note.

import type { LineTarget } from '@lo/ui/commands';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as comments from '../../comments/window/shared.ts';
import type * as tabShared from '../../tab/window/shared.ts';
import type * as tabs from './tabs.ts';
import type * as whole from './whole.ts';

const now = vi.hoisted(() => ({ offer: false, openNote: vi.fn<(at: unknown) => boolean>() }));

vi.mock('../../comments/window/shared.ts', async (real) => ({
  ...(await real<typeof comments>()),
  takeFileOffer: () => {
    const had = now.offer;
    now.offer = false;
    return had;
  },
}));
vi.mock('../../tab/window/shared.ts', async (real) => ({
  ...(await real<typeof tabShared>()),
  activeTab: () => ({ kind: 'pull', id: 'v1' }),
}));
vi.mock('./tabs.ts', async (real) => ({
  ...(await real<typeof tabs>()),
  drawnFor: () => ({ view: { openNote: now.openNote }, tab: 'v1' }),
}));
vi.mock('./whole.ts', async (real) => ({
  ...(await real<typeof whole>()),
  wholeDrawn: () => false,
}));

const { default: feature } = await import('./index.ts');

const LINE: LineTarget = { kind: 'line', at: { file: 'f0', side: 'new', line: 6 }, note: true };

/** Runs "Show overview note" on `target`, as `⏎` there does. */
function enter(target: LineTarget): void {
  const command = feature.commands?.find((each) => each.id === 'diff.overviewNote');
  void command?.handler?.run(target, undefined);
}

describe('⏎ on an overview note’s line', () => {
  beforeEach(() => {
    now.offer = false;
    now.openNote.mockClear();
  });

  test('opens the note', () => {
    enter(LINE);
    expect(now.openNote).toHaveBeenCalledWith({ file: 'f0', side: 'new', line: 6 });
  });

  test('just after the line refused a comment, takes the offer of one on the file instead', () => {
    now.offer = true;
    enter(LINE);
    expect(now.openNote).not.toHaveBeenCalled();
    // Taken once: the next opens the note.
    enter(LINE);
    expect(now.openNote).toHaveBeenCalledTimes(1);
  });
});

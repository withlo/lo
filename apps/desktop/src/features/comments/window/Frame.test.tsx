// @vitest-environment jsdom
// A comment box's frame: drawn in the parts the code view makes, at once, so the box is as tall as
// it'll be before it's on screen.

import type { Composer } from '@lo/ui/code';
import { expect, test, vi } from 'vitest';

import { Box } from './boxes.ts';
import { frameOf } from './Frame.tsx';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));

/** A part of a box, empty. */
function part(): HTMLElement {
  return document.createElement('div');
}

test('the frame is drawn as the box is made, not after', () => {
  const box = new Box(
    'v1',
    {
      kind: 'thread',
      commit: 'a'.repeat(40),
      path: 'src/backoff.ts',
      lines: { start: null, end: { side: 'RIGHT', number: 5 } },
    },
    'review',
    'Kept',
  );
  box.set({ restored: Date.parse('2026-11-13T09:12:00') });
  const parts = {
    head: part(),
    note: part(),
    preview: part(),
    dropzone: part(),
    uploads: part(),
    foot: part(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the frame reads none of it here.
  const frame = frameOf(box)(parts, {} as Composer);
  expect(parts.head.textContent).toContain('On line 5, new side');
  expect(parts.note.textContent).toContain('Restored your draft from');
  expect(parts.foot.textContent).toContain('Add to review');
  frame.destroy();
});

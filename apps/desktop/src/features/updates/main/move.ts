// Moving Lo to Applications, asking first when a Lo is there already. Electron's move takes its
// answer to a Lo in the way at once, from inside the move, while Lo's own dialog answers later; so
// Lo first moves replacing nothing, which stops at a Lo in the way, asks the reader only then, and
// moves again once the reader says "Replace Lo". Where Lo can't write Applications, Electron asks
// macOS for an administrator's password and replaces a Lo there without asking Lo first, so Lo asks
// nothing then, as before. Nothing here calls Electron, so it runs under unit tests.

import type { Asked } from '../../ask/service.ts';

/** A Lo already in Applications, `exists`, or one running from there, `existsAndRunning`. */
export type Conflict = 'exists' | 'existsAndRunning';

/**
 * Electron's move, `app.moveToApplicationsFolder`: `true` once it has moved Lo, `false` when it
 * hasn't, as when `conflict` answers `false`, which leaves everything as it was.
 */
export type Move = (conflict: (kind: Conflict) => boolean) => boolean;

/** The question Lo asks before it replaces a Lo already in Applications. "Cancel" is the default. */
export const REPLACE: Asked = {
  title: 'Replace Lo in Applications?',
  detail: 'The copy in Applications moves to the Trash. This copy takes its place and restarts.',
  action: 'Replace Lo',
};

/**
 * Moves Lo to Applications with `move`, asking with `ask` before it replaces a Lo already there:
 * `false` when the reader didn't say to. When the Lo there is running, it comes forward and this
 * one quits, as Electron does by default, and nothing is asked. Throws when the move fails.
 */
export async function moveAsking(move: Move, ask: () => Promise<boolean>): Promise<boolean> {
  let inTheWay = false;
  const moved = move((kind) => {
    if (kind === 'existsAndRunning') return true;
    inTheWay = true;
    return false;
  });
  if (!inTheWay) return moved;
  if (!(await ask())) return false;
  return move(() => true);
}

// The note over a pull request's tab's diff: what it compares, "r3 → r5 · since last opened",
// and what to know about how, such as that it compares across a rebase. One line, the same height
// from the first frame, so the diff below never moves. It ends with what the diff puts there. While
// the diff holds the view it drew, the note says what that view compares, and changes with it.

import { Key } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useDiffFiles } from '../../diff/window/shared.ts';
import { usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { noteOf, runNoteOf } from './model.ts';
import { catchUp, views } from './store.ts';

const tones = {
  plain: 'text-fg-muted',
  info: 'bg-info-bg text-fg',
  warn: 'bg-warning-bg text-fg',
} as const;

export function Note({
  tab,
  end,
  held = false,
}: {
  tab: PullTab;
  end?: ReactNode;
  held?: boolean;
}) {
  useKeys();
  const view = useTabState(views, tab.id);
  const pull = usePull(tab.id);
  const files = useDiffFiles(tab.id);
  useEffect(() => {
    // A run of layers compares no revisions, so it has no comparison to ask for.
    if (tab.run === undefined && views.get(tab.id) === undefined) catchUp(tab.id);
  }, [tab.id, tab.run]);
  const [first] = registry().keysOf('revisions.picker');
  const keys = first && keyLabels(first, registry().system);
  const now = tab.run
    ? runNoteOf(tab.run.layers, files?.uncompared === true)
    : noteOf(pull?.acting?.kind === 'anonymous' ? undefined : view);
  // What the view on screen compares, while the diff holds it.
  const drawn = useRef(now);
  useLayoutEffect(() => {
    if (!held) drawn.current = now;
  });
  const note = held ? drawn.current : now;
  return (
    <div
      className={`flex h-diffnote-h flex-none items-center gap-8 border-b border-border-subtle px-16 text-small ${tones[note.tone]}`}
    >
      {/* The note is what it says; the diff's controls after it are their own. */}
      <div
        role="note"
        aria-label="Comparison"
        data-lo-diffnote={note.tone}
        className="flex min-w-0 flex-1 items-center gap-8"
      >
        <span className="min-w-0 flex-1 truncate" title={note.text}>
          {note.text}
        </span>
        {keys && !tab.run && pull?.acting?.kind !== 'anonymous' && (
          <span className="flex flex-none items-center gap-6 text-fg-muted">
            <Key keys={keys} quiet decorative /> Compare revisions
          </span>
        )}
      </div>
      {end}
    </div>
  );
}

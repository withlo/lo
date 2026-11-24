// The note over a pull request's tab's diff: what it compares, "r3 → r5 · since last opened",
// and what to know about how, such as that it compares across a rebase. One line, the same height
// from the first frame, so the diff below never moves. It ends with the bar's controls: Compare
// revisions, then what the diff puts there. While the diff holds the view it drew, the note says
// what that view compares, and changes with it.

import { HintButton, HintRow, Tooltip } from '@lo/ui';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import { useKeys } from '../../../window/commands/registry.ts';
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
      className={`flex h-diffnote-h flex-none items-center gap-16 border-b border-border-subtle px-16 text-small ${tones[note.tone]}`}
    >
      {/* The note is what it says; the bar's controls after it are their own. */}
      <div
        role="note"
        aria-label="Comparison"
        data-lo-diffnote={note.tone}
        className="flex min-w-0 flex-1 items-center"
      >
        <Tooltip label={note.text} cut>
          <span className="min-w-0 flex-1 truncate">{note.text}</span>
        </Tooltip>
      </div>
      {/* Once what it says is cut to nothing, the controls give up their key chips, then Compare
          revisions, before they'd touch. */}
      <HintRow className="min-w-0 items-center gap-16" more={BAR_STEPS}>
        {!tab.run && pull?.acting?.kind !== 'anonymous' && (
          <span data-gives="hint" className="flex flex-none">
            <HintButton command="revisions.picker">Compare revisions</HintButton>
          </span>
        )}
        {end}
      </HintRow>
    </div>
  );
}

/** What the bar gives up after its controls' key chips: Compare revisions, which the header has. */
const BAR_STEPS = ['hint'] as const;

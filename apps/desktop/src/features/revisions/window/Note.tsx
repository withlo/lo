// The note over a pull request's tab's diff: what it compares, "r3 → r5 · since last opened",
// and what to know about how, such as that it compares across a rebase. One line, the same height
// from the first frame, so the diff below never moves. It ends with the bar's controls: Compare
// revisions, then what the diff puts there. Narrow, the bar gives up its controls' key chips, then
// Compare revisions, then the note's facts after the first, last first: what it compares is never
// cut. While the diff holds the view it drew, the note says what that view compares, and changes
// with it.

import { Glyphs, HintButton, HintRow, Tooltip } from '@lo/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

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
  const [first = '', ...rest] = note.text.split(FACTS);
  const count = rest.length;
  // What the bar gives up after its key chips: Compare revisions, then the note's facts after its
  // first, last first, each named by its turn. A note of as many facts gives up the same steps.
  const steps = useMemo(
    () => ['hint', ...Array.from({ length: count }, (_, index) => `drop${index + 1}`)],
    [count],
  );
  return (
    <HintRow
      className={`h-diffnote-h flex-none items-center gap-16 border-b border-border-subtle px-16 text-small ${tones[note.tone]}`}
      more={steps}
    >
      {/* The note is what it says; the bar's controls after it are their own. */}
      <div
        role="note"
        aria-label="Comparison"
        data-lo-diffnote={note.tone}
        className="flex min-w-0 flex-1 items-center"
      >
        <Tooltip label={note.text} cut>
          {/* Never cut: what it compares stays whole, and each fact after it is whole or gone. */}
          <span data-fit className="flex min-w-0 overflow-hidden">
            <span className="flex-none">
              <Glyphs text={first} />
            </span>
            {rest.map((fact, index) => (
              <span
                // The last fact goes first, and given up, it's still heard.
                data-gives={`drop${count - index}`}
                data-heard
                key={`${index}:${fact}`}
                className="flex-none whitespace-pre"
              >
                {FACTS}
                <Glyphs text={fact} />
              </span>
            ))}
          </span>
        </Tooltip>
      </div>
      {!tab.run && pull?.acting?.kind !== 'anonymous' && (
        <span data-gives="hint" className="flex flex-none">
          <HintButton command="revisions.picker">Compare revisions</HintButton>
        </span>
      )}
      {end}
    </HintRow>
  );
}

/** What joins the note's facts: "base → r2 · whole pull request". */
const FACTS = ' · ';

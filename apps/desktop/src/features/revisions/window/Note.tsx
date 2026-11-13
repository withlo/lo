// The note over a pull request's tab's diff: what it compares, "r3 → r5, since you last looked",
// and what to know about how, such as that it compares across a rebase. One line, the same height
// from the first frame, so the diff below never moves.

import { Key } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useEffect } from 'react';

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

export function Note({ tab }: { tab: PullTab }) {
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
  const note = tab.run
    ? runNoteOf(tab.run.layers, files?.uncompared === true)
    : noteOf(pull?.acting?.kind === 'anonymous' ? undefined : view, keys?.join(''));
  return (
    <div
      role="note"
      aria-label="What the diff compares"
      data-lo-diffnote={note.tone}
      className={`flex h-diffnote-h flex-none items-center gap-8 border-b border-border-subtle px-16 text-small ${tones[note.tone]}`}
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
  );
}

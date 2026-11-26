// The header's revision button, showing what's compared ("r3 → r5"), and the revision picker it
// opens, as `gv` does.

import { Glyphs, keyAria, RevisionPicker, Ticks, Tooltip, useControl } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useEffect, useState } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { closePicker, compareEnds, compareShortcut, openPicker, setEnd } from './actions.ts';
import {
  comparisonLabel,
  overviewNote,
  reasonOf,
  rowsOf,
  shortcutRows,
  comparedOf,
} from './model.ts';
import { catchUp, marked, pickers, views } from './store.ts';

/** The first key of command `id`, as this system shows it. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The lines under the picker's rows, each its own, or none. */
function notesOf(lines: readonly (string | undefined)[]) {
  const said = lines.filter((line) => line !== undefined);
  if (said.length === 0) return undefined;
  return said.map((line) => (
    <div key={line}>
      <Ticks text={line} />
    </div>
  ));
}

export function Revisions({ tab }: { tab: PullTab }) {
  useKeys();
  const view = useTabState(views, tab.id);
  const picker = useTabState(pickers, tab.id);
  const marks = useTabState(marked, tab.id);
  const pull = usePull(tab.id);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const control = useControl('revisions.picker');
  useEffect(() => {
    if (tab.run === undefined && views.get(tab.id) === undefined) catchUp(tab.id);
    // The picker closes as its tab leaves the screen.
    return () => {
      if (pickers.get(tab.id).open) pickers.set(tab.id, { open: false });
    };
  }, [tab.id, tab.run]);
  // A run of layers compares no revisions.
  if (tab.run || pull?.acting?.kind !== 'account' || !view || view.status === 'signIn') return null;
  const compared = view.comparison ?? view.pending;
  const reason = compared ? reasonOf(view, compared) : undefined;
  const rows = picker.open ? rowsOf(view, Date.now(), marks) : [];
  const ends = picker.open ? picker.ends : undefined;
  const asked = ends && comparedOf(ends);
  const command = control?.label ?? 'Compare revisions…';
  return (
    <>
      {/* Its face says what's compared; its tooltip and description name its command. */}
      <Tooltip label={command} keys={control?.keys}>
        <button
          ref={setButton}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={picker.open}
          {...keyAria(control?.keys, control?.shortcut, command)}
          data-lo-revisions=""
          className="inline-flex h-row-h flex-none items-center gap-6 rounded-sm border border-border ps-8 pe-6 whitespace-nowrap text-fg code-small hover:bg-hover"
          onClick={() => {
            if (picker.open) closePicker();
            else openPicker();
          }}
        >
          <span>
            <Glyphs
              text={
                view.status === 'loading' || !compared
                  ? 'Reading revisions…'
                  : comparisonLabel(view, compared)
              }
            />
          </span>
          {reason && <span className="text-fg-muted text-small">{reason}</span>}
        </button>
      </Tooltip>
      <RevisionPicker
        open={picker.open}
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
        anchor={button}
        container={document.getElementById('root')}
        scope="revisions"
        heading={<span>Compare revisions</span>}
        openKeys={keyOf('revisions.picker')}
        rows={rows}
        focused={picker.open ? picker.focused : undefined}
        ends={ends}
        onRowClick={(key) => setEnd(key)}
        shortcuts={shortcutRows(view, {
          review: keyOf('revisions.sinceReview'),
          seen: keyOf('revisions.sinceSeen'),
          whole: keyOf('revisions.whole'),
        })}
        onShortcut={(id) => {
          void compareShortcut(id === 'seen' ? 'seen' : id === 'review' ? 'review' : 'whole');
        }}
        compare={{
          label: asked ? `Compare ${comparisonLabel(view, asked)}` : 'Compare',
          keys: keyOf('revisions.compare'),
        }}
        onCompare={() => {
          void compareEnds();
        }}
        note={notesOf([
          view.waitingFor === 'local'
            ? 'Fetching local copy…'
            : view.waitingFor === 'git'
              ? 'Git wasn’t found'
              : undefined,
          overviewNote(view, marks),
        ])}
      />
    </>
  );
}

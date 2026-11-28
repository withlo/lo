// The page the give-up spec drives: a pull request's header, whose second row gives up its branches,
// and a merge status in a row that gives up its detail, in a frame the spec narrows and widens
// without drawing either again; a pull request's header whose first row holds the merge status
// and "Submit review…", in a frame of its own; and a note over a diff, as the comparison's is,
// whose facts after the first go one at a time, still heard, in a third.

import { useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { useGiveUp } from '../../src/giveUp.ts';
import { HintRow } from '../../src/HintRow.tsx';
import { Key } from '../../src/Key.tsx';
import { MergeStatus } from '../../src/MergeStatus.tsx';
import { PRHeader } from '../../src/PRHeader.tsx';

const DETAIL_STEPS = ['detail'];

/** A merge status in a row of its own, as wide as what it draws, which gives up its detail. */
function StatusRow() {
  const row = useRef<HTMLDivElement>(null);
  useGiveUp(row, DETAIL_STEPS);
  return (
    <div id="status" ref={row} className="give-up flex min-w-0 items-center">
      <MergeStatus
        kind="blocked"
        verdict="Can’t merge"
        detail="review required"
        keys={['m']}
        onClick={() => {}}
      />
    </div>
  );
}

/**
 * The note's facts, as a comparison over a rebase that conflicted says them: the last two longer
 * than the first two together, so what's given up but still heard is wider than what's drawn.
 */
const FACTS = [
  'base → r5',
  'whole pull request',
  '3 files conflicted in the rebase',
  'includes the base branch’s changes',
];
const NOTE_STEPS = ['hint', 'drop1', 'drop2', 'drop3'];

/**
 * A note over a diff, as the comparison's is: what it compares whole, then each fact after it, the
 * last first, whole or out of sight and still heard, then a control that goes before any of them.
 */
function NoteRow() {
  const [first, ...rest] = FACTS;
  return (
    <HintRow
      className="h-diffnote-h items-center gap-16 border-b border-border-subtle px-16 text-fg-muted text-small"
      more={NOTE_STEPS}
    >
      <div role="note" className="flex min-w-0 flex-1 items-center">
        <span data-fit className="flex min-w-0 overflow-hidden">
          <span className="flex-none">{first}</span>
          {rest.map((fact, index) => (
            <span
              data-gives={`drop${rest.length - index}`}
              data-heard
              key={fact}
              className="flex-none whitespace-pre"
            >
              {` · ${fact}`}
            </span>
          ))}
        </span>
      </div>
      <span data-gives="hint" className="flex flex-none">
        <Button variant="ghost" size="sm">
          Compare revisions
          <Key keys={['⌘', 'R']} decorative />
        </Button>
      </span>
    </HintRow>
  );
}

function Scene() {
  return (
    <>
      <div id="frame" style={{ width: '1440px' }}>
        {/* Each row alone in its own, beside a spacer, so it's as wide as what it draws. */}
        <PRHeader
          number={80}
          state="open"
          title="Make the tab strip narrower"
          author="rozed-bot"
          head={{ branch: 'app/a-feature-branch-with-a-long-name' }}
          base={{ branch: 'main' }}
        >
          <span className="min-w-8 flex-1" />
        </PRHeader>
        <div className="flex min-w-0 items-center">
          <StatusRow />
          <span className="min-w-8 flex-1" />
        </div>
      </div>
      <div id="header" style={{ width: '1440px' }}>
        <PRHeader
          number={94}
          state="open"
          title="Comments fixture: back off between retries"
          author="rozed-bot"
          head={{ branch: 'comments/feature' }}
          base={{ branch: 'comments/base' }}
          acting={{ login: 'rozed-bot' }}
          status={
            <>
              <MergeStatus
                kind="ready"
                verdict="Ready to merge"
                detail="Merge commit into comments/base"
                keys={['m']}
                onClick={() => {}}
              />
              <Button>
                Submit review…
                <Key keys={['⌘', '⏎']} decorative />
              </Button>
            </>
          }
        />
      </div>
      <div id="note" style={{ width: '1440px' }}>
        <NoteRow />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Scene />);

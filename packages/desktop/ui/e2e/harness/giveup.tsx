// The page the give-up spec drives: a pull request's header, whose second row gives up its branches,
// and a merge status in a row that gives up its detail, in a frame the spec narrows and widens
// without drawing either again; and a pull request's header whose first row holds the merge status
// and "Submit review…", in a frame of its own.

import { useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { useGiveUp } from '../../src/giveUp.ts';
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
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Scene />);

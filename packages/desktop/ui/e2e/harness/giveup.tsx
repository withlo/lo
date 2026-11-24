// The page the give-up spec drives: a pull request's header, whose second row gives up its branches,
// and a merge status, which gives up its detail, in a frame the spec narrows and widens without
// drawing either again.

import { createRoot } from 'react-dom/client';

import { MergeStatus } from '../../src/MergeStatus.tsx';
import { PRHeader } from '../../src/PRHeader.tsx';

function Scene() {
  return (
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
        <MergeStatus
          kind="blocked"
          verdict="Can’t merge"
          detail="1 check failed · 1 unresolved · review required"
          keys={['m']}
          onClick={() => {}}
        />
        <span className="min-w-8 flex-1" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Scene />);

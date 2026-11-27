// The page the narrow spec drives: an out-of-date overview's callout, in an overview's frame the
// spec narrows and widens, and a long path in a box of its own.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { OutOfDate } from '../../src/overview/Stale.tsx';
import { WholePath } from '../../src/WholePath.tsx';

/** Says what changed since, as the spec asks, the way a local copy's answer would. */
let say: (detail: string) => void = () => {};

function Scene() {
  const [detail, setDetail] = useState('');
  say = setDetail;
  return (
    <>
      {/* An overview's article, with none of its room around it, as wide as the spec says. */}
      <div id="frame" className="lo-ov grid-cols-1" style={{ width: '680px', height: 'auto' }}>
        <article className="lo-ov__article p-0">
          <OutOfDate
            title="Written for r1 · now r2"
            detail={detail}
            actions={<Button size="sm">Compare r1 → r2</Button>}
          />
        </article>
      </div>
      <div id="path" className="text-small" style={{ width: '200px' }}>
        <WholePath
          path="~/Library/Application Support/Lo/cache/repos/github.com/rozed-dev/e2e.git"
          className="text-fg code-small"
        />
      </div>
      <div id="long" className="text-small" style={{ width: '120px' }}>
        <WholePath
          path="~/a-folder-whose-name-is-longer-than-the-line/e2e.git"
          className="text-fg code-small"
        />
      </div>
    </>
  );
}

window.addEventListener('say', (event) => {
  if (event instanceof CustomEvent && typeof event.detail === 'string') say(event.detail);
});
createRoot(document.getElementById('root')!).render(<Scene />);

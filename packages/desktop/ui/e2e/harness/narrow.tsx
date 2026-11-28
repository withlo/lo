// The page the narrow spec drives: an out-of-date overview's callout, and a code block whose lines
// changed since, each in an overview's frame the spec narrows and widens, a long path in a box of
// its own, a new thread's comment on its way beside the card that will take its place, between
// lines, on one line and beside them in a popover, and a card whose head has more than it can say.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { CodeBlock, CodeBody, CodeFlag } from '../../src/overview/CodeBlock.tsx';
import { OutOfDate } from '../../src/overview/Stale.tsx';
import { SentPost, Thread } from '../../src/Thread.tsx';
import { WholePath } from '../../src/WholePath.tsx';

/** What a new thread is on, as its head row says it where it's more than one line. */
const LINES = 'Line 3, removed, to line 5';
const SAID = 'This retries forever.';

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
      <div id="flagframe" className="lo-ov grid-cols-1" style={{ width: '680px', height: 'auto' }}>
        <article className="lo-ov__article p-0">
          <CodeBlock
            target={{ kind: 'code', path: 'src/parser.ts', lines: { start: 7, end: 10 } }}
            flag={
              <CodeFlag action={<Button size="sm">Compare r1 → r2</Button>}>
                Line 7 changed in r2 · lines added after line 8 · showing r1
              </CodeFlag>
            }
          >
            <CodeBody rows={2} />
          </CodeBlock>
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
      {/* The two at once, each as wide as the other. */}
      <div id="sent" style={{ width: '480px' }}>
        <SentPost state="Unresolved" lines={LINES} author="tess-okafor" body={<p>{SAID}</p>} />
      </div>
      <div id="landed" style={{ width: '480px' }}>
        <Thread
          comments={[
            { id: 'c1', author: 'tess-okafor', when: 'just now', mine: true, body: <p>{SAID}</p> },
          ]}
          resolved={false}
          open
          lines={LINES}
          canResolve
          menu
        />
      </div>
      {/* A thread on one line, whose card's head says no lines: its comment on its way, and it. */}
      <div id="sentone" style={{ width: '480px' }}>
        <SentPost state="Unresolved" author="tess-okafor" body={<p>{SAID}</p>} />
      </div>
      <div id="landedone" style={{ width: '480px' }}>
        <Thread
          comments={[
            { id: 'c1', author: 'tess-okafor', when: 'just now', mine: true, body: <p>{SAID}</p> },
          ]}
          resolved={false}
          open
          canResolve
          menu
        />
      </div>
      {/* A thread whose head has more to say than any narrow card has room for. */}
      <div id="crowded" style={{ width: '480px' }}>
        <Thread
          comments={[
            { id: 'c1', author: 'tess-okafor', when: '2 d ago', body: <p>{SAID}</p> },
            {
              id: 'c2',
              author: 'ravi-k',
              when: 'just now',
              mine: true,
              pending: true,
              body: <p>Yes.</p>,
            },
          ]}
          resolved={false}
          open
          outdated
          tags={[{ label: 'Draft' }]}
          lines={LINES}
          canResolve
          menu
        />
      </div>
      {/* The same beside the lines, in a popover. */}
      <div id="sentpop" className="bg-bg-overlay" style={{ width: '480px' }}>
        <SentPost
          state="Unresolved"
          lines={LINES}
          popover
          author="tess-okafor"
          body={<p>{SAID}</p>}
        />
      </div>
      <div id="landedpop" className="bg-bg-overlay" style={{ width: '480px' }}>
        <Thread
          comments={[
            { id: 'c1', author: 'tess-okafor', when: 'just now', mine: true, body: <p>{SAID}</p> },
          ]}
          resolved={false}
          open
          lines={LINES}
          canResolve
          menu
          variant="popover"
        />
      </div>
    </>
  );
}

window.addEventListener('say', (event) => {
  if (event instanceof CustomEvent && typeof event.detail === 'string') say(event.detail);
});
createRoot(document.getElementById('root')!).render(<Scene />);

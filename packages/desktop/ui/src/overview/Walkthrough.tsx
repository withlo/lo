import { useLayoutEffect, useRef, type ReactNode } from 'react';

import type { Overview, Walkthrough as WalkthroughNode } from '@lo/artifact';

import { Button } from '../Button.tsx';
import { MarkdownBlocks } from '../markdown/index.ts';
import { PathName } from './CodeBlock.tsx';
import { setStepper } from './moving.ts';
import { lineRange } from './placeholders.tsx';

/**
 * A walkthrough: its numbered steps beside a code view that follows the current one, `code`, which
 * whoever has the code draws. Its height comes from its steps' words alone, since the code view's
 * box is the same height whatever it holds, so the code coming moves nothing. A step clicked,
 * Previous and Next, or the block keys through `stepIn`, ask for another with `step`.
 */
export function Walkthrough({
  node,
  current,
  step,
  code,
}: {
  node: WalkthroughNode;
  current: number;
  step: (index: number) => void;
  code: ReactNode;
}) {
  const count = node.steps.length;
  const shown = node.steps[current];
  const own = useRef<HTMLDivElement>(null);
  const latest = useRef({ current, count, step });
  latest.current = { current, count, step };
  useLayoutEffect(() => {
    const element = own.current;
    if (!element) return undefined;
    return setStepper(element, (by) => {
      const now = latest.current;
      const next = now.current + by;
      if (next < 0 || next >= now.count) return false;
      now.step(next);
      return true;
    });
  }, []);
  return (
    <div ref={own} className="lo-walk">
      <div className="lo-walk__head">
        <span className="lo-walk__title">{node.title}</span>
        <span>
          Step {current + 1} of {count}
        </span>
        <span className="lo-walk__nav">
          <Button
            variant="ghost"
            size="sm"
            disabled={current === 0}
            onClick={() => step(current - 1)}
          >
            Previous
          </Button>
          <Button size="sm" disabled={current >= count - 1} onClick={() => step(current + 1)}>
            Next
          </Button>
        </span>
      </div>
      <div className="lo-walk__body">
        <ol className="lo-walk__steps">
          {node.steps.map((each, index) => (
            <li
              key={index}
              className={index < current ? 'lo-walk__step is-done' : 'lo-walk__step'}
              aria-current={index === current ? 'step' : undefined}
              onClick={(event) => {
                // A link in the step follows itself.
                if (event.target instanceof Element && event.target.closest('a, button')) return;
                if (index !== current) step(index);
              }}
            >
              <div className="min-w-0 space-y-6">
                <MarkdownBlocks<Overview> blocks={each.children} />
              </div>
            </li>
          ))}
        </ol>
        <div className="lo-walk__code">
          {shown && (
            <div className="lo-walk__codehead">
              <span className="min-w-0 truncate">
                <PathName path={shown.target.path} />
              </span>
              <span>{lineRange(shown.target.lines)}</span>
            </div>
          )}
          <div className="lo-walk__view">{code}</div>
        </div>
      </div>
    </div>
  );
}

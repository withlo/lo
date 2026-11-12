import { useId, useRef, useState } from 'react';

import type { Overview, Tabs as TabsBlock } from '@lo/artifact';

import { MarkdownBlocks, useRendering } from '../markdown/index.ts';

/**
 * Parallel views of one thing, one shown at a time. The tab shown takes focus by `Tab`; `←` and
 * `→` switch to the one before and after, `Home` and `End` to the first and last.
 */
export function Tabs({ node }: { node: TabsBlock }) {
  const { anchors } = useRendering<Overview>();
  const own = `tabs${useId().replace(/[^\w-]/g, '')}`;
  const [chosen, setShown] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (index: number) => anchors.own(`${own}-tab${index}`);
  const panelId = (index: number) => anchors.own(`${own}-panel${index}`);
  const count = node.tabs.length;
  // A block with fewer tabs than the one chosen from shows its last.
  const shown = Math.max(0, Math.min(chosen, count - 1));
  const show = (index: number) => {
    setShown(index);
    buttons.current[index]?.focus();
  };
  return (
    <div className="lo-tabs">
      <div
        className="lo-tabs__list"
        role="tablist"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          const next =
            event.key === 'ArrowRight'
              ? (shown + 1) % count
              : event.key === 'ArrowLeft'
                ? (shown - 1 + count) % count
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? count - 1
                    : undefined;
          if (next === undefined || count === 0) return;
          event.preventDefault();
          show(next);
        }}
      >
        {node.tabs.map((tab, index) => (
          <button
            key={index}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            id={tabId(index)}
            role="tab"
            aria-selected={index === shown}
            aria-controls={panelId(index)}
            tabIndex={index === shown ? 0 : -1}
            className="lo-tabs__tab"
            onClick={() => setShown(index)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {node.tabs.map((tab, index) => (
        <div
          key={index}
          id={panelId(index)}
          role="tabpanel"
          aria-labelledby={tabId(index)}
          hidden={index !== shown}
          className="lo-tabs__panel"
        >
          <MarkdownBlocks<Overview> blocks={tab.children} />
        </div>
      ))}
    </div>
  );
}

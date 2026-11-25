// The page the empty-state spec reads: `EmptyState` in each of its fits, in boxes the size of where
// each sits in the window, a view's in a box too narrow for its words and one too short for them,
// and in both themes. Its buttons are commands, from a registry of the engine's test commands.

import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { testCommands } from '../../test/commands.ts';
import { holdRegistry } from '../../src/commands/control.ts';
import { Registry } from '../../src/commands/registry.ts';
import { EmptyState } from '../../src/EmptyState.tsx';
import { TooltipGroup } from '../../src/Tooltip.tsx';

holdRegistry(new Registry({ system: 'mac', commands: testCommands() }));

/** A box of `width` by `height` px, named for the spec, on the ground a view sits on. */
function Box({
  name,
  width,
  height,
  children,
}: {
  name: string;
  width: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      data-box={name}
      className="flex flex-col rounded-md border border-border-subtle bg-bg"
      style={{ width: `${width}px`, height: height === undefined ? undefined : `${height}px` }}
    >
      {children}
    </div>
  );
}

function Sheet() {
  return (
    <div className="flex flex-wrap items-start gap-16 bg-bg-chrome p-24 text-fg">
      <Box name="view" width={640} height={360}>
        <EmptyState
          icon="git-pull-request"
          title="No pull requests yet"
          line="Pull requests you open are listed here."
          actions={['tab.open', 'tab.close']}
        />
      </Box>
      <Box name="view-wide" width={1000} height={240}>
        <EmptyState
          icon="file-diff"
          title="No files changed in a run of revisions with a long name that wraps onto two lines"
        />
      </Box>
      <Box name="panel" width={340} height={360}>
        <EmptyState
          fit="panel"
          icon="layers"
          title="No threads for these 3 layers"
          line="Each layer has its own."
          actions={['tab.close']}
        />
      </Box>
      <Box name="narrow" width={120} height={360}>
        <EmptyState
          fit="panel"
          icon="message-square"
          title="No threads yet"
          actions={['tab.close']}
        />
      </Box>
      <Box name="short" width={400} height={120}>
        <EmptyState
          icon="file-text"
          title="No overview yet"
          line="A coding agent writes one from this prompt."
          actions={['tab.open']}
        />
      </Box>
      <Box name="list" width={640}>
        <EmptyState
          fit="list"
          icon="user-round"
          title="No accounts"
          line="Public pull requests open without one."
          actions={['tab.close']}
        />
      </Box>
      <Box name="list-narrow" width={400}>
        <EmptyState
          fit="list"
          icon="server"
          title="No language servers running"
          line="Language servers for open pull requests are listed here."
          actions={['tab.close']}
        />
      </Box>
      <Box name="row" width={400}>
        <div className="p-6">
          <div className="flex min-h-palette-item-h items-center px-12 py-6">
            <EmptyState fit="row" icon="search-x" title="No commands match “queue”" />
          </div>
        </div>
      </Box>
      <Box name="row-cut" width={200}>
        <div className="p-6">
          <div className="flex min-h-palette-item-h items-center px-12 py-6">
            <EmptyState fit="row" icon="search-x" title="No files match “a-very-long-query”" />
          </div>
        </div>
      </Box>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <TooltipGroup>
    <div data-sheet="dark">
      <Sheet />
    </div>
    <div data-sheet="light" data-theme="light" data-drawn>
      <Sheet />
    </div>
  </TooltipGroup>,
);

// The header's buttons for the row, a map of it: the left panel's at the start of its cluster, Code
// beside's after the view switch, and the right panel's, the threads, at its end, with what its
// views count for the tab, such as its unresolved threads. Each is pressed while what it stands for
// is drawn, so one put away for room reads unpressed, and pressing it asks for it, so the others
// give way. One that can't be drawn beside a view at its minimum is dimmed, and says why.

import { Button, Icon, useControl, type IconName } from '@lo/ui';
import type { ReactNode } from 'react';

import { ViewPart, type View } from '../../../window/slots.tsx';
import {
  useBesideCramped,
  useBesideDrawn,
  usePanelCramped,
  usePanelDrawn,
  togglePanel,
  type Edge,
  type There,
} from './layout.ts';
import { toggleBeside, toggleRight } from './panels.ts';
import type { PullTab, RightToggle as Toggle } from './shared.ts';

/** Each panel's button: its command, its icon, and its name while its command isn't there. */
const TOGGLES = {
  left: { command: 'tab.leftPanel', icon: 'panel-left', name: 'Left panel' },
  threads: { command: 'tab.rightPanel', icon: 'panel-right', name: 'Threads panel' },
} as const;

/** What the dimmed button says, as its command does. */
const CRAMPED = 'Widen the window first';

interface ToggleProps {
  readonly toggle: { readonly command: string; readonly icon: IconName; readonly name: string };
  /** What it stands for is drawn. */
  readonly drawn: boolean;
  /** What it stands for can't be drawn beside a view at its minimum. */
  readonly cramped: boolean;
  readonly onClick: () => void;
  readonly children?: ReactNode;
  readonly [data: `data-${string}`]: string | undefined;
}

/**
 * A button of the header's cluster, one shape for all three: its tooltip is its command's label and
 * key, or why it's dimmed.
 */
function RowToggle({ toggle, drawn, cramped, onClick, children, ...data }: ToggleProps) {
  const control = useControl(toggle.command);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={drawn}
      disabled={cramped}
      hint={cramped ? CRAMPED : (control?.label ?? toggle.name)}
      hintKeys={cramped ? undefined : control?.keys}
      hintShortcut={cramped ? undefined : control?.shortcut}
      onClick={onClick}
      {...data}
    >
      <Icon name={toggle.icon} size={16} />
      <span className="sr-only">{toggle.name}</span>
      {children}
    </Button>
  );
}

interface PanelToggleProps {
  readonly edge: Edge;
  readonly there: There;
  readonly onClick: () => void;
  readonly children?: ReactNode;
}

/** A panel's button. */
function PanelToggle({ edge, there, onClick, children }: PanelToggleProps) {
  const drawn = usePanelDrawn(edge, there);
  const cramped = usePanelCramped(edge, there);
  return (
    <RowToggle
      toggle={TOGGLES[edge]}
      drawn={drawn}
      cramped={cramped}
      onClick={onClick}
      data-lo-left-toggle={edge === 'left' ? '' : undefined}
      data-lo-right-toggle={edge === 'threads' ? '' : undefined}
    >
      {children}
    </RowToggle>
  );
}

/** Opens and closes the left panel, as `⌘\` does. */
export function LeftToggle({ there }: { there: There }) {
  return <PanelToggle edge="left" there={there} onClick={() => togglePanel('left')} />;
}

/** Code beside's button: what it shows and does. */
const BESIDE = { command: 'tab.beside', icon: 'columns-2', name: 'Code beside' } as const;

/** Puts the code beside a reading view, or takes it away, as `o` does. */
export function BesideToggle({ there }: { there: There }) {
  const drawn = useBesideDrawn(there);
  const cramped = useBesideCramped(there);
  return (
    <RowToggle
      toggle={BESIDE}
      drawn={drawn}
      cramped={cramped}
      onClick={toggleBeside}
      data-lo-beside-toggle=""
    />
  );
}

/** A view of the right panel, as the tab lists them. */
type Right = View<{ tab: PullTab }> & Toggle;

/** Opens and closes the right panel, as `⌘⇧\` does, showing what its views count for `tab`. */
export function RightToggle({
  tab,
  there,
  views,
}: {
  tab: PullTab;
  there: There;
  views: readonly Right[];
}) {
  return (
    <PanelToggle edge="threads" there={there} onClick={toggleRight}>
      {views.map((view) => {
        const Count = view.count;
        return (
          Count && (
            <ViewPart key={view.id} id={view.id}>
              <Count tab={tab} />
            </ViewPart>
          )
        );
      })}
    </PanelToggle>
  );
}

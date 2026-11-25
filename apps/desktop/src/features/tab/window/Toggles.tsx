// The header's buttons for the panels, at either end of its cluster, as the panels are at either end
// of the row: the left panel's, and the right panel's, the threads, with what its views count for
// the tab, such as its unresolved threads. Each is pressed while its panel is drawn, so one put away
// for room reads unpressed, and pressing it asks for it, so the other gives way. One that can't be
// drawn beside a view at its minimum is dimmed, and says why.

import { Button, Icon, useControl } from '@lo/ui';
import type { ReactNode } from 'react';

import { ViewPart, type View } from '../../../window/slots.tsx';
import { togglePanel, usePanelCramped, usePanelDrawn, type Edge, type There } from './layout.ts';
import { toggleRight } from './panels.ts';
import type { PullTab, RightToggle as Toggle } from './shared.ts';

/** Each panel's button: its command, its icon, and its name while its command isn't there. */
const TOGGLES = {
  left: { command: 'tab.leftPanel', icon: 'panel-left', name: 'Left panel' },
  threads: { command: 'tab.rightPanel', icon: 'panel-right', name: 'Threads panel' },
} as const;

/** What the dimmed button says, as its command does. */
const CRAMPED = 'Widen the window first';

interface PanelToggleProps {
  readonly edge: Edge;
  readonly there: There;
  readonly onClick: () => void;
  readonly children?: ReactNode;
}

/** A panel's button: its tooltip is its command's label and key, or why it's dimmed. */
function PanelToggle({ edge, there, onClick, children }: PanelToggleProps) {
  const toggle = TOGGLES[edge];
  const drawn = usePanelDrawn(edge, there);
  const cramped = usePanelCramped(edge, there);
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
      data-lo-left-toggle={edge === 'left' ? '' : undefined}
      data-lo-right-toggle={edge === 'threads' ? '' : undefined}
    >
      <Icon name={toggle.icon} size={16} />
      <span className="sr-only">{toggle.name}</span>
      {children}
    </Button>
  );
}

/** Opens and closes the left panel, as `⌘\` does. */
export function LeftToggle({ there }: { there: There }) {
  return <PanelToggle edge="left" there={there} onClick={() => togglePanel('left')} />;
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

// The page the motion spec drives: one of each shared piece that comes, goes or waits, with a log
// of what each found the moment it was asked to close.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { Collapse } from '../../src/Collapse.tsx';
import { ContextMenu, type ContextMenuAnchor } from '../../src/ContextMenu.tsx';
import { Dialog, type DialogState } from '../../src/Dialog.tsx';
import { Icon } from '../../src/Icon.tsx';
import { Loading } from '../../src/Loading.tsx';
import { LogoMotion, type LogoPlay } from '../../src/LogoMotion.tsx';
import { motionReduced, setMotion } from '../../src/motion.ts';
import { Popover, PopoverTitle } from '../../src/Popover.tsx';
import { reveal } from '../../src/reveal.ts';
import { SegmentedControl } from '../../src/SegmentedControl.tsx';
import { Switch } from '../../src/Switch.tsx';
import { ToastStack, type StackedToast } from '../../src/Toast.tsx';
import { Tooltip, TooltipGroup } from '../../src/Tooltip.tsx';

export type Theme = 'dark' | 'light';

/** What a popup found as it was asked to close: whether it was still drawn, and where focus was. */
export interface Closed {
  what: string;
  /** Whether the popup was still in the page, as it is while it fades. */
  there: boolean;
  /** The id of what had focus. */
  focus: string | undefined;
  /** What a menu was closed with. */
  chosen?: string | undefined;
}

const closed: Closed[] = [];

function note(what: string, popup: string, chosen?: string): void {
  closed.push({
    what,
    there: document.querySelector(popup) !== null,
    focus: document.activeElement?.id || undefined,
    chosen,
  });
}

const MENU = [
  [
    { id: 'show', label: 'Show in the diff', keys: ['⏎'] },
    { id: 'viewed', label: 'Mark viewed', keys: ['e'] },
  ],
  [{ id: 'path', label: 'Copy the path', keys: ['y', 'p'] }],
];

const LONG = `Copied ${'packages/desktop/ui/src/'.repeat(12)}Toast.tsx`.replaceAll('/', '_');

function Scene() {
  const [dialog, setDialog] = useState(false);
  const [step, setStep] = useState<DialogState>('ask');
  const [menu, setMenu] = useState<{ at: ContextMenuAnchor; keyed: boolean } | undefined>();
  const [popover, setPopover] = useState(false);
  const [reply, setReply] = useState(false);
  const [toasts, setToasts] = useState<readonly StackedToast[]>([]);
  const [logo, setLogo] = useState<LogoPlay | undefined>();
  const [waiting, setWaiting] = useState(false);
  const [view, setView] = useState<'overview' | 'diff' | 'timeline'>('overview');
  const [on, setOn] = useState(false);
  const [row, setRow] = useState<HTMLElement | null>(null);

  return (
    <TooltipGroup>
      <div className="flex h-full flex-col items-start gap-16 overflow-clip bg-bg p-32 text-fg text-ui">
        <div className="flex items-center gap-8">
          <Button
            id="open-dialog"
            variant="primary"
            onClick={() => {
              setStep('ask');
              setDialog(true);
            }}
          >
            Sign in
          </Button>
          <Button
            id="hinted"
            icon
            aria-label="Next unread file"
            hint="Next unread file"
            hintKeys={[']', 'f']}
          >
            <Icon name="chevron-right" size={16} />
          </Button>
          <Button disabled>Open</Button>
          <Button variant="primary" disabled>
            Merge
          </Button>
          <Button busy working="Merging" variant="primary">
            Merge #264
          </Button>
          <Switch checked={on} onCheckedChange={setOn} aria-label="Merge when ready" />
          <Switch checked={false} onCheckedChange={() => {}} disabled aria-label="Start at login" />
        </div>

        {/* A path drawn whole, and over it one cut short in a narrow row, whose tooltip shows under it. */}
        <div className="flex flex-col gap-4 text-small">
          <Tooltip label="src/a.ts" cut>
            <span id="whole" className="self-start truncate">
              src/a.ts
            </span>
          </Tooltip>
          <Tooltip label="src/graphql/cost/estimate.ts" cut>
            <span id="cut" className="block max-w-tab-w-min min-w-0 truncate">
              src/graphql/cost/estimate.ts
            </span>
          </Tooltip>
        </div>

        <SegmentedControl
          label="View"
          kind="views"
          value={view}
          onChange={setView}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'diff', label: 'Diff' },
            { value: 'timeline', label: 'Timeline' },
          ]}
        />

        <div
          id="row"
          ref={setRow}
          tabIndex={0}
          className="rounded-sm px-8 py-4 focus-visible:shadow-ring"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ at: { x: event.clientX, y: event.clientY }, keyed: false });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'm') return;
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ at: { x: box.left, y: box.bottom }, keyed: true });
          }}
        >
          src/Toast.tsx
        </div>
        <ContextMenu
          open={menu !== undefined}
          onOpenChange={(open) => {
            if (!open) setMenu(undefined);
          }}
          label="File actions"
          anchor={menu?.at}
          sections={MENU}
          finalFocus={row ?? undefined}
          highlightFirst={menu?.keyed}
          onClosed={(chosen) => note('menu', '[role="menu"]', chosen)}
        />

        <Popover
          open={popover}
          onOpenChange={setPopover}
          onClosed={() => note('popover', '#details')}
          className="flex flex-col gap-8 px-12 py-12"
          trigger={
            <button id="open-popover" type="button" className="rounded-sm px-8 py-4">
              TypeScript
            </button>
          }
        >
          <div id="details">
            <PopoverTitle className="m-0 text-ui-medium">TypeScript stopped</PopoverTitle>
            <Button id="restart" size="sm">
              Start again
            </Button>
          </div>
        </Popover>

        <div className="flex w-full flex-col">
          <Button id="reply" onClick={() => setReply((was) => !was)}>
            Reply
          </Button>
          <Collapse open={reply}>
            <p id="replying" className="m-0 py-12">
              Write a reply
            </p>
          </Collapse>
          <p id="below" className="m-0">
            What’s below it
          </p>
        </div>

        <div className="flex items-center gap-8">
          <Button
            id="toast"
            onClick={() =>
              setToasts((was) => [
                ...was,
                { id: String(was.length + 1), tone: 'success', title: `Merged #${was.length + 1}` },
              ])
            }
          >
            Toast
          </Button>
          <Button
            id="long-toast"
            onClick={() => setToasts([{ id: 'long', tone: 'info', title: LONG }])}
          >
            Long toast
          </Button>
          {(['unmeld', 'meld', 'kiss'] as const).map((play) => (
            <Button key={play} id={`play-${play}`} onClick={() => setLogo(play)}>
              {play}
            </Button>
          ))}
          <Button id="wait" onClick={() => setWaiting((was) => !was)}>
            Wait
          </Button>
        </div>
        <div id="logo" className="flex h-64 items-center gap-16">
          {logo !== undefined && (
            <LogoMotion
              key={logo}
              play={logo}
              className="size-48"
              onDone={() => note(`logo ${logo}`, '#logo circle')}
            />
          )}
          {waiting && <Loading status="Fetching diff…" />}
        </div>

        <div id="pane" className="h-64 w-full overflow-auto">
          {['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map((name) => (
            <p key={name} id={`line-${name}`} className="m-0 h-row-h">
              {name}
            </p>
          ))}
        </div>
      </div>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        onClosed={() => {
          note('dialog', '[role="dialog"]');
          // As a caller that focuses its main button each time its step changes, a frame or two
          // on, does: the dialog is still leaving then, and takes no focus.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => document.getElementById('copy-code')?.focus()),
          );
        }}
        title="Sign in to GitHub"
        size="sm"
        state={step}
        action={{ label: 'Sign in', working: 'Signing in', onRun: () => setStep('failed') }}
        problem={{ title: 'GitHub didn’t answer.', details: 'POST /login/device/code 502' }}
        leaveKeys={['Esc']}
      >
        <div className="flex items-center gap-8">
          <p className="m-0 flex-1">GitHub opens in your browser, where you enter a code.</p>
          <Button
            id="copy-code"
            variant="ghost"
            icon
            aria-label="Copy the code"
            hint="Copy the code"
            hintKeys={['y']}
            hintShortcut="y"
          >
            <Icon name="copy" size={16} />
          </Button>
        </div>
      </Dialog>
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((was) => was.filter((toast) => toast.id !== id))}
      />
    </TooltipGroup>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
root.style.height = '100vh';
// Moves are on whatever the machine's own setting, until a test turns them off.
setMotion('full');
createRoot(root).render(<Scene />);

const moves = {
  closed,
  setMotion,
  reduced: motionReduced,
  theme(theme: Theme): void {
    // On the page itself, as the app sets it, so what's drawn outside the root follows too.
    document.documentElement.dataset['theme'] = theme;
  },
  reveal(id: string): void {
    const line = document.getElementById(id);
    if (line) reveal(line, { block: 'start' });
  },
};

Object.assign(window, { moves });

declare global {
  interface Window {
    /** What the motion spec drives the page with. */
    moves: typeof moves;
  }
}

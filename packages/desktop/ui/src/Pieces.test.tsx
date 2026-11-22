// @vitest-environment jsdom
// The shared pieces that wait, fail and float: a button at work, a control that can't be used, a
// problem, a button that copies, a dialog's foot, a popover, the toast stack, a view that waits and
// the mark that moves.

import { act, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render, rerender } from '../test/dom.ts';
import { Button } from './Button.tsx';
import { COPIED_MS, CopyButton, CopyRoute } from './CopyButton.tsx';
import { Dialog, type DialogState } from './Dialog.tsx';
import { Loading, LOADING_DELAY_MS, LOADING_SLOW_MS } from './Loading.tsx';
import { LogoMotion } from './LogoMotion.tsx';
import { setMotion } from './motion.ts';
import { Popover } from './Popover.tsx';
import { Problem } from './Problem.tsx';
import { Switch } from './Switch.tsx';
import { TOAST_MAX, TOAST_MS, ToastStack, type StackedToast } from './Toast.tsx';
import { TOOLTIP_DELAY, TooltipGroup } from './Tooltip.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  setMotion('system');
  vi.useRealTimers();
});

const buttons = (root: ParentNode) =>
  [...root.querySelectorAll('button')].map((button) => button.textContent);

/** What a button that does work says now: the face of it that shows. */
const says = (button: Element | null | undefined) =>
  button?.querySelector('span > span:not([aria-hidden])')?.textContent;

/** What a copy button's face reads now, and what the live region beside it says. */
const reading = (host: HTMLElement) => ({
  face: [...host.querySelectorAll('button .inline-grid > span')].find(
    (face) => !face.classList.contains('invisible'),
  )?.textContent,
  said: host.querySelector('[role="status"]')?.textContent,
});

/** Presses the first button in `host`, and lets what it started settle. */
async function press(host: HTMLElement): Promise<void> {
  await act(async () => {
    host.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Presses `Esc` in the dialog that's open. */
function escape(): void {
  act(() => {
    popup().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** Lets `ms` pass on the fake clock. */
function later(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Lets a popup take focus, which it does as it mounts. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('a button at work', () => {
  it('says what it’s doing in the room it kept, keeps focus, and does nothing when pressed', () => {
    const run = vi.fn<() => void>();
    const host = render(
      <Button variant="primary" busy={false} working="Merging" onClick={run}>
        Merge #264
      </Button>,
    );
    const button = host.querySelector('button')!;
    // Both faces are there from the start, so its width is the wider one's throughout.
    expect(button.querySelectorAll('.inline-grid > span')).toHaveLength(2);
    expect(says(button)).toBe('Merge #264');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    button.focus();
    rerender(
      host,
      <Button variant="primary" busy working="Merging" onClick={run}>
        Merge #264
      </Button>,
    );
    expect(says(button)).toBe('Merging');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('.spinner')).not.toBeNull();
    // Not `disabled`: focus stays on it.
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it('is plain when it never works', () => {
    const host = render(<Button>Close</Button>);
    expect(host.querySelector('button')?.innerHTML).toBe('Close');
  });

  it('keeps its label, and so its name, when it has no words of its own for the wait', () => {
    const host = render(<Button busy>Fetch</Button>);
    const button = host.querySelector('button')!;
    expect(says(button)).toBe('Fetch');
    expect(button.querySelector('span > span:not([aria-hidden]) .spinner')).not.toBeNull();
  });

  it('holds the room of the widest thing it says, unseen, whatever it says now', () => {
    const stage = (busy: boolean, working: string) => (
      <Button size="sm" busy={busy} working={working} widest="Trusting…">
        Trust repo…
      </Button>
    );
    const host = render(stage(false, 'Waiting…'));
    const button = host.querySelector('button')!;
    const held = () => button.querySelector('.inline-grid > span:last-child')!;
    for (const [busy, working] of [
      [false, 'Waiting…'],
      [true, 'Waiting…'],
      [true, 'Trusting…'],
    ] as const) {
      rerender(host, stage(busy, working));
      expect(says(button)).toBe(busy ? working : 'Trust repo…');
      expect(held().textContent).toBe('Trusting…');
      expect(held().className).toContain('invisible');
      expect(held().getAttribute('aria-hidden')).toBe('true');
      // Beside the ring's room, as the words are while the ring turns.
      expect(held().firstElementChild?.className).toContain('size-8');
    }
  });

  it('gives a screen reader the key its tooltip shows, never the key caps', () => {
    const host = render(
      <>
        <Button
          icon
          aria-label="Command palette"
          hint="Command palette"
          hintKeys={['⌘⇧P']}
          hintShortcut="Meta+Shift+P"
        >
          P
        </Button>
        <Button icon aria-label="Next unread file" hint="Next unread file" hintKeys={[']', 'f']}>
          F
        </Button>
      </>,
    );
    const [chord, sequence] = [...host.querySelectorAll('button')];
    expect(chord?.getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+P');
    expect(sequence?.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(sequence?.getAttribute('aria-description')).toBe('Keys ] then f');
  });
});

describe('a control that can’t be used', () => {
  it('keeps its box: a button its outline and fill, a switch its ring', async () => {
    const host = render(
      <>
        <Button disabled>Open</Button>
        <Button variant="primary" aria-disabled>
          Merge
        </Button>
        <Switch checked={false} onCheckedChange={() => {}} aria-label="Merge when ready" />
        <Switch checked onCheckedChange={() => {}} disabled aria-label="Start at login" />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
    const [plain, primary] = [...host.querySelectorAll('button')];
    for (const button of [plain, primary]) {
      expect(button?.className).toContain('disabled:border-border-subtle');
      expect(button?.className).toContain('not-aria-busy:aria-disabled:bg-bg-element');
      expect(button?.className).not.toContain('disabled:border-transparent');
    }
    const css = await buildCss(['inset-ring-fg-dim']);
    expect(declarations(css, 'inset-ring-fg-dim')).toContain('var(--lo-fg-dim)');
    expect(host.querySelector('[role="switch"]')?.className).toContain('inset-ring-fg-dim');
  });
});

describe('a button that can’t be pressed now', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is dimmed and out of the tab order, and says why in its tooltip and to a screen reader', () => {
    const run = vi.fn<() => void>();
    const host = render(
      <div className="lo-app">
        <TooltipGroup>
          <Button disabled hint="Sign in to comment" hintKeys={['c']} onClick={run}>
            Comment
          </Button>
        </TooltipGroup>
      </div>,
    );
    const button = host.querySelector('button')!;
    // Said to be disabled, not made so: a `disabled` button gets no pointer, and so no tooltip.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.tabIndex).toBe(-1);
    expect(button.getAttribute('aria-description')).toBe('Sign in to comment');
    expect(button.className).toContain('not-aria-busy:aria-disabled:text-fg-disabled');
    click(button);
    expect(run).not.toHaveBeenCalled();
    // The pointer resting on it brings the reason, alone: not its key, which does nothing now.
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: host }));
      button.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: host }));
      button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      vi.advanceTimersByTime(TOOLTIP_DELAY);
    });
    expect(host.querySelector('.tooltip')?.textContent).toBe('Sign in to comment');
  });

  it('is plainly disabled with no reason to give', () => {
    const host = render(<Button disabled>Open</Button>);
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-description')).toBe(false);
  });
});

describe('Problem', () => {
  it('says what failed, why and what to do, and keeps what came back behind Details', async () => {
    const again = vi.fn<() => void>();
    const copy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const host = render(
      <CopyRoute copy={copy}>
        <Problem
          title="Couldn’t fetch the diff"
          reason="GitHub didn’t answer."
          action={{ label: 'Try again', onClick: again }}
          details="GET /repos/withlo/lo/pulls/264 502"
        />
      </CopyRoute>,
    );
    // The alert is what failed and why, and not the buttons after it.
    const alert = host.querySelector('[role="alert"]')!;
    expect([...alert.children].map((line) => line.textContent)).toEqual([
      'Couldn’t fetch the diff',
      'GitHub didn’t answer.',
    ]);
    expect(alert.querySelector('button')).toBeNull();
    expect(host.querySelector('pre')).toBeNull();
    const details = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Details')!;
    expect(details.getAttribute('aria-expanded')).toBe('false');
    click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('pre')?.textContent).toBe('GET /repos/withlo/lo/pulls/264 502');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!);
    expect(again).toHaveBeenCalledTimes(1);
    const copyButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Copy'),
    )!;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    // Through the window's own way to copy.
    expect(copy).toHaveBeenCalledWith('GET /repos/withlo/lo/pulls/264 502');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Copied');
    expect(await missingRules(host)).toEqual([]);
    cleanUp();
    const whole = render(<Problem layout="view" title="Can’t open #264" />);
    expect(await missingRules(whole)).toEqual([]);
  });
});

describe('CopyButton', () => {
  it('reads Copied for two seconds, and not at all when nothing was copied', async () => {
    vi.useFakeTimers();
    let copies = true;
    const host = render(<CopyButton onCopy={() => copies}>Copy the log</CopyButton>);
    // The live region is beside the button, not in it.
    expect(host.querySelector('button [role="status"]')).toBeNull();
    await press(host);
    expect(reading(host)).toEqual({ face: 'Copied', said: 'Copied' });
    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(reading(host)).toEqual({ face: 'Copy the log', said: '' });
    copies = false;
    await press(host);
    expect(reading(host)).toEqual({ face: 'Copy the log', said: '' });
  });

  it('says it couldn’t copy when copying fails, and when nothing gives it a way to', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = render(
      <CopyButton onCopy={() => Promise.reject(new Error('refused'))}>Copy the log</CopyButton>,
    );
    await press(host);
    expect(reading(host)).toEqual({ face: 'Couldn’t copy', said: 'Couldn’t copy' });
    cleanUp();
    // A problem drawn with no `CopyRoute` around it.
    const alone = render(<Problem title="Couldn’t merge #264" details="405" />);
    click([...alone.querySelectorAll('button')].find((b) => b.textContent === 'Details')!);
    await press(alone.querySelector('pre')!.parentElement!);
    expect(reading(alone).said).toBe('Couldn’t copy');
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

const popup = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;

const named = (name: string) =>
  [...popup().querySelectorAll('button')].find(
    (button) => (says(button) ?? button.textContent) === name,
  );

describe('a dialog that does something', () => {
  const run = vi.fn<() => void>();
  const closed = vi.fn<() => void>();
  const dialog = (state: DialogState, open = true) => (
    <Dialog
      open={open}
      onOpenChange={() => {}}
      onClosed={closed}
      title="Merge #264"
      state={state}
      action={{ label: 'Merge #264', working: 'Merging', onRun: run }}
      problem={{ title: 'GitHub refused the merge.', details: '405' }}
    >
      <p>Squash and merge into main.</p>
    </Dialog>
  );

  beforeEach(() => {
    run.mockClear();
    closed.mockClear();
  });

  it('draws its own foot, whose words follow where it has got to', async () => {
    const host = render(dialog('ask'));
    await settle();
    expect(named('Cancel')).toBeDefined();
    // The main button has focus as it opens.
    expect(document.activeElement).toBe(named('Merge #264'));
    click(named('Merge #264')!);
    expect(run).toHaveBeenCalledTimes(1);

    rerender(host, dialog('working'));
    const merging = named('Merging')!;
    expect(merging.getAttribute('aria-busy')).toBe('true');
    // Cancel is dimmed, and says why to a screen reader and in its tooltip. It's the button it
    // was, and so is the main one, which keeps focus.
    const cancel = named('Cancel');
    expect(cancel?.getAttribute('aria-disabled')).toBe('true');
    expect(cancel?.getAttribute('aria-description')).toBe('Wait for it to finish');
    expect(cancel?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(merging);
    click(merging);
    expect(run).toHaveBeenCalledTimes(1);

    rerender(host, dialog('failed'));
    expect(popup().querySelector('[role="alert"]')?.textContent).toContain(
      'GitHub refused the merge.',
    );
    expect(named('Close')).toBeDefined();
    expect(named('Try again')).toBeDefined();
    expect(named('Cancel')).toBeUndefined();

    rerender(host, dialog('done'));
    expect(buttons(popup())).toEqual(['Done']);
    expect(await missingRules(document.body)).toEqual([]);
  });

  it('keeps focus on a main button that can’t run yet, which says why, until it can', async () => {
    const waiting = (disabled?: string, state: DialogState = 'ask') => (
      <Dialog
        open
        onOpenChange={() => {}}
        title="Sign in to GitHub"
        state={state}
        action={{ label: 'Open GitHub', onRun: run, disabled }}
      />
    );
    const host = render(waiting('Getting code'));
    await settle();
    const main = named('Open GitHub')!;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('aria-disabled')).toBe('true');
    expect(main.getAttribute('aria-description')).toBe('Getting code');
    click(main);
    expect(run).not.toHaveBeenCalled();
    rerender(host, waiting());
    // The same button, still with focus, so `⏎` runs it now.
    expect(named('Open GitHub')).toBe(main);
    expect(document.activeElement).toBe(main);
    expect(main.hasAttribute('aria-disabled')).toBe(false);
    click(main);
    expect(run).toHaveBeenCalledTimes(1);
    // Done is that button too, so `⏎` closes the dialog.
    rerender(host, waiting(undefined, 'done'));
    expect(named('Done')).toBe(main);
    expect(document.activeElement).toBe(main);
  });

  it('can’t be left while it works: Esc asks nothing until the work is done', async () => {
    const change = vi.fn<(open: boolean) => void>();
    const asking = (state: DialogState) => (
      <Dialog
        open
        onOpenChange={change}
        title="Merge #264"
        state={state}
        action={{ label: 'Merge #264', working: 'Merging', onRun: run }}
      >
        <p>Squash and merge into main.</p>
      </Dialog>
    );
    const host = render(asking('working'));
    await settle();
    escape();
    expect(change).not.toHaveBeenCalled();
    rerender(host, asking('failed'));
    escape();
    expect(change).toHaveBeenCalledWith(false);
  });

  it('says it has closed the moment it’s asked to, and keeps its words while it leaves', () => {
    const host = render(dialog('ask'));
    expect(closed).not.toHaveBeenCalled();
    rerender(host, dialog('ask', false));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

function Picker({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      label="Revisions"
      trigger={<button type="button">Compare</button>}
    >
      <button type="button" onClick={() => setOpen(false)}>
        r2
      </button>
    </Popover>
  );
}

describe('Popover', () => {
  it('opens from its trigger, and gives focus back and says so as it closes', async () => {
    const closed = vi.fn<() => void>();
    const host = render(<Picker onClosed={closed} />);
    const trigger = host.querySelector('button')!;
    trigger.focus();
    click(trigger);
    await settle();
    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.getAttribute('aria-label')).toBe('Revisions');
    expect(panel.className).toContain('move-pop');
    expect(panel.contains(document.activeElement)).toBe(true);
    click(panel.querySelector('button')!);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(await missingRules(document.body)).toEqual([]);
  });
});

const toast = (id: string): StackedToast => ({ id, tone: 'success', title: `Merged #${id}` });

describe('ToastStack', () => {
  it('sends each toast away after its four seconds, which stop while the pointer is on it', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn<(id: string) => void>();
    const host = render(<ToastStack toasts={[toast('1')]} onDismiss={dismiss} />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Merged #1');
    const place = host.querySelector('.move-pop')!;
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1000);
      place.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(dismiss).not.toHaveBeenCalled();
    act(() => {
      place.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dismiss).toHaveBeenCalledWith('1');
    // Taken out by the caller, it leaves.
    rerender(host, <ToastStack toasts={[]} onDismiss={dismiss} />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('starts a toast’s four seconds again when it’s shown again, and not when it’s drawn again', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn<(id: string) => void>();
    // Drawn again with the same toast, it keeps its time.
    const first = toast('1');
    const host = render(<ToastStack toasts={[first]} onDismiss={dismiss} />);
    later(TOAST_MS - 500);
    rerender(host, <ToastStack toasts={[first]} onDismiss={dismiss} />);
    later(500);
    expect(dismiss.mock.calls).toEqual([['1']]);
    // Shown again, as a new toast with the same id, as a second "Copied" is, it starts over.
    rerender(host, <ToastStack toasts={[toast('2')]} onDismiss={dismiss} />);
    later(TOAST_MS - 500);
    rerender(host, <ToastStack toasts={[toast('2')]} onDismiss={dismiss} />);
    later(1000);
    expect(dismiss.mock.calls).toEqual([['1']]);
    later(TOAST_MS - 1000);
    expect(dismiss.mock.calls).toEqual([['1'], ['2']]);
  });

  it('shows three at most: one more sends the oldest away', async () => {
    const dismiss = vi.fn<(id: string) => void>();
    const four = ['1', '2', '3', '4'].map(toast);
    const host = render(<ToastStack toasts={four} onDismiss={dismiss} />);
    expect(dismiss.mock.calls).toEqual([['1']]);
    expect(host.querySelectorAll('.toast')).toHaveLength(TOAST_MAX);
    expect(await missingRules(host)).toEqual([]);
  });
});

describe('Loading', () => {
  it('shows nothing at first, then the mark over the wait’s name, then what’s slow and Cancel', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn<() => void>();
    const host = render(
      <Loading status="Fetching diff…" slow="Waiting for GitHub…" onCancel={cancel} />,
    );
    const region = host.querySelector('[role="status"]')!;
    expect(region.childElementCount).toBe(0);
    act(() => {
      vi.advanceTimersByTime(LOADING_DELAY_MS);
    });
    expect(region.querySelector('svg')).not.toBeNull();
    expect(region.querySelector('p')?.textContent).toBe('Fetching diff…');
    // Cancel's room is kept, and it can't be reached yet.
    const button = region.querySelector('button')!;
    expect(button.parentElement?.className).toBe('invisible');
    act(() => {
      vi.advanceTimersByTime(LOADING_SLOW_MS);
    });
    expect(region.querySelector('p')?.textContent).toBe('Waiting for GitHub…');
    expect(button.parentElement?.className).toBe('move-swap');
    click(button);
    expect(cancel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await missingRules(host)).toEqual([]);
  });
});

describe('LogoMotion', () => {
  it('draws the mark melted into its corner, ready to move', () => {
    const host = render(<LogoMotion play="unmeld" className="size-mark-lg" />);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Lo');
    // The shapes twice: blurred into one another, and crisp on top.
    expect(svg.querySelectorAll('ellipse')).toHaveLength(2);
    expect(svg.querySelector('filter feColorMatrix')?.getAttribute('values')).toMatch(/48 -26$/);
    expect(svg.querySelector('g[filter]')?.getAttribute('filter')).toBe(
      `url(#${svg.querySelector('filter')?.id})`,
    );
  });

  it('is the mark at rest with Reduce Motion on, and says it’s done at once, except the loop', () => {
    setMotion('reduce');
    const done = vi.fn<() => void>();
    const host = render(<LogoMotion play="kiss" onDone={done} decorative />);
    expect(host.querySelector('ellipse')).toBeNull();
    expect(host.querySelector('circle')?.getAttribute('r')).toBe('21');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(done).toHaveBeenCalledTimes(1);
    rerender(host, <LogoMotion play="meld" onDone={done} decorative />);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

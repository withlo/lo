// @vitest-environment jsdom
// The toasts that offer a newer Lo, with main answered by a stand-in bridge: each state from the
// design in both themes, each button asking main for what it says and only when pressed, and not in
// the moment after a toast comes; a toast that never takes focus, that `Tab` moves through once it
// has it, and that gives it back to the middle when it goes with focus in it; and the toast region
// keeping it below a note that passes.

import { COPIED_MS, CopyRoute } from '@lo/ui';
import { endsTab, findScope, NO_TARGET } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { client } from '../../../window/ipc.ts';
import {
  notice,
  notices,
  Notices,
  NOTICE_TIME,
  withdraw,
} from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { Slot } from '../../../window/slots.tsx';
import { contract as tabs } from '../../tab/contract.ts';
import { toasts } from '../../tab/window/shared.ts';
import { BREW_UPGRADE, RELEASES, releasePage, type Failed, type UpdateState } from '../contract.ts';
import feature from './index.ts';
import { hear } from './actions.ts';
import { GUARD_TIME, Offer, UpdateToast } from './Offer.tsx';
import { showHow, showState, updatesStore } from './store.ts';

/** What main answers on each channel, as `main` has it: a test changes what a channel says. */
const defaults: Record<string, (input: unknown) => unknown> = {
  'updates.read': () => ({ status: 'idle' }),
  'updates.how': () => 'page',
  'updates.check': () => ({ status: 'newest', version: '0.1.0' }),
  'updates.install': () => undefined,
  'updates.restart': () => undefined,
  'updates.later': () => undefined,
  'updates.move': () => undefined,
  'tab.openExternal': () => undefined,
  'tab.copy': () => undefined,
  'app.info': () => ({ version: '0.1.0' }),
};
let answers = { ...defaults };

const bridge = installBridge(
  Object.fromEntries(
    Object.keys(defaults).map((channel) => [
      channel,
      (input: unknown) => answers[channel]?.(input),
    ]),
  ),
);

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands ?? [], 'mac');
});

beforeEach(() => {
  vi.useFakeTimers();
  answers = { ...defaults };
  bridge.calls.length = 0;
  act(() => {
    showState({ status: 'idle' });
    updatesStore.setState({ how: undefined });
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  // A note from the test goes with it, as its timer would take it.
  for (const note of notices()) withdraw(note.title, note.body);
});

const LINE = 'Reads overview format 3 and shows merge queue groups.';

const offer = (how: 'install' | 'move' | 'brew' | 'page', failed?: Failed): UpdateState => ({
  status: 'available',
  version: '0.2.0',
  line: LINE,
  how,
  page: releasePage('0.2.0'),
  ...(failed === undefined ? {} : { failed }),
});

const downloading: UpdateState = {
  status: 'downloading',
  version: '0.2.0',
  received: 38 * 1024 * 1024,
  total: 112 * 1024 * 1024,
};

const ready: UpdateState = { status: 'ready', version: '0.2.0' };

/** Lets the moment after a toast comes pass, in which its buttons ignore a press. */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(GUARD_TIME);
  });
}

/**
 * Draws `node` on the page, until the test ends, and lets the moment after it comes pass, unless
 * the test is about that moment.
 */
function draw(node: ReactNode, options: { settled?: boolean } = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  // Copied through main, as the window's own route does.
  act(() =>
    root.render(<CopyRoute copy={(text) => client(tabs).copy({ text })}>{node}</CopyRoute>),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  if (options.settled !== false) settle();
  return host;
}

/** What a toast says, in order: its title, its body and its buttons. */
/** What a button says now: for one with faces, as Copy has, the face that shows. */
function said(button: Element | null): string | undefined {
  if (button === null) return undefined;
  const faces = [...button.querySelectorAll('.inline-grid > span')];
  if (faces.length === 0) return button.textContent;
  return faces.find((face) => !face.classList.contains('invisible'))?.textContent;
}

function toastOf(page: HTMLElement) {
  const card = page.querySelector('.toast');
  if (!card) return undefined;
  const [mark, title] = [...card.children];
  // What the body says, without the bar, which says nothing in words.
  const body = card.querySelector('.text-fg-muted')?.cloneNode(true);
  if (body instanceof Element) {
    for (const bar of body.querySelectorAll('[role="meter"]')) bar.remove();
    // A Copy button's faces that don't show, which hold its width.
    for (const hidden of body.querySelectorAll('.invisible')) hidden.remove();
  }
  return {
    title: title?.textContent,
    body: body?.textContent ?? undefined,
    buttons: [...card.querySelectorAll('button')].map(said),
    tone: /text-(info|success|warning|danger)/.exec(mark?.className ?? '')?.[1],
    mark: mark?.querySelector('svg.lo-i[aria-hidden="true"], .spinner') !== null,
  };
}

/** What was asked of main, as `[channel, input]`, since the test began. */
const asked = () => bridge.calls.slice();

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find((each) => said(each) === name);

/** The button a toast has by `name`, which the test fails without. */
function pressable(page: HTMLElement, name: string): HTMLButtonElement {
  const found = button(page, name);
  if (!found) throw new Error(`The toast has no “${name}” button.`);
  return found;
}

/** Each state of the design: what the toast says, and what its buttons are. */
const STATES: readonly {
  name: string;
  state: UpdateState;
  title: string;
  body: string | undefined;
  buttons: string[];
  tone: string;
}[] = [
  {
    name: 'a newer Lo this copy installs itself',
    state: offer('install'),
    title: 'Lo 0.2.0 is available',
    body: LINE,
    buttons: ['Update', 'What’s new', 'Hide'],
    tone: 'info',
  },
  {
    name: 'a newer Lo installed with Homebrew',
    state: offer('brew'),
    title: 'Lo 0.2.0 is available',
    body: `This copy of Lo updates with Homebrew.${BREW_UPGRADE}Copy`,
    buttons: ['Copy', 'What’s new', 'Hide'],
    tone: 'info',
  },
  {
    name: 'a newer Lo this copy can’t install from where it is',
    state: offer('move'),
    title: 'Lo 0.2.0 is available',
    body: 'Updates need Lo in Applications.',
    buttons: ['Move Lo to Applications', 'Hide'],
    tone: 'info',
  },
  {
    name: 'a newer Lo to download from its page',
    state: offer('page'),
    title: 'Lo 0.2.0 is available',
    body: LINE,
    buttons: ['Download update', 'Hide'],
    tone: 'info',
  },
  {
    name: 'a download going',
    state: downloading,
    title: 'Downloading Lo 0.2.0 · 38 / 112 MB',
    body: '',
    buttons: [],
    tone: 'info',
  },
  {
    name: 'a download that’s ready',
    state: ready,
    title: 'Lo 0.2.0 is ready',
    body: undefined,
    buttons: ['Restart to update'],
    tone: 'success',
  },
];

describe.each(['dark', 'light'] as const)('in the %s theme', (theme) => {
  const themed = (state: UpdateState) => (
    <div className="lo-app" data-theme={theme}>
      <UpdateToast state={state} />
    </div>
  );

  it.each(STATES)('draws $name as the design does', ({ state, title, body, buttons, tone }) => {
    const page = draw(themed(state));
    expect(toastOf(page)).toEqual({ title, body, buttons, tone, mark: true });
  });

  it('draws nothing while there’s nothing on offer', () => {
    expect(draw(themed({ status: 'idle' })).textContent).toBe('');
  });

  it('draws the main action as the one primary button', () => {
    const page = draw(themed(offer('install')));
    const filled = [...page.querySelectorAll('button')].map((each) =>
      each.hasAttribute('data-fill'),
    );
    expect(filled).toEqual([true, false, false]);
    // Nothing is drawn as focused: the design's ring on Install is the key press's, not the toast's.
    expect(page.querySelector(':focus')).toBeNull();
  });

  it('draws the download’s progress as a bar that says how far it has come', () => {
    const page = draw(themed(downloading));
    const bar = page.querySelector('[role="meter"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(38 * 1024 * 1024));
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(112 * 1024 * 1024));
    expect(bar?.getAttribute('aria-label')).toBe('Downloading Lo 0.2.0');
  });

  it('says only what it knows of a download whose size GitHub hasn’t said', () => {
    const page = draw(themed({ ...downloading, total: 0 }));
    expect(page.querySelector('[role="meter"]')).toBeNull();
    expect(toastOf(page)?.title).toBe('Downloading Lo 0.2.0 · 38 MB');
    const none = draw(themed({ ...downloading, received: 0, total: 0 }));
    expect(toastOf(none)?.title).toBe('Downloading Lo 0.2.0…');
  });
});

describe('the toasts in both themes', () => {
  it('draw the same, with no color of their own: the theme’s tokens do the rest', () => {
    for (const { state } of STATES) {
      const [dark, light] = (['dark', 'light'] as const).map(
        (theme) =>
          draw(
            <div className="lo-app" data-theme={theme}>
              <UpdateToast state={state} />
            </div>,
          ).firstElementChild?.innerHTML,
      );
      expect(dark).toBe(light);
      // The progress bar's width is its own; no color is.
      expect(dark).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|oklch|color:|background/i);
    }
  });
});

describe('the buttons', () => {
  it('ask for nothing until one is pressed', () => {
    for (const { state } of STATES) draw(<UpdateToast state={state} />);
    expect(asked()).toEqual([]);
  });

  it('install: Update downloads the update, and only that', async () => {
    const page = draw(<UpdateToast state={offer('install')} />);
    await act(async () => button(page, 'Update')?.click());
    expect(asked()).toEqual([['updates.install', undefined]]);
  });

  it('restart: Restart to update restarts, and nothing else does', async () => {
    const page = draw(<UpdateToast state={ready} />);
    expect(asked()).toEqual([]);
    await act(async () => button(page, 'Restart to update')?.click());
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('later: Hide hides the update', async () => {
    const page = draw(<UpdateToast state={offer('page')} />);
    await act(async () => button(page, 'Hide')?.click());
    expect(asked()).toEqual([['updates.later', undefined]]);
  });

  it('move: Move Lo to Applications moves Lo', async () => {
    const page = draw(<UpdateToast state={offer('move')} />);
    await act(async () => button(page, 'Move Lo to Applications')?.click());
    expect(asked()).toEqual([['updates.move', undefined]]);
  });

  it('page: Download update and What’s new open the release’s page, which main built from its version', async () => {
    const page = draw(<UpdateToast state={offer('page')} />);
    await act(async () => button(page, 'Download update')?.click());
    const more = draw(<UpdateToast state={offer('install')} />);
    await act(async () => button(more, 'What’s new')?.click());
    const url = 'https://github.com/withlo/lo/releases/tag/v0.2.0';
    expect(asked()).toEqual([
      ['tab.openExternal', { url }],
      ['tab.openExternal', { url }],
    ]);
  });

  it('copy: Copy puts the brew command on the clipboard, and says so for a moment', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const page = draw(<UpdateToast state={offer('brew')} />);
    expect(page.querySelector('code')?.textContent).toBe('brew upgrade --cask withlo/tap/lo');
    await act(async () => button(page, 'Copy')?.click());
    expect(asked()).toEqual([['tab.copy', { text: BREW_UPGRADE }]]);
    expect(button(page, 'Copied')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(button(page, 'Copy')).toBeDefined();
  });

  it('copy: says on the button that it couldn’t copy, with no note, holding its width', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answers['tab.copy'] = () => {
      throw new IpcError('failed', 'The clipboard is busy.');
    };
    const page = draw(<UpdateToast state={offer('brew')} />);
    const copy = button(page, 'Copy');
    await act(async () => copy?.click());
    // Every face is in the button throughout, the one shown visible, so it's as wide as the widest.
    const faces = [...(copy?.querySelectorAll('.inline-grid > span') ?? [])];
    expect(faces.map((face) => face.textContent)).toEqual(['Copy', 'Copied', 'Couldn’t copy']);
    expect(faces.map((face) => face.classList.contains('invisible'))).toEqual([true, true, false]);
    expect(notice()).toBeUndefined();
  });
});

describe('what main refuses', () => {
  it('is said in a note, as its reason alone, by a button that main wouldn’t do', async () => {
    answers['updates.install'] = () => {
      throw new IpcError('unavailable', 'Lo 0.2.0 is downloading');
    };
    const page = draw(
      <>
        <UpdateToast state={offer('install')} />
        <Notices />
      </>,
    );
    await act(async () => button(page, 'Update')?.click());
    expect(bridge.calls).toEqual([['updates.install', undefined]]);
    const note = page.querySelector('[role="status"]');
    expect(note?.textContent).toBe('Lo 0.2.0 is downloading');
  });
});

/** A middle for the window, as Lo's has: it takes focus without being tabbable. */
function middle(): HTMLElement {
  const element = document.createElement('main');
  element.tabIndex = -1;
  element.dataset.loMiddle = '';
  document.body.append(element);
  return element;
}

describe('focus', () => {
  it('is never taken by a toast as it comes, or as it changes, wherever focus is', () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const page = draw(<Offer />);
    for (const state of [offer('install'), downloading, ready, offer('brew'), offer('page')]) {
      act(() => showState(state));
      expect(page.querySelector('.toast')).not.toBeNull();
      expect(document.activeElement).toBe(field);
    }
    // And with focus nowhere in particular.
    field.blur();
    act(() => showState(offer('move')));
    expect(document.activeElement).toBe(document.body);
  });

  it('goes back to the middle of the window when the toast goes with focus on one of its buttons', async () => {
    const main = middle();
    act(() => showState(offer('install')));
    const page = draw(<Offer />);
    button(page, 'Update')?.focus();
    expect(document.activeElement).toBe(button(page, 'Update'));
    // Install was pressed: the toast becomes the download, which has no button to keep focus.
    act(() => showState(downloading));
    expect(page.querySelector('.toast')?.textContent).toContain('Downloading Lo 0.2.0');
    expect(document.activeElement).toBe(main);
    // Later does the same, as the toast goes.
    act(() => showState(offer('page')));
    button(page, 'Hide')?.focus();
    act(() => showState({ status: 'idle' }));
    expect(page.querySelector('.toast')).toBeNull();
    expect(document.activeElement).toBe(main);
  });

  it('leaves focus alone when it was somewhere else as the toast went', () => {
    const field = document.createElement('input');
    document.body.append(middle(), field);
    act(() => showState(offer('page')));
    const page = draw(<Offer />);
    field.focus();
    act(() => showState({ status: 'idle' }));
    expect(page.querySelector('.toast')).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('keeps focus on a button that stays, as Copy does', async () => {
    const page = draw(<UpdateToast state={offer('brew')} />);
    button(page, 'Copy')?.focus();
    // Pressed with the key, once the moment after focus came has passed.
    settle();
    await act(async () => button(page, 'Copy')?.click());
    expect(said(document.activeElement)).toBe('Copied');
  });
});

describe('the toast region', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the offer in its slot, below a note that passes, which comes and goes without it', async () => {
    const page = draw(
      <Slots views={feature.views ?? []}>
        <Notices waiting={<Slot slot={toasts} props={{}} />} />
      </Slots>,
    );
    expect(page.querySelector('.toast')).toBeNull();
    // The window's own state, as main says it: the toast comes by itself.
    act(() => showState(offer('page')));
    const region = page.querySelector('.toast-floating');
    expect(region?.querySelectorAll('.toast')).toHaveLength(1);
    // A check that found nothing newer says so in a note above the toast, and goes by itself.
    await act(async () => {
      registry().run('updates.check', NO_TARGET);
    });
    const cards = [...(region?.querySelectorAll('.toast') ?? [])];
    expect(cards.map((card) => card.children[1]?.textContent)).toEqual([
      'No update available',
      'Lo 0.2.0 is available',
    ]);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect([...(region?.querySelectorAll('.toast') ?? [])].map((card) => card.textContent)).toEqual(
      [expect.stringContaining('Lo 0.2.0 is available')],
    );
  });

  it('is fed by what main says: pushed, or read when it has pushed nothing', async () => {
    const page = draw(
      <Slots views={feature.views ?? []}>
        <Notices waiting={<Slot slot={toasts} props={{}} />} />
      </Slots>,
    );
    feature.start?.();
    act(() => bridge.push('updates.state', downloading));
    expect(updatesStore.getState().state).toEqual(downloading);
    expect(page.textContent).toContain('Downloading Lo 0.2.0');
    act(() => bridge.push('updates.state', ready));
    expect(page.textContent).toContain('Lo 0.2.0 is ready');
    act(() => bridge.push('updates.state', { status: 'idle' }));
    expect(page.querySelector('.toast')).toBeNull();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // What main answered to `read` came after the push and is older: it doesn't take its place.
    expect(updatesStore.getState().state).toEqual({ status: 'idle' });
    expect(updatesStore.getState().version).toBe('0.1.0');
  });
});

describe('a download that failed', () => {
  it('is said on the offer, with why, whose main button tries again, and in no note', () => {
    const page = draw(
      <>
        <Offer />
        <Notices />
      </>,
    );
    act(() => hear(offer('install')));
    act(() => hear(downloading));
    act(() => hear(offer('install', { why: 'stopped' })));
    settle();
    expect(notice()).toBeUndefined();
    expect(toastOf(page)).toMatchObject({
      title: 'Lo 0.2.0 is available',
      buttons: ['Try again', 'What’s new', 'Hide'],
      tone: 'info',
    });
    expect(page.textContent).toContain('Couldn’t download Lo 0.2.0');
    expect(page.textContent).toContain('The download stopped.');
  });

  it('offers no other try where one wouldn’t help', () => {
    const page = draw(<UpdateToast state={offer('install', { why: 'unsigned' })} />);
    expect(toastOf(page)?.buttons).toEqual(['What’s new', 'Hide']);
    expect(page.textContent).toContain('The update’s signature doesn’t match.');
  });
});

describe('a press in the moment after a toast comes or changes', () => {
  it('does nothing, pointer or key, until the moment has passed', async () => {
    const page = draw(<UpdateToast state={offer('install')} />, { settled: false });
    await act(async () => button(page, 'Update')?.click());
    expect(asked()).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(GUARD_TIME - 1);
    });
    await act(async () => button(page, 'Update')?.click());
    expect(asked()).toEqual([]);
    settle();
    await act(async () => button(page, 'Update')?.click());
    expect(asked()).toEqual([['updates.install', undefined]]);
  });

  it('starts again with each state, so a click meant for the one before lands on nothing', async () => {
    const page = draw(<Offer />);
    act(() => showState(offer('install')));
    settle();
    // The download is ready as the reader's pointer comes down on where Install was.
    act(() => showState(ready));
    await act(async () => button(page, 'Restart to update')?.click());
    expect(asked()).toEqual([]);
    settle();
    await act(async () => button(page, 'Restart to update')?.click());
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('holds for a new offer too, and not for a press on Copy once the toast is up', async () => {
    const page = draw(<Offer />);
    act(() => showState(offer('brew')));
    await act(async () => button(page, 'Copy')?.click());
    expect(asked()).toEqual([]);
    settle();
    await act(async () => button(page, 'Copy')?.click());
    expect(asked()).toEqual([['tab.copy', { text: BREW_UPGRADE }]]);
    // "Copied" is the same toast: pressing again isn't held.
    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    await act(async () => button(page, 'Copy')?.click());
    expect(asked()).toHaveLength(2);
  });
});

/**
 * A key pressed with `target` in focus, as the browser takes it: the event goes through the page,
 * and unless something stopped its default, `⏎` on a button clicks it, with no click count, at each
 * repeat as at the first press.
 */
function press(target: HTMLElement, init: { key: string; repeat?: boolean; shiftKey?: boolean }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  if (!event.defaultPrevented && init.key === 'Enter' && target instanceof HTMLButtonElement) {
    act(() => target.click());
  }
  return event;
}

/** A click from a pointer, which has come down on the button first and so has focused it. */
function pointed(target: HTMLElement): void {
  act(() => {
    target.focus();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** The toast for `state`, as the window draws it, up and past its first moment. */
function withToast(state: UpdateState): HTMLElement {
  const page = draw(<Offer />);
  act(() => showState(state));
  settle();
  return page;
}

/** Whether Move to Applications applies, as the app menu and the palette ask. */
const moves = () => registry().enabled('updates.move', NO_TARGET);

describe('a key held down as focus comes to the toast', () => {
  it('presses nothing by repeating: ⏎ held through "Go to the update" sends no restart', () => {
    const page = withToast(ready);
    const restartNow = pressable(page, 'Restart to update');
    // The first ⏎ chose the command in the palette, which put focus here; the rest are its repeats.
    act(() => {
      registry().run('updates.focus', NO_TARGET);
    });
    expect(document.activeElement).toBe(restartNow);
    for (let repeat = 0; repeat < 5; repeat++) {
      act(() => {
        vi.advanceTimersByTime(GUARD_TIME);
      });
      const event = press(restartNow, { key: 'Enter', repeat: true });
      expect(event.defaultPrevented).toBe(true);
    }
    expect(asked()).toEqual([]);
    // Let go, and press again: that is a press.
    press(restartNow, { key: 'Enter' });
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('does not start a download by repeating either', () => {
    const page = withToast(offer('install'));
    act(() => {
      registry().run('updates.focus', NO_TARGET);
    });
    for (let repeat = 0; repeat < 3; repeat++) {
      act(() => {
        vi.advanceTimersByTime(GUARD_TIME);
      });
      press(pressable(page, 'Update'), { key: 'Enter', repeat: true });
    }
    expect(asked()).toEqual([]);
  });

  it('ignores a press for a moment after focus comes in, as Go to the update, Tab or a command does', () => {
    const page = withToast(ready);
    const restartNow = pressable(page, 'Restart to update');
    act(() => {
      registry().run('updates.focus', NO_TARGET);
    });
    // The key that chose the command, let go and pressed again at once, isn't meant for the button.
    press(restartNow, { key: 'Enter' });
    expect(asked()).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(GUARD_TIME);
    });
    press(restartNow, { key: 'Enter' });
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('starts that moment again when focus comes into the toast again', () => {
    const page = withToast(ready);
    const restartNow = pressable(page, 'Restart to update');
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    act(() => restartNow.focus());
    act(() => {
      vi.advanceTimersByTime(GUARD_TIME);
    });
    act(() => elsewhere.focus());
    act(() => restartNow.focus());
    press(restartNow, { key: 'Enter' });
    expect(asked()).toEqual([]);
  });

  it('does not hold a click from a pointer, which focuses a button as it comes down on it', () => {
    const page = withToast(ready);
    pointed(pressable(page, 'Restart to update'));
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('does not hold a key as focus moves from one button of the toast to another', () => {
    const page = withToast(offer('install'));
    act(() => button(page, 'Update')?.focus());
    act(() => {
      vi.advanceTimersByTime(GUARD_TIME);
    });
    const hide = pressable(page, 'Hide');
    act(() => hide.focus());
    press(hide, { key: 'Enter' });
    expect(asked()).toEqual([['updates.later', undefined]]);
  });
});

describe('the keyboard', () => {
  it('moves between a toast’s buttons with Tab, which no other part of the window lets it do', () => {
    const page = draw(<UpdateToast state={offer('install')} />);
    for (const each of page.querySelectorAll('button')) {
      expect(findScope(each).name).toBe('toasts');
      expect(endsTab(findScope(each), each)).toBe(false);
    }
    // Where it isn't in a scope of its own, Lo's `Tab` stops at a button.
    const outside = document.createElement('button');
    expect(endsTab(findScope(outside), outside)).toBe(true);
  });

  it('wraps Tab round the toast’s buttons, from the last to the first and back', () => {
    const page = draw(<UpdateToast state={offer('install')} />);
    const install = pressable(page, 'Update');
    const notes = pressable(page, 'What’s new');
    const later = pressable(page, 'Hide');
    act(() => later.focus());
    // ⇥ on the last goes to the first, rather than out of the toast to the tab strip.
    expect(press(later, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(install);
    // ⇧⇥ on the first goes to the last.
    expect(press(install, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(later);
    // Between them the browser moves focus, as it does.
    act(() => notes.focus());
    expect(press(notes, { key: 'Tab' }).defaultPrevented).toBe(false);
    expect(press(notes, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(later, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(install, { key: 'Tab' }).defaultPrevented).toBe(false);
  });

  it('wraps a toast with one button on that button', () => {
    const page = draw(<UpdateToast state={ready} />);
    const restartNow = pressable(page, 'Restart to update');
    act(() => restartNow.focus());
    expect(press(restartNow, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(restartNow);
  });

  it('goes to the toast on "Go to the update", which puts focus on its first button and no more', () => {
    const page = draw(<Offer />);
    act(() => showState(offer('install')));
    settle();
    expect(document.activeElement).toBe(document.body);
    expect(registry().enabled('updates.focus', NO_TARGET)).toBe(true);
    act(() => {
      registry().run('updates.focus', NO_TARGET);
    });
    expect(document.activeElement).toBe(button(page, 'Update'));
    // Install wasn't pressed by focus coming to it.
    expect(asked()).toEqual([]);
  });

  it('has nowhere to go while there’s no toast, and says so', () => {
    expect(registry().enabled('updates.focus', NO_TARGET)).toBe('No update available');
  });
});

describe('the commands for the other buttons', () => {
  it('open what’s new for an update on offer, downloading or ready, from its release’s page', async () => {
    const url = 'https://github.com/withlo/lo/releases/tag/v0.2.0';
    // With none, Lo's releases on GitHub.
    act(() => showState({ status: 'idle' }));
    await act(async () => {
      registry().run('updates.whatsNew', NO_TARGET);
    });
    expect(asked()).toEqual([['tab.openExternal', { url: RELEASES }]]);
    for (const state of [offer('install'), offer('brew'), downloading, ready]) {
      act(() => showState(state));
      bridge.calls.length = 0;
      await act(async () => {
        registry().run('updates.whatsNew', NO_TARGET);
      });
      expect(asked()).toEqual([['tab.openExternal', { url }]]);
    }
  });

  it('download where Lo can only offer the page, and say why they don’t elsewhere', async () => {
    act(() => showState(offer('page')));
    await act(async () => {
      registry().run('updates.download', NO_TARGET);
    });
    expect(asked()).toEqual([
      ['tab.openExternal', { url: 'https://github.com/withlo/lo/releases/tag/v0.2.0' }],
    ]);
    act(() => showState(offer('install')));
    expect(registry().enabled('updates.download', NO_TARGET)).toBe(
      'This copy of Lo updates itself',
    );
    act(() => showState(offer('brew')));
    expect(registry().enabled('updates.download', NO_TARGET)).toBe(
      'This copy of Lo updates with Homebrew',
    );
  });

  it('copy the Homebrew command, and say so in a note', async () => {
    const page = draw(<Notices />);
    act(() => showState(offer('brew')));
    await act(async () => {
      registry().run('updates.copy', NO_TARGET);
    });
    expect(asked()).toEqual([['tab.copy', { text: BREW_UPGRADE }]]);
    expect(page.textContent).toContain('Copied Homebrew command');
    act(() => showState(offer('page')));
    expect(registry().enabled('updates.copy', NO_TARGET)).toBe(
      'This copy of Lo can’t update itself',
    );
  });
});

describe('which commands apply', () => {
  const ids = [
    'check',
    'install',
    'restart',
    'move',
    'later',
    'whatsNew',
    'download',
    'copy',
    'focus',
  ] as const;
  /** The commands that apply to each state, the others being greyed in the app menu. */
  const APPLY: readonly [string, UpdateState, readonly (typeof ids)[number][]][] = [
    ['nothing on offer', { status: 'idle' }, ['check', 'whatsNew']],
    [
      'an offer Lo installs itself',
      offer('install'),
      ['check', 'install', 'later', 'whatsNew', 'focus'],
    ],
    ['an offer for Homebrew', offer('brew'), ['check', 'later', 'whatsNew', 'copy', 'focus']],
    [
      'an offer Lo can’t install from where it is',
      offer('move'),
      ['check', 'move', 'later', 'whatsNew', 'focus'],
    ],
    ['an offer for its page', offer('page'), ['check', 'later', 'whatsNew', 'download', 'focus']],
    ['a download going', downloading, ['check', 'whatsNew', 'focus']],
    ['a download that’s ready', ready, ['check', 'restart', 'whatsNew', 'focus']],
  ];

  it.each(APPLY)('for %s are only those that do', (_name, state, applying) => {
    act(() => showState(state));
    const enabled = ids.filter((id) => registry().enabled(`updates.${id}`, NO_TARGET) === true);
    expect(enabled).toEqual(ids.filter((id) => applying.includes(id)));
  });

  it('has Move to Applications for nothing on offer only where Lo can’t update where it is', () => {
    act(() => showState({ status: 'idle' }));
    // Until main has said, Lo can't tell.
    expect(moves()).toBe('Checking where Lo is installed');
    act(() => showHow('move'));
    expect(moves()).toBe(true);
    // Lo in Applications, however it's updated, and Lo that can't be moved, have nothing to move.
    for (const how of ['install', 'brew'] as const) {
      act(() => showHow(how));
      expect(moves()).toBe('Already in Applications');
    }
    act(() => showHow('page'));
    expect(moves()).toBe('This copy of Lo can’t be moved');
    // An offer says it itself, whatever main said before it came.
    act(() => showHow('move'));
    act(() => showState(offer('brew')));
    expect(moves()).toBe('Already in Applications');
    act(() => showState(downloading));
    expect(moves()).toBe('Already in Applications');
  });

  it('asks main how Lo takes an update as it starts, and again as an offer goes or a check ends', async () => {
    answers['updates.how'] = () => 'move';
    feature.start?.();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updatesStore.getState().how).toBe('move');
    expect(registry().enabled('updates.move', NO_TARGET)).toBe(true);
    // Moved in Finder while Lo ran, and the offer was hidden: it's asked again.
    answers['updates.how'] = () => 'install';
    act(() => showState(offer('move')));
    await act(async () => {
      hear({ status: 'idle' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updatesStore.getState().how).toBe('install');
    expect(registry().enabled('updates.move', NO_TARGET)).toBe('Already in Applications');
    answers['updates.how'] = () => 'page';
    await act(async () => {
      registry().run('updates.check', NO_TARGET);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updatesStore.getState().how).toBe('page');
  });

  it('say why one doesn’t, in words that name the update', () => {
    act(() => showState({ status: 'idle' }));
    expect(registry().enabled('updates.restart', NO_TARGET)).toBe('No update is ready');
    expect(registry().enabled('updates.install', NO_TARGET)).toBe('No update available');
    act(() => showState(offer('page')));
    expect(registry().enabled('updates.restart', NO_TARGET)).toBe('Lo 0.2.0 isn’t downloaded');
    expect(registry().enabled('updates.install', NO_TARGET)).toBe(
      'This copy of Lo can’t update itself',
    );
    act(() => showState(downloading));
    expect(registry().enabled('updates.later', NO_TARGET)).toBe('Lo 0.2.0 is downloading');
  });

  it('is refused from the palette with its reason, and asks main nothing', () => {
    act(() => showState({ status: 'idle' }));
    const refused = registry().run('updates.restart', NO_TARGET);
    expect(refused).toBe('No update is ready');
    expect(asked()).toEqual([]);
  });
});

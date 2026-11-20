// @vitest-environment jsdom
// The toasts that offer a newer Lo, with main answered by a stand-in bridge: each state from the
// design in both themes, each button asking main for what it says and only when pressed, a toast
// that never takes focus and gives it back to the middle when it goes with focus in it, and the
// toast region keeping it below a note that passes.

import { NO_TARGET } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice, Notices, NOTICE_TIME, withdraw } from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { Slot } from '../../../window/slots.tsx';
import { toasts } from '../../tab/window/shared.ts';
import { BREW_UPGRADE, releasePage, type UpdateState } from '../contract.ts';
import feature from './index.ts';
import { COPIED_TIME, Offer, UpdateToast } from './Offer.tsx';
import { showState, updatesStore } from './store.ts';

/** What main answers on each channel, as `main` has it: a test changes what a channel says. */
const defaults: Record<string, (input: unknown) => unknown> = {
  'updates.read': () => ({ status: 'idle' }),
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
  answers = { ...defaults };
  bridge.calls.length = 0;
  act(() => showState({ status: 'idle' }));
});

afterEach(() => {
  document.body.replaceChildren();
  // A note from the test goes with it, as its timer would take it.
  const note = notice();
  if (note) withdraw(note.title, note.body);
});

const LINE = 'Reads overview format 3 and shows merge queue groups.';

const offer = (how: 'install' | 'move' | 'brew' | 'page', failed?: string): UpdateState => ({
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

/** Draws `node` on the page, until the test ends. */
function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** What a toast says, in order: its title, its body and its buttons. */
function toastOf(page: HTMLElement) {
  const card = page.querySelector('.toast');
  if (!card) return undefined;
  const [mark, title] = [...card.children];
  // What the body says, without the bar, which says nothing in words.
  const body = card.querySelector('.text-fg-muted')?.cloneNode(true);
  if (body instanceof Element)
    for (const bar of body.querySelectorAll('[role="meter"]')) bar.remove();
  return {
    title: title?.textContent,
    body: body?.textContent ?? undefined,
    buttons: [...card.querySelectorAll('button')].map((button) => button.textContent),
    tone: /text-(info|success|warning|danger)/.exec(mark?.className ?? '')?.[1],
    mark: mark?.querySelector('svg.lo-i[aria-hidden="true"], .spinner') !== null,
  };
}

/** What was asked of main, as `[channel, input]`, since the test began. */
const asked = () => bridge.calls.slice();

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find((each) => each.textContent === name);

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
    title: 'Lo 0.2.0 is out',
    body: LINE,
    buttons: ['Install', 'What’s new', 'Later'],
    tone: 'info',
  },
  {
    name: 'a newer Lo installed with Homebrew',
    state: offer('brew'),
    title: 'Lo 0.2.0 is out',
    body: `You installed Lo with Homebrew, so update it there:${BREW_UPGRADE}Copy`,
    buttons: ['Copy', 'What’s new', 'Later'],
    tone: 'info',
  },
  {
    name: 'a newer Lo this copy can’t install from where it is',
    state: offer('move'),
    title: 'Lo 0.2.0 is out',
    body: 'Lo can’t update itself from where it is. Move it to Applications, and it updates from there.',
    buttons: ['Move to Applications', 'Later'],
    tone: 'info',
  },
  {
    name: 'a newer Lo to download from its page',
    state: offer('page'),
    title: 'Lo 0.2.0 is out',
    body: LINE,
    buttons: ['Download', 'Later'],
    tone: 'info',
  },
  {
    name: 'a download that failed',
    state: offer('install', 'The download stopped before it finished. Try again.'),
    title: 'Lo couldn’t download 0.2.0',
    body: 'The download stopped before it finished. Try again.',
    buttons: ['Try again', 'What’s new', 'Later'],
    tone: 'warning',
  },
  {
    name: 'a download going',
    state: downloading,
    title: 'Downloading Lo 0.2.0',
    body: '38 of 112 MB',
    buttons: [],
    tone: 'info',
  },
  {
    name: 'a download that’s ready',
    state: ready,
    title: 'Lo 0.2.0 is ready',
    body: 'It installs when you quit, or now.',
    buttons: ['Restart now'],
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

  it('draws the main action as the one primary button, and Later quiet', () => {
    const page = draw(themed(offer('install')));
    const [install, whatsNew, later] = [...page.querySelectorAll('button')];
    expect(install?.className).toContain('bg-accent');
    expect(whatsNew?.className).not.toContain('bg-accent');
    expect(later?.className).toContain('bg-transparent');
    // Nothing is drawn as focused: the design's ring on Install is the key press's, not the toast's.
    expect(page.querySelector(':focus')).toBeNull();
  });

  it('draws the download’s progress as a bar that says how far it has come', () => {
    const page = draw(themed(downloading));
    const bar = page.querySelector('[role="meter"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(38 * 1024 * 1024));
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(112 * 1024 * 1024));
    expect(bar?.getAttribute('aria-label')).toBe('Download of Lo 0.2.0');
  });

  it('says only what it knows of a download whose size GitHub hasn’t said', () => {
    const page = draw(themed({ ...downloading, total: 0 }));
    expect(page.querySelector('[role="meter"]')).toBeNull();
    expect(toastOf(page)?.body).toBe('38 MB');
    const none = draw(themed({ ...downloading, received: 0, total: 0 }));
    expect(toastOf(none)?.body).toBe('Starting');
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

  it('install: Install downloads the update, and only that', async () => {
    const page = draw(<UpdateToast state={offer('install')} />);
    await act(async () => button(page, 'Install')?.click());
    expect(asked()).toEqual([['updates.install', undefined]]);
  });

  it('try again: after a download failed, Try again downloads it again', async () => {
    const page = draw(<UpdateToast state={offer('install', 'The download stopped.')} />);
    await act(async () => button(page, 'Try again')?.click());
    expect(asked()).toEqual([['updates.install', undefined]]);
  });

  it('restart: Restart now restarts, and nothing else does', async () => {
    const page = draw(<UpdateToast state={ready} />);
    expect(asked()).toEqual([]);
    await act(async () => button(page, 'Restart now')?.click());
    expect(asked()).toEqual([['updates.restart', undefined]]);
  });

  it('later: Later hides the update', async () => {
    const page = draw(<UpdateToast state={offer('page')} />);
    await act(async () => button(page, 'Later')?.click());
    expect(asked()).toEqual([['updates.later', undefined]]);
  });

  it('move: Move to Applications moves Lo', async () => {
    const page = draw(<UpdateToast state={offer('move')} />);
    await act(async () => button(page, 'Move to Applications')?.click());
    expect(asked()).toEqual([['updates.move', undefined]]);
  });

  it('page: Download and What’s new open the release’s page, which main built from its version', async () => {
    const page = draw(<UpdateToast state={offer('page')} />);
    await act(async () => button(page, 'Download')?.click());
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
      vi.advanceTimersByTime(COPIED_TIME);
    });
    expect(button(page, 'Copy')).toBeDefined();
  });
});

describe('what main refuses', () => {
  it('is said in a note, with its reason, by a button that main wouldn’t do', async () => {
    answers['updates.install'] = () => {
      throw new IpcError('unavailable', 'Lo 0.2.0 is downloading.');
    };
    const page = draw(
      <>
        <UpdateToast state={offer('install')} />
        <Notices />
      </>,
    );
    await act(async () => button(page, 'Install')?.click());
    expect(bridge.calls).toEqual([['updates.install', undefined]]);
    const note = page.querySelector('[role="status"]');
    expect(note?.textContent).toBe('Lo couldn’t install the updateLo 0.2.0 is downloading.');
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
    button(page, 'Install')?.focus();
    expect(document.activeElement).toBe(button(page, 'Install'));
    // Install was pressed: the toast becomes the download, which has no button to keep focus.
    act(() => showState(downloading));
    expect(page.querySelector('.toast')?.textContent).toContain('Downloading Lo 0.2.0');
    expect(document.activeElement).toBe(main);
    // Later does the same, as the toast goes.
    act(() => showState(offer('page')));
    button(page, 'Later')?.focus();
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
    await act(async () => button(page, 'Copy')?.click());
    expect(document.activeElement?.textContent).toBe('Copied');
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
      'Lo 0.1.0 is the newest version.',
      'Lo 0.2.0 is out',
    ]);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect([...(region?.querySelectorAll('.toast') ?? [])].map((card) => card.textContent)).toEqual(
      [expect.stringContaining('Lo 0.2.0 is out')],
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

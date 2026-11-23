// @vitest-environment jsdom
import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import keys from '../../features/keys/window/index.ts';
import {
  announce,
  fail,
  notice,
  notices,
  notify,
  NOTICE_TIME,
  Notices,
  refuse,
  withdraw,
} from './notices.tsx';
import { createRegistry, registry, setMiddle } from './registry.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  createRegistry(keys.commands, 'mac');
  const page = document.createElement('div');
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(<Notices />));
});

afterEach(() => {
  act(() => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
  act(() => root?.unmount());
  document.body.replaceChildren();
});

const status = () => document.querySelector('[role="status"]');
/** The file a file place is in. */
const fileOf = (at: { kind: string; file?: string }) => (at.kind === 'file' ? at.file : '');
const region = () => document.querySelector('.toast-floating');

/** A toast's parts, as a screen reader hears them in order. */
interface Said {
  readonly title: string | null;
  readonly body: string | null;
  readonly icon: boolean;
}

/** The toasts on screen, oldest first: each one's line, and what's under it. */
function toasts(): Said[] {
  return [...(status()?.querySelectorAll('.toast') ?? [])].map((card) => {
    const line = card.querySelector('div');
    const under = line?.querySelector(':scope > .text-fg-muted');
    const title = [...(line?.childNodes ?? [])]
      .filter((node) => node !== under)
      .map((node) => node.textContent)
      .join('');
    return {
      title: line ? title : null,
      body: under?.textContent ?? null,
      icon: card.querySelector('svg.lo-i[aria-hidden="true"]') !== null,
    };
  });
}

/** The newest toast. */
const toast = () => toasts().at(-1);

describe('notices', () => {
  it('keep a live region that says each note as a toast, and take it away after a few seconds', () => {
    expect(status()?.textContent).toBe('');
    expect(toast()).toBeUndefined();
    act(() => notify('Back', "There's nowhere to go back to."));
    expect(toasts()).toEqual([
      { title: 'Back', body: "There's nowhere to go back to.", icon: true },
    ]);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect(status()?.textContent).toBe('');
    expect(notice()).toBeUndefined();
  });

  it('stack a second note under the first, each with its own time', () => {
    act(() => announce('Copied path'));
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
      announce('Copied link');
    });
    // Two things done show two toasts: the newer one doesn't take the older one's place.
    expect(toasts().map((each) => each.title)).toEqual(['Copied path', 'Copied link']);
    expect(notice()).toMatchObject({ title: 'Copied link' });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toasts().map((each) => each.title)).toEqual(['Copied link']);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
    });
    expect(status()?.textContent).toBe('');
    expect(notices()).toEqual([]);
  });

  it('show three at most: a fourth sends the oldest away', () => {
    act(() => {
      for (const each of ['One', 'Two', 'Three', 'Four']) announce(each);
    });
    expect(toasts().map((each) => each.title)).toEqual(['Two', 'Three', 'Four']);
  });

  it('say a note once, however often it’s asked for while it shows', () => {
    act(() => {
      refuse('Sign in to comment');
      announce('Copied path');
      refuse('Sign in to comment');
    });
    // The one said again is the newest, and isn't there twice.
    expect(notices().map((each) => each.title)).toEqual(['Copied path', 'Sign in to comment']);
    expect(toasts()).toHaveLength(2);
  });

  it('keep a note’s time as the window draws again, and as other notes come and go', () => {
    act(() => announce('Copied path'));
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME / 2);
    });
    // Drawn again with nothing new to say, then with a note that comes and is taken back: neither
    // gives the first note more time.
    act(() => root?.render(<Notices waiting={<span />} />));
    act(() => notify('Offline', ''));
    act(() => withdraw('Offline', ''));
    act(() => root?.render(<Notices />));
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME / 2 - 1);
    });
    expect(toasts().map((each) => each.title)).toEqual(['Copied path']);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(notices()).toEqual([]);
  });

  it('start a note’s time over when it’s said again', () => {
    act(() => announce('Copied path'));
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
    });
    act(() => announce('Copied path'));
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
    });
    expect(toasts().map((each) => each.title)).toEqual(['Copied path']);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(notices()).toEqual([]);
  });

  it('take back a note that’s over, and leave the others', () => {
    act(() => {
      notify('Compare r1 → r2', 'Fetching.');
      announce('Copied path');
    });
    act(() => withdraw('Compare r1 → r2', 'Fetching.'));
    expect(toasts().map((each) => each.title)).toEqual(['Copied path']);
  });

  it('float at the bottom right, above the status bar, as the design’s toast does', () => {
    act(() => notify('Back', 'Nowhere.'));
    expect(status()?.closest('.toast-floating')).not.toBeNull();
    expect(status()?.querySelector('.toast')?.className).toContain('shadow-pop');
  });

  it('put each reason on a line of its own', () => {
    act(() => notify('Make this a GitHub stack', 'One reason.\nAnother reason.'));
    const lines = [...(status()?.querySelectorAll('.toast span.block span.block') ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual(['One reason.', 'Another reason.']);
  });

  it('set what’s between backticks as code, in the line and under it, never the backticks', () => {
    act(() => notify('Couldn’t install the `lo` command', 'Another `lo` file is already there.'));
    act(() => announce('Installed the `lo` command', 'Run `lo .` in a repo.'));
    const cards = [...(status()?.querySelectorAll('.toast') ?? [])];
    expect(cards.map((card) => card.textContent)).toEqual([
      'Couldn’t install the lo commandAnother lo file is already there.',
      'Installed the lo commandRun lo . in a repo.',
    ]);
    const code = [...(status()?.querySelectorAll('.toast .code-small') ?? [])];
    expect(code.map((each) => each.textContent)).toEqual(['lo', 'lo', 'lo', 'lo .']);
  });

  it('keep what came with a failure behind Details, with Copy', async () => {
    act(() => notify('Couldn’t update Lo', '', { details: 'Failed to copy Lo.app' }));
    const card = status()?.querySelector('.toast');
    const details = [...(card?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Details',
    );
    expect(details?.getAttribute('aria-expanded')).toBe('false');
    expect(card?.textContent).not.toContain('Failed to copy Lo.app');
    await act(async () => {
      details?.click();
      await Promise.resolve();
    });
    expect(details?.getAttribute('aria-expanded')).toBe('true');
    const text = document.getElementById(details?.getAttribute('aria-controls') ?? '');
    expect(text?.textContent).toContain('Failed to copy Lo.app');
    expect(text?.querySelector('button')?.textContent).toMatch(/^Copy/);
  });

  it('show a failure as one, with Details or not, a block as a warning, and a reason as news', () => {
    act(() => {
      notify('Couldn’t update Lo', '', { details: 'Failed to copy Lo.app' });
      notify('Couldn’t open #82', 'The browser sent it straight back.');
      notify('Can’t check for updates', 'This copy of Lo is built from source.', {
        tone: 'warning',
      });
    });
    const icons = [...(status()?.querySelectorAll('.toast > span:first-child') ?? [])];
    expect(icons.map((icon) => icon.className)).toEqual([
      'flex-none text-danger',
      'flex-none text-danger',
      'flex-none text-warning',
    ]);
    act(() => refuse('Sign in to comment'));
    const newest = [...(status()?.querySelectorAll('.toast > span:first-child') ?? [])].at(-1);
    expect(newest?.className).toBe('flex-none text-info');
  });

  it('keep a note with Details or a button twice as long, whether or not a window draws it', () => {
    const back = { label: 'Back', onClick: () => undefined };
    act(() => {
      notify('Couldn’t update Lo', '', { details: 'Failed to copy Lo.app' });
      announce('Moved the comment', '', back);
      announce('Copied path');
    });
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect(notices().map((each) => each.title)).toEqual([
      'Couldn’t update Lo',
      'Moved the comment',
    ]);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect(notices()).toEqual([]);
    act(() => root?.unmount());
    root = undefined;
    notify('Couldn’t update Lo', '', { details: 'Failed to copy Lo.app' });
    vi.advanceTimersByTime(NOTICE_TIME);
    expect(notice()).toMatchObject({ title: 'Couldn’t update Lo' });
    vi.advanceTimersByTime(NOTICE_TIME);
    expect(notice()).toBeUndefined();
  });

  it('say what’s done with a tick, in one line', () => {
    act(() => announce('Made #82, #83 and #84 a GitHub stack'));
    expect(toast()).toEqual({
      title: 'Made #82, #83 and #84 a GitHub stack',
      body: null,
      icon: true,
    });
    expect(status()?.querySelector('.toast .text-success')).not.toBeNull();
  });

  it('say what went wrong with no control in view at danger tone, in one line', () => {
    act(() => fail('Couldn’t copy the prompt'));
    expect(toast()).toEqual({ title: 'Couldn’t copy the prompt', body: null, icon: true });
    expect(status()?.querySelector('.toast .text-danger')).not.toBeNull();
    // What main said goes behind Details.
    act(() => fail('Couldn’t copy the prompt', 'The clipboard is busy.'));
    expect(notice()).toMatchObject({ tone: 'danger', details: 'The clipboard is busy.' });
    const more = [...(status()?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Details',
    );
    expect(more).toBeDefined();
  });

  it('go after their time with no window drawing them', () => {
    act(() => root?.unmount());
    root = undefined;
    notify('Back', 'Nowhere.');
    vi.advanceTimersByTime(NOTICE_TIME - 1);
    expect(notice()).toMatchObject({ title: 'Back' });
    vi.advanceTimersByTime(1);
    expect(notice()).toBeUndefined();
  });
});

describe('toasts that wait', () => {
  it('stay below a note that passes, in a region of their own, and are there before and after it', () => {
    act(() => root?.render(<Notices waiting={<div data-testid="waiting">Lo 0.2.0 is out</div>} />));
    const waiting = () => region()?.querySelector('[data-testid="waiting"]');
    expect(waiting()?.textContent).toBe('Lo 0.2.0 is out');
    act(() => notify('Back', 'Nowhere.'));
    // Not inside the notes' region, which says each note as it comes.
    expect(status()?.contains(waiting() ?? null)).toBe(false);
    expect(waiting()?.closest('[role="status"]')).not.toBe(status());
    const [note, held] = [...(region()?.children ?? [])];
    expect(note?.textContent).toBe('BackNowhere.');
    expect(held?.contains(waiting() ?? null)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME);
    });
    expect(status()?.textContent).toBe('');
    expect(waiting()?.textContent).toBe('Lo 0.2.0 is out');
  });
});

describe('a command that did nothing', () => {
  it('says why when its handler says it can’t run, whoever asked', () => {
    const [command] = keys.commands;
    expect(command).toBeDefined();
    createRegistry(
      keys.commands.map((each) =>
        each.id === 'keys.help'
          ? { ...each, handler: { run() {}, enabled: () => 'Key help is busy.' } }
          : each,
      ),
      'mac',
    );
    act(() => {
      registry().run('keys.help', NO_TARGET);
    });
    // The reason alone: never under the name of what was asked for.
    expect(toasts()).toEqual([{ title: 'Key help is busy.', body: null, icon: true }]);
  });

  it('says nothing when it ran', () => {
    act(() => {
      registry().run('keys.help', NO_TARGET);
    });
    expect(status()?.textContent).toBe('');
  });

  it('dims Back and Forward with nowhere to go, and says nothing when their keys are pressed', () => {
    expect(registry().enabled('keys.back', NO_TARGET)).toBe('');
    expect(registry().enabled('keys.forward', NO_TARGET)).toBe('');
    act(() => {
      registry().run('keys.back', NO_TARGET);
      registry().run('keys.forward', NO_TARGET);
    });
    expect(notices()).toEqual([]);
    expect(status()?.textContent).toBe('');
    // A place a view can show again: Back has somewhere to go, and once there, Forward does.
    const { history } = registry();
    const shown: unknown[] = [];
    history.register('', 'diff', (at) => {
      shown.push(at);
      return true;
    });
    history.record({ view: 'diff', at: { kind: 'file', file: 'a.ts' } });
    expect(registry().enabled('keys.back', NO_TARGET)).toBe(true);
    expect(registry().enabled('keys.forward', NO_TARGET)).toBe('');
    act(() => {
      registry().run('keys.back', NO_TARGET);
    });
    expect(shown).toEqual([{ kind: 'file', file: 'a.ts' }]);
    expect(registry().enabled('keys.back', NO_TARGET)).toBe('');
    expect(notices()).toEqual([]);
  });

  it('skips a place that’s gone, and with none left, dims Back and says nothing', () => {
    const { history } = registry();
    const gone = new Set<string>();
    const shown: string[] = [];
    history.register(
      '',
      'diff',
      (at) => {
        shown.push(fileOf(at) ?? '');
        return true;
      },
      (at) => !gone.has(fileOf(at) ?? ''),
    );
    history.record({ view: 'diff', at: { kind: 'file', file: 'a.ts' } });
    history.record({ view: 'diff', at: { kind: 'file', file: 'b.ts' } });
    // A push removes b.ts: Back goes past it, to a.ts.
    gone.add('b.ts');
    act(() => {
      registry().run('keys.back', NO_TARGET);
    });
    expect(shown).toEqual(['a.ts']);
    // Forward from a.ts has only b.ts, which is gone: it's dimmed, and says nothing when pressed.
    expect(registry().enabled('keys.forward', NO_TARGET)).toBe('');
    act(() => {
      registry().run('keys.forward', NO_TARGET);
    });
    expect(shown).toEqual(['a.ts']);
    expect(notices()).toEqual([]);
  });

  it('skips where the cursor is, and with nowhere else, dims Back and says nothing', () => {
    const { history } = registry();
    const at = { view: 'diff', at: { kind: 'file', file: 'a.ts' } } as const;
    history.register('', 'diff', () => true);
    history.record(at);
    let cursor: typeof at | undefined;
    const stop = setMiddle({ focus: () => undefined, here: () => cursor });
    expect(registry().enabled('keys.back', NO_TARGET)).toBe(true);
    // The cursor goes back to the place by hand: Back from there has nowhere to go.
    cursor = at;
    expect(registry().enabled('keys.back', NO_TARGET)).toBe('');
    act(() => {
      registry().run('keys.back', NO_TARGET);
    });
    stop();
    expect(notices()).toEqual([]);
  });
});

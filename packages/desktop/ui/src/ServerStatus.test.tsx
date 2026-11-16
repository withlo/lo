// @vitest-environment jsdom
// A language server's item in the status bar: what each state says and shows, the details it opens
// over itself, and the buttons that start the server again or open its log.

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, press, render, rerender } from '../test/dom.ts';
import { ServerStatus, type ServerState, type ServerTrust } from './ServerStatus.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const MEMORY: ServerState = { kind: 'failed', why: { kind: 'memory', limit: '4 GB', files: 3880 } };

/** The item's own button: the one that opens the details. */
function item(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!;
}

function words(host: HTMLElement): string {
  return item(host).textContent ?? '';
}

/** The details, once open: Base UI draws them into the page's body. */
function details(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

/** Lets the details take focus, which they do as they mount. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** What an item for a server named `name` in `state` says in the status bar. */
function say(name: string, state: ServerState): string {
  return words(render(<ServerStatus name={name} state={state} />));
}

/** Whether an item for a server in `state` has a ring turning, and the class of its dot if it has one. */
function marks(state: ServerState): { spinner: boolean; dot: string } {
  const own = item(render(<ServerStatus name="TypeScript" state={state} />));
  return {
    spinner: own.querySelector('.spinner') !== null,
    dot: own.querySelector('.rounded-full:not(.spinner)')?.className ?? '',
  };
}

/**
 * A status bar whose item the caller draws again, under a key of its own, once trust is stopped:
 * it says "Language servers off" then. A button before it and after it are the bar's other items.
 */
function Redrawn({ before = false, around = false }: { before?: boolean; around?: boolean }) {
  const [drawn, setDrawn] = useState(0);
  return (
    <footer aria-label="Status">
      {(before || around) && (
        <button type="button" id="before">
          Before
        </button>
      )}
      <ServerStatus
        key={drawn}
        name="TypeScript"
        state={drawn === 0 ? { kind: 'ready' } : { kind: 'off' }}
        trust={{ action: 'stop', onChoose: () => setDrawn(1) }}
      />
      {around && !before && (
        <button type="button" id="after">
          After
        </button>
      )}
    </footer>
  );
}

/** A bar of three items, the middle one a server's, drawn only while `withServer`. */
function bar(withServer: boolean) {
  return (
    <footer aria-label="Status">
      <button type="button" id="before">
        Before
      </button>
      {withServer && <ServerStatus name="TypeScript" state={MEMORY} onShowLog={() => undefined} />}
      <button type="button" id="after">
        After
      </button>
    </footer>
  );
}

/** A status bar that holds the server's state, and starts it when Restart is pressed. */
function Bar() {
  const [state, setState] = useState<ServerState>(MEMORY);
  return (
    <ServerStatus
      name="TypeScript"
      state={state}
      onRestart={() => setState({ kind: 'starting' })}
    />
  );
}

/** The labels of the buttons on the details of a server in `state`, with `trust` offered. */
async function labels(trust: ServerTrust, state: ServerState): Promise<string[]> {
  const host = render(
    <ServerStatus
      name="TypeScript"
      state={state}
      onRestart={() => undefined}
      onShowLog={() => undefined}
      trust={trust}
    />,
  );
  click(item(host));
  await settle();
  const found = [...details()!.querySelectorAll('button')].map((button) => button.textContent);
  cleanUp();
  return found;
}

describe('ServerStatus', () => {
  it('says each state in the one phrase that fits, with its numbers', () => {
    // In the units Settings counts in.
    expect(say('TypeScript', { kind: 'downloading', done: 12_300_000, total: 40_100_000 })).toBe(
      'TypeScript downloading · 11.7 MB of 38.2 MB',
    );
    expect(say('TypeScript', { kind: 'starting' })).toBe('TypeScript starting');
    expect(say('TypeScript', { kind: 'indexing', percent: 40 })).toBe('TypeScript indexing 40%');
    expect(say('TypeScript', { kind: 'indexing' })).toBe('TypeScript indexing');
    expect(say('TypeScript', { kind: 'ready' })).toBe('TypeScript');
    expect(say('TypeScript', { kind: 'notAnswering' })).toBe('TypeScript not answering');
    expect(say('TypeScript', MEMORY)).toBe('TypeScript failed');
    expect(say('Go', { kind: 'missing', needs: 'Go 1.24 or later' })).toBe('Go toolchain missing');
    // An untrusted repo has none of them on, whichever server is named.
    expect(say('TypeScript', { kind: 'off' })).toBe('Language servers off');
  });

  it('keeps a progress report to the scale it is on', () => {
    const host = render(<ServerStatus name="Rust" state={{ kind: 'indexing', percent: 140.4 }} />);
    expect(words(host)).toBe('Rust indexing 100%');
  });

  it('marks a server coming up with a ring turning, and the rest with a dot and a word', () => {
    for (const state of [
      { kind: 'downloading', done: 1, total: 2 },
      { kind: 'starting' },
      { kind: 'indexing' },
    ] as const) {
      expect(marks(state).spinner).toBe(true);
    }
    expect(marks({ kind: 'ready' }).dot).toContain('bg-success');
    expect(marks(MEMORY).dot).toContain('bg-danger');
    expect(marks({ kind: 'missing', needs: 'a JDK' }).dot).toContain('bg-warning');
    expect(marks({ kind: 'notAnswering' }).dot).toContain('bg-warning');
    expect(marks({ kind: 'ready' }).spinner).toBe(false);
    expect(marks({ kind: 'off' })).toEqual({
      spinner: false,
      dot: expect.stringContaining('bg-fg-dim'),
    });
  });

  it('is a button that opens details, so it’s reached and opened by keyboard', () => {
    const host = render(<ServerStatus name="TypeScript" state={{ kind: 'ready' }} />);
    const own = item(host);
    expect(own.tagName).toBe('BUTTON');
    expect(own.getAttribute('type')).toBe('button');
    // In the tab order, not taken out of it.
    expect(own.getAttribute('tabindex') ?? '0').toBe('0');
    expect(details()).toBeNull();
  });

  it('opens the failed server’s details over it, with why it stopped and what to do', async () => {
    const onRestart = vi.fn<() => void>();
    const onShowLog = vi.fn<() => void>();
    const host = render(
      <ServerStatus
        name="TypeScript"
        state={MEMORY}
        version="tsserver 5.6.3"
        onRestart={onRestart}
        onShowLog={onShowLog}
      />,
    );
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.textContent).toContain('TypeScript stopped');
    expect(open.textContent).toContain('tsserver 5.6.3');
    expect(open.textContent).toContain(
      "It ran out of memory at 4 GB while loading 3,880 files. Peek, references and hovers fall back to the syntax index until it's back.",
    );
    // The heading names the dialog.
    expect(open.getAttribute('aria-labelledby')).not.toBeNull();
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Restart', 'Show the log']);
    // The one thing to do is the main button, and has focus as the details open.
    expect(buttons[0]?.className).toContain('bg-accent');
    expect(buttons[1]?.className).not.toContain('bg-accent');
    expect(document.activeElement).toBe(buttons[0]);
    expect(open.getAttribute('data-lo-scope')).toBe('dialog');
  });

  it('starts the server again, or opens its log, and closes the details as it does', async () => {
    const onRestart = vi.fn<() => void>();
    const onShowLog = vi.fn<() => void>();
    const host = render(
      <ServerStatus name="TypeScript" state={MEMORY} onRestart={onRestart} onShowLog={onShowLog} />,
    );
    click(item(host));
    await settle();
    click(
      [...details()!.querySelectorAll('button')].find((b) => b.textContent === 'Show the log')!,
    );
    expect(onShowLog).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    await settle();
    expect(item(host).getAttribute('aria-expanded')).toBe('false');

    click(item(host));
    await settle();
    click([...details()!.querySelectorAll('button')].find((b) => b.textContent === 'Restart')!);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('puts Restart beside a failed server’s name, where it’s one press', () => {
    const onRestart = vi.fn<() => void>();
    const host = render(<ServerStatus name="TypeScript" state={MEMORY} onRestart={onRestart} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['TypeScript failed', 'Restart']);
    // Named for its server, since a bar holds one for each that fails.
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Restart TypeScript');
    // The failed item is tinted, and says why in words besides: a color never stands alone.
    expect(buttons[0]?.className).toContain('bg-danger-bg');
    click(buttons[1]!);
    expect(onRestart).toHaveBeenCalledTimes(1);
    // A server that isn't failed has no such button, and none without a way to restart.
    const ready = render(
      <ServerStatus name="TypeScript" state={{ kind: 'ready' }} onRestart={onRestart} />,
    );
    expect(ready.querySelectorAll('button')).toHaveLength(1);
    const unwired = render(<ServerStatus name="TypeScript" state={MEMORY} />);
    expect(unwired.querySelectorAll('button')).toHaveLength(1);
  });

  it('names the retry of a failed download for its server too', () => {
    const host = render(
      <ServerStatus
        name="Python"
        state={{ kind: 'failed', why: { kind: 'download', message: 'GitHub returned 502.' } }}
        onRestart={() => undefined}
      />,
    );
    expect(host.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe('Retry Python');
  });

  it('keeps focus on its item when the Restart beside it goes with the failure', () => {
    // As a window holds it: once the server is starting, the state is no longer failed.
    const host = render(<Bar />);
    const restart = host.querySelectorAll('button')[1]!;
    focus(restart);
    click(restart);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toBe('TypeScript starting');
    expect(document.activeElement).toBe(item(host));
  });

  it('says what a missing toolchain needs and how to install it', async () => {
    const host = render(
      <ServerStatus
        name="Go"
        state={{ kind: 'missing', needs: 'Go 1.24 or later', install: 'brew install go' }}
        onRestart={() => undefined}
      />,
    );
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.textContent).toContain('Go toolchain missing');
    expect(open.textContent).toContain(
      'Go needs Go 1.24 or later. Install it with brew install go. Until then, peek, references and hovers use the syntax index.',
    );
    expect(open.querySelector('code')?.textContent).toBe('brew install go');
    // Not stopped by anything: no main button.
    expect(open.querySelector('button')?.className).not.toContain('bg-accent');
  });

  it('says only what is needed when there is no command to install it', async () => {
    const host = render(
      <ServerStatus
        name="Swift"
        state={{ kind: 'missing', needs: 'Xcode or a Swift toolchain' }}
      />,
    );
    click(item(host));
    await settle();
    expect(details()?.textContent).toContain(
      'Swift needs Xcode or a Swift toolchain. Until then, peek,',
    );
    expect(details()?.querySelector('code')).toBeNull();
  });

  it('offers to retry a download that failed, in place of restarting', async () => {
    const host = render(
      <ServerStatus
        name="Python"
        state={{
          kind: 'failed',
          why: { kind: 'download', message: "Lo couldn't download Pyright (GitHub returned 502)." },
        }}
        onRestart={() => undefined}
      />,
    );
    expect(host.textContent).toBe('Python failedRetry');
    click(item(host));
    await settle();
    expect(details()?.textContent).toContain("Lo couldn't download Pyright (GitHub returned 502).");
    expect([...details()!.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Retry',
    ]);
  });

  it('says a failure of any other kind in the words it was given', async () => {
    const host = render(
      <ServerStatus
        name="Rust"
        state={{ kind: 'failed', why: { kind: 'error', message: 'It exited with code 101.' } }}
      />,
    );
    click(item(host));
    await settle();
    expect(details()?.textContent).toContain('It exited with code 101. Peek, references');
    // Without handlers there are no buttons to offer.
    expect(details()?.querySelector('button')).toBeNull();
  });

  it('says a failure with no count of files, and what a server coming up falls back to', async () => {
    const host = render(
      <ServerStatus
        name="Java"
        state={{ kind: 'failed', why: { kind: 'memory', limit: '4 GB' } }}
      />,
    );
    click(item(host));
    await settle();
    expect(details()?.textContent).toContain('It ran out of memory at 4 GB. Peek, references');
    cleanUp();

    const starting = render(<ServerStatus name="Java" state={{ kind: 'starting' }} />);
    click(item(starting));
    await settle();
    expect(details()?.textContent).toContain('Java starting');
    expect(details()?.textContent).toContain(
      "Peek, references and hovers use the syntax index until it's ready.",
    );
  });

  it('says nothing more of a ready server than its name and version', async () => {
    const host = render(
      <ServerStatus
        name="TypeScript"
        state={{ kind: 'ready' }}
        version="tsserver 5.6.3"
        onShowLog={() => undefined}
      />,
    );
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.textContent).toBe('TypeScript readytsserver 5.6.3Show the log');
    expect(open.querySelector('p')).toBeNull();
  });

  it('says why language servers are off, and offers to trust the repo', async () => {
    const onChoose = vi.fn<() => void>();
    const host = render(
      <ServerStatus
        name="TypeScript"
        state={{ kind: 'off' }}
        trust={{ action: 'repo', onChoose }}
      />,
    );
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.textContent).toContain('Language servers off');
    expect(open.textContent).toContain(
      'Lo runs language servers only on repos you trust. Until then, peek, references and hovers use the syntax index.',
    );
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Trust this repo…']);
    // The one thing to do has focus, though it has no Restart, and isn't the main button: it asks.
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]?.className).not.toContain('bg-accent');
    click(buttons[0]!);
    expect(onChoose).toHaveBeenCalledTimes(1);
    await settle();
    expect(item(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('puts the trust choice after Restart and the log', async () => {
    const stop: ServerTrust = { action: 'stop', onChoose: () => undefined };
    expect(await labels(stop, { kind: 'ready' })).toEqual([
      'Restart',
      'Show the log',
      'Stop trusting this repo',
    ]);
    expect(await labels({ action: 'pr', onChoose: () => undefined }, { kind: 'off' })).toEqual([
      'Restart',
      'Show the log',
      'Trust this PR…',
    ]);
  });

  it('takes the trust choice and closes the details as it does', async () => {
    const onChoose = vi.fn<() => void>();
    const host = render(
      <ServerStatus
        name="TypeScript"
        state={{ kind: 'ready' }}
        trust={{ action: 'stop', onChoose }}
      />,
    );
    click(item(host));
    await settle();
    // With only this to press, it has focus as the details open.
    const only = details()!.querySelector('button')!;
    expect(only.textContent).toBe('Stop trusting this repo');
    expect(document.activeElement).toBe(only);
    click(only);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('shows the format characters in what a server or the toolchain said', async () => {
    const host = render(
      <ServerStatus
        name={'Type\u200BScript'}
        state={{ kind: 'failed', why: { kind: 'error', message: 'It said evil\u202Elive.' } }}
        version={'tsserver 5.\u202E6'}
        onRestart={() => undefined}
      />,
    );
    expect(host.textContent).toBe('TypeU+200BScript failedRestart');
    expect(host.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe(
      'Restart Type\u2039U+200B\u203AScript',
    );
    click(item(host));
    await settle();
    expect(details()?.textContent).not.toMatch(/\p{Cf}/u);
    expect(details()?.textContent).toContain('It said evilU+202Elive.');
    expect(details()?.textContent).toContain('tsserver 5.U+202E6');
    cleanUp();
    const missing = render(
      <ServerStatus
        name="Go"
        state={{ kind: 'missing', needs: 'Go\u202E 1.24', install: 'brew\u200B install go' }}
      />,
    );
    click(item(missing));
    await settle();
    expect(details()?.textContent).toContain(
      'Go needs GoU+202E 1.24. Install it with brewU+200B install go.',
    );
  });

  it('hands focus to the next item when it is drawn again and had focus in its details', async () => {
    const host = render(<Redrawn around />);
    click(item(host));
    await settle();
    const stop = details()!.querySelector('button')!;
    expect(document.activeElement).toBe(stop);
    click(stop);
    await settle();
    // The caller drew another item for the new state; focus is on the bar's next, not the page.
    expect(host.querySelector('footer')?.textContent).toContain('Language servers off');
    expect(document.activeElement).toBe(host.querySelector('#after'));
  });

  it('hands focus to the previous item when it was the last, and to the bar when it was alone', async () => {
    const last = render(<Redrawn before />);
    click(item(last));
    await settle();
    click(details()!.querySelector('button')!);
    await settle();
    expect(document.activeElement).toBe(last.querySelector('#before'));
    cleanUp();

    const alone = render(<Redrawn />);
    click(item(alone));
    await settle();
    click(details()!.querySelector('button')!);
    await settle();
    const footer = alone.querySelector('footer')!;
    expect(document.activeElement).toBe(footer);
    // The bar holds it only until it goes elsewhere: it was never a stop for `Tab`.
    act(() => footer.blur());
    expect(footer.hasAttribute('tabindex')).toBe(false);
  });

  it('hands focus on when the item goes while its details are open, and leaves focus that was elsewhere', async () => {
    const host = render(bar(true));
    click(item(host));
    await settle();
    expect(details()).not.toBeNull();
    expect(details()?.contains(document.activeElement)).toBe(true);
    rerender(host, bar(false));
    await settle();
    expect(document.activeElement).toBe(host.querySelector('#after'));

    // With focus on another button of the bar, an item that goes takes none of it with it.
    rerender(host, bar(true));
    focus(host.querySelector<HTMLElement>('#before')!);
    rerender(host, bar(false));
    expect(document.activeElement).toBe(host.querySelector('#before'));
  });

  it('closes on Esc and gives focus back to its item', async () => {
    const host = render(
      <ServerStatus name="TypeScript" state={MEMORY} onRestart={() => undefined} />,
    );
    click(item(host));
    await settle();
    expect(details()).not.toBeNull();
    press(document.activeElement ?? document.body, 'Escape');
    await settle();
    expect(item(host).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(item(host));
  });

  it('follows its owner when the details are opened and closed from outside', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const host = render(
      <ServerStatus name="TypeScript" state={MEMORY} open={false} onOpenChange={onOpenChange} />,
    );
    click(item(host));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // The owner said closed, so closed it stays.
    await settle();
    expect(details()).toBeNull();
  });

  it('draws a wider card for its details than a menu, and keeps it inside a narrow window', async () => {
    const css = await buildCss(['server-details']);
    expect(declarations(css, 'server-details')).toBe(
      'width: 360px; max-width: calc(100vw - var(--lo-sp-32));',
    );
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <ServerStatus name="TypeScript" state={MEMORY} onRestart={() => undefined} />
        <ServerStatus name="Rust" state={{ kind: 'downloading', done: 1, total: 2 }} />
        <ServerStatus name="Go" state={{ kind: 'missing', needs: 'Go' }} />
      </>,
    );
    click(host.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!);
    await settle();
    expect(await missingRules(host)).toEqual([]);
    expect(await missingRules(document.body)).toEqual([]);
  });
});

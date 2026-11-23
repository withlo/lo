// @vitest-environment jsdom
// A language server's item in the status bar: what each state says and shows, the details it opens
// over itself, and the buttons that start the server again or open its log.

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, press, render, rerender } from '../test/dom.ts';
import { CopyRoute } from './CopyButton.tsx';
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
/** What a button says now: the face that shows, for one that can be busy. */
function says(button: Element | null | undefined): string {
  const face = button?.querySelector('span > span:not([aria-hidden])') ?? button;
  return face?.textContent ?? '';
}

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

/** How an item for a server in `state` draws its ball: a spinner while at work, or its state. */
function ball(state: ServerState): string | undefined {
  const own = item(render(<ServerStatus name="TypeScript" state={state} />));
  if (own.querySelector('.spinner') !== null) return 'working';
  return own.querySelector('[data-ball]')?.getAttribute('data-ball') ?? undefined;
}

/**
 * A status bar whose item the caller draws again, under a key of its own, once trust is stopped:
 * it says "Language servers off" then. A button before it and after it are the bar's other items.
 */
function Redrawn({ before = false, around = false }: { before?: boolean; around?: boolean }) {
  const [drawn, setDrawn] = useState(0);
  return (
    <footer aria-label="Status bar">
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
    <footer aria-label="Status bar">
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
  const found = [...details()!.querySelectorAll('button')].map(says);
  cleanUp();
  return found;
}

/** An item for servers that are off, offering `trust`. */
const offItem = (trust: ServerTrust) => (
  <ServerStatus name="TypeScript" state={{ kind: 'off' }} trust={trust} />
);
describe('ServerStatus', () => {
  it('says each state in the one phrase that fits, with its numbers', () => {
    // In the units Settings counts in, the whole's unit once where they share one.
    expect(say('TypeScript', { kind: 'downloading', done: 12_300_000, total: 40_100_000 })).toBe(
      'Downloading TypeScript · 11.7 / 38.2 MB',
    );
    expect(say('TypeScript', { kind: 'downloading', done: 900_000, total: 40_100_000 })).toBe(
      'Downloading TypeScript · 879 KB / 38.2 MB',
    );
    expect(say('Java', { kind: 'unpacking' })).toBe('Installing Java…');
    expect(say('Go', { kind: 'building' })).toBe('Building Go…');
    expect(say('Go', { kind: 'waiting', count: 4, next: false })).toBe('Go · waiting to start');
    expect(say('PHP', { kind: 'waiting', count: 4, next: true })).toBe('PHP · waiting to start');
    expect(say('TypeScript', { kind: 'starting' })).toBe('Starting TypeScript…');
    expect(say('TypeScript', { kind: 'indexing', percent: 40 })).toBe(
      'Indexing with TypeScript · 40%',
    );
    expect(say('TypeScript', { kind: 'indexing' })).toBe('Indexing with TypeScript…');
    expect(say('TypeScript', { kind: 'ready' })).toBe('TypeScript');
    expect(say('TypeScript', { kind: 'notAnswering' })).toBe('TypeScript isn’t responding');
    expect(say('Rust', { kind: 'refused', why: 'Lo won’t run it.' })).toBe(
      'Rust can’t use the local copy',
    );
    expect(say('TypeScript', MEMORY)).toBe('TypeScript isn’t running');
    expect(say('Go', { kind: 'missing', needs: 'Go 1.24 or newer' })).toBe(
      'Go needs Go 1.24 or newer',
    );
    // An untrusted repo has none of them on, whichever server is named.
    expect(say('TypeScript', { kind: 'off' })).toBe('Language servers off');
  });

  it('keeps a progress report to the scale it is on', () => {
    const host = render(<ServerStatus name="Rust" state={{ kind: 'indexing', percent: 140.4 }} />);
    expect(words(host)).toBe('Indexing with Rust · 100%');
  });

  it('draws its ball: a spinner at work, filled once ready, amber waiting, red once it can’t run', () => {
    for (const state of [
      { kind: 'downloading', done: 1, total: 2 },
      { kind: 'unpacking' },
      { kind: 'building' },
      { kind: 'starting' },
      { kind: 'indexing' },
    ] as const) {
      expect(ball(state)).toBe('working');
    }
    expect(ball({ kind: 'ready' })).toBe('ready');
    expect(ball(MEMORY)).toBe('failed');
    expect(ball({ kind: 'missing', needs: 'a JDK' })).toBe('failed');
    expect(ball({ kind: 'notAnswering' })).toBe('failed');
    // Waiting holds back, and isn't a failure.
    expect(ball({ kind: 'waiting', count: 4, next: false })).toBe('warn');
    // Refused is settled, as off is: a ring, with nothing to wait for or mend.
    expect(ball({ kind: 'refused', why: 'Lo won’t run it.' })).toBe('off');
    expect(ball({ kind: 'off' })).toBe('off');
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
    // An Error: a title, the reason the guide gives, and its numbers behind Details.
    const alert = open.querySelector('[role="alert"]');
    expect([...(alert?.querySelectorAll('p') ?? [])].map((line) => line.textContent)).toEqual([
      'Can’t run TypeScript',
      'It ran out of memory.',
    ]);
    expect(open.textContent).not.toContain('tsserver 5.6.3');
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map(says)).toEqual(['Restart', 'Details', 'Show log']);
    // In one row: what helps first, then Details, then the log.
    expect(new Set(buttons.map((button) => button.parentElement)).size).toBe(1);
    // Restart is the one thing to do; it has focus as the details open.
    expect(document.activeElement).toBe(buttons[0]);
    click(buttons[1]!);
    expect(open.textContent).toContain('4 GB, 3,880 files');
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
    click([...details()!.querySelectorAll('button')].find((b) => b.textContent === 'Show log')!);
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
    expect(buttons.map((button) => button.textContent)).toEqual([
      'TypeScript isn’t running',
      'Restart',
    ]);
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
    expect(host.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe('Try again Python');
  });

  it('keeps focus on its item when the Restart beside it goes with the failure', () => {
    // As a window holds it: once the server is starting, the state is no longer failed.
    const host = render(<Bar />);
    const restart = host.querySelectorAll('button')[1]!;
    focus(restart);
    click(restart);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toBe('Starting TypeScript…');
    expect(document.activeElement).toBe(item(host));
  });

  it('says what a missing toolchain needs, and gives the command that installs it to copy', async () => {
    const copy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const host = render(
      <CopyRoute copy={copy}>
        <ServerStatus
          name="Go"
          state={{ kind: 'missing', needs: 'Go 1.24 or newer', install: 'brew install go' }}
          onRestart={() => undefined}
          onShowLog={() => undefined}
        />
      </CopyRoute>,
    );
    click(item(host));
    await settle();
    const open = details()!;
    const alert = open.querySelector('[role="alert"]');
    expect([...(alert?.querySelectorAll('p') ?? [])].map((line) => line.textContent)).toEqual([
      'Can’t run Go',
      'It needs Go 1.24 or newer.',
    ]);
    // The command in its own well, with Copy; then one row, with nothing to start again until
    // it's installed.
    expect(open.querySelector('pre')?.textContent).toBe('brew install go');
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map(says)).toEqual(['Copy', 'Show log']);
    await act(async () => {
      buttons[0]!.click();
      await Promise.resolve();
    });
    expect(copy).toHaveBeenCalledWith('brew install go');
  });

  it('says why one waits for room, and offers to start it next unless it is next already', async () => {
    const onRestart = vi.fn<() => void>();
    const host = render(
      <ServerStatus
        name="Go"
        state={{ kind: 'waiting', count: 4, next: false }}
        onRestart={onRestart}
        onShowLog={() => undefined}
      />,
    );
    // Nothing beside its name: it isn't failed, and starts by itself.
    expect(host.querySelectorAll('button')).toHaveLength(1);
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.querySelector('p')?.textContent).toBe('At most 4 language servers run at once.');
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Start next', 'Show log']);
    click(buttons[0]!);
    expect(onRestart).toHaveBeenCalledTimes(1);
    cleanUp();

    const next = render(
      <ServerStatus
        name="PHP"
        state={{ kind: 'waiting', count: 4, next: true }}
        onRestart={onRestart}
        onShowLog={() => undefined}
      />,
    );
    click(item(next));
    await settle();
    expect([...details()!.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Show log',
    ]);
  });

  it('says why one was refused, and offers no Restart', async () => {
    const why =
      'The checkout’s .cargo/config.toml has an [env] table, so Lo won’t run rust-analyzer on it.';
    const host = render(
      <ServerStatus
        name="Rust"
        state={{ kind: 'refused', why }}
        onRestart={() => undefined}
        onShowLog={() => undefined}
      />,
    );
    expect(host.querySelectorAll('button')).toHaveLength(1);
    click(item(host));
    await settle();
    const open = details()!;
    expect(open.querySelector('p')?.textContent).toBe(why);
    expect([...open.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Show log',
    ]);
  });

  it('says only what is needed when there is no command to install it', async () => {
    const host = render(<ServerStatus name="Java" state={{ kind: 'missing', needs: 'a JDK' }} />);
    click(item(host));
    await settle();
    expect(details()?.textContent).toBe('Can’t run Java It needs a JDK.');
    expect(details()?.querySelector('button')).toBeNull();
  });

  it('says “They need” for what it needs that is named as more than one', async () => {
    const host = render(
      <ServerStatus
        name="Swift"
        state={{
          kind: 'missing',
          needs: 'Apple’s Command Line Tools',
          install: 'xcode-select --install',
          plural: true,
        }}
      />,
    );
    click(item(host));
    await settle();
    expect(details()?.textContent).toContain('They need Apple’s Command Line Tools.');
  });

  it('offers to try a download that failed again, in place of restarting', async () => {
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
    expect(host.textContent).toBe('Python isn’t runningTry again');
    click(item(host));
    await settle();
    // What it said is its own sentence, so it's behind Details, and the Problem holds the button.
    const buttons = [...details()!.querySelectorAll('button')];
    expect(buttons.map(says)).toEqual(['Try again', 'Details']);
    click(buttons[1]!);
    expect(details()?.textContent).toContain("Lo couldn't download Pyright (GitHub returned 502).");
  });

  it('says a failure of any other kind with no reason, and its words behind Details', async () => {
    const host = render(
      <ServerStatus
        name="Rust"
        state={{ kind: 'failed', why: { kind: 'error', message: 'It exited with code 101.' } }}
      />,
    );
    click(item(host));
    await settle();
    expect(details()?.querySelector('[role="alert"]')?.textContent).toBe('Can’t run Rust');
    // Without handlers there's nothing to offer but Details.
    expect([...details()!.querySelectorAll('button')].map(says)).toEqual(['Details']);
  });

  it('says a memory failure with no count of files, and nothing more of a server coming up', async () => {
    const host = render(
      <ServerStatus
        name="Java"
        state={{ kind: 'failed', why: { kind: 'memory', limit: '4 GB' } }}
      />,
    );
    click(item(host));
    await settle();
    click(details()!.querySelector('button')!);
    expect(details()?.textContent).toContain('It ran out of memory.');
    expect(details()?.textContent).toContain('4 GB');
    expect(details()?.textContent).not.toContain('files');
    cleanUp();

    const starting = render(<ServerStatus name="Java" state={{ kind: 'starting' }} />);
    click(item(starting));
    await settle();
    expect(details()?.textContent).toBe('');
  });

  it('says nothing more of a ready server than its version', async () => {
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
    expect(open.textContent).toBe('tsserver 5.6.3Show log');
    // The details are named for the item, as it says itself.
    expect(open.getAttribute('aria-label')).toBe('TypeScript');
  });

  it('says what language servers are off for, in the line it’s given, and offers to trust it', async () => {
    const onChoose = vi.fn<() => void>();
    const host = render(
      <ServerStatus
        name="TypeScript"
        state={{ kind: 'off' }}
        line="Language servers are off for rozed-dev/e2e"
        trust={{ action: 'repo', onChoose }}
      />,
    );
    expect(words(host)).toBe('Language servers off');
    click(item(host));
    await settle();
    const open = details()!;
    // One fact, about the repo: never Lo as its subject.
    expect(open.querySelector('p')?.textContent).toBe('Language servers are off for rozed-dev/e2e');
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map(says)).toEqual(['Trust repo…']);
    // The one thing to do has focus, though it has no Restart, and isn't the main button: it asks.
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]?.className).not.toContain('bg-accent');
    click(buttons[0]!);
    expect(onChoose).toHaveBeenCalledTimes(1);
    await settle();
    // The details stay open, to say how asking goes.
    expect(item(host).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens unasked, as an offer, leaving focus where the reader is', async () => {
    const elsewhere = render(
      <button type="button" id="elsewhere">
        Elsewhere
      </button>,
    );
    const away = elsewhere.querySelector<HTMLElement>('#elsewhere')!;
    focus(away);
    render(
      <ServerStatus
        name="TypeScript"
        state={{ kind: 'off' }}
        line="Language servers are off for rozed-dev/e2e"
        trust={{ action: 'repo', onChoose: () => undefined }}
        open
        quiet
      />,
    );
    await settle();
    expect(details()?.textContent).toContain('Language servers are off for rozed-dev/e2e');
    expect(document.activeElement).toBe(away);
  });

  it('waits while Lo trusts, keeping focus, then says why it didn’t, with what helps', async () => {
    const onChoose = vi.fn<() => void>();
    const fix = vi.fn<() => void>();
    const host = render(offItem({ action: 'repo', onChoose, busy: 'Trusting' }));
    click(item(host));
    await settle();
    const [button] = details()!.querySelectorAll('button');
    expect(says(button)).toBe('Trusting');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.querySelector('.spinner')).not.toBeNull();
    expect(document.activeElement).toBe(button);
    // Pressed again, it does nothing until it's done.
    click(button!);
    expect(onChoose).not.toHaveBeenCalled();
    const title = 'Couldn’t trust rozed-dev/e2e';
    const message = "The settings file isn't valid JSON.";
    rerender(
      host,
      offItem({
        action: 'repo',
        onChoose,
        failure: { title, message, fix: { label: 'Open settings.json', onChoose: fix } },
      }),
    );
    await settle();
    const open = details()!;
    // What failed, then why, said once as an alert, and the button that helps after the reason.
    const alert = open.querySelector('[role="alert"]');
    expect([...(alert?.children ?? [])].map((line) => line.textContent)).toEqual([title, message]);
    const buttons = [...open.querySelectorAll('button')];
    expect(buttons.map(says)).toEqual(['Open settings.json', 'Trust repo…']);
    // The button is back, and still has focus.
    expect(buttons[1]).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    click(buttons[0]!);
    expect(fix).toHaveBeenCalledTimes(1);
    click(buttons[1]!);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('puts the trust choice after Restart and the log', async () => {
    const stop: ServerTrust = { action: 'stop', onChoose: () => undefined };
    expect(await labels(stop, { kind: 'ready' })).toEqual(['Restart', 'Show log', 'Stop trusting']);
    expect(await labels({ action: 'pr', onChoose: () => undefined }, { kind: 'off' })).toEqual([
      'Restart',
      'Show log',
      'Trust pull request…',
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
    expect(says(only)).toBe('Stop trusting');
    expect(document.activeElement).toBe(only);
    click(only);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('shows the format characters in what a server or the toolchain said', async () => {
    const host = render(
      <ServerStatus
        name={'Type\u200BScript'}
        state={{ kind: 'refused', why: 'It said evil\u202Elive.' }}
        onRestart={() => undefined}
      />,
    );
    expect(host.textContent).toBe('TypeU+200BScript can’t use the local copy');
    click(item(host));
    await settle();
    expect(details()?.textContent).not.toMatch(/\p{Cf}/u);
    expect(details()?.textContent).toContain('It said evilU+202Elive.');
    cleanUp();
    const failed = render(
      <ServerStatus
        name={'Type\u200BScript'}
        state={MEMORY}
        version={'tsserver 5.\u202E6'}
        onRestart={() => undefined}
      />,
    );
    expect(failed.textContent).toBe('TypeU+200BScript isn’t runningRestart');
    expect(failed.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe(
      'Restart Type\u2039U+200B\u203AScript',
    );
    click(item(failed));
    await settle();
    expect(details()?.textContent).not.toMatch(/\p{Cf}/u);
    expect(details()?.textContent).toContain('Can’t run TypeU+200BScript');
    cleanUp();
    const missing = render(
      <ServerStatus name="Go" state={{ kind: 'missing', needs: 'Go\u202E 1.24' }} />,
    );
    click(item(missing));
    await settle();
    expect(details()?.textContent).toContain('It needs GoU+202E 1.24.');
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

  it('draws its details as wide as they say, 280 to 420 px, and inside a narrow window', async () => {
    const css = await buildCss(['status-details']);
    expect(declarations(css, 'status-details')).toBe(
      'width: max-content; min-width: min(280px, calc(100vw - var(--lo-sp-32))); max-width: min(420px, calc(100vw - var(--lo-sp-32)));',
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

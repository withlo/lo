// @vitest-environment jsdom
import { NO_TARGET } from '@lo/ui/commands';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bridge } from '../../../ipc/bridge.ts';
import type { Result } from '../../../ipc/contract.ts';
import { keymapState } from '../../../window/commands/keymap.ts';
import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import type { KeymapFile } from '../contract.ts';
import keys from './index.ts';

type Listener = (value: unknown) => void;

/** A bridge main answers through: what each request replies, and the pushes the window hears. */
function fakeBridge(answers: Record<string, () => Promise<Result<unknown>>>) {
  const listeners = new Map<string, Listener>();
  const invoke = vi.fn<Bridge['invoke']>(async (channel) => {
    const answer = Object.hasOwn(answers, channel) ? answers[channel] : undefined;
    if (answer) return answer();
    // Main has no file unless a test says there is one.
    return {
      ok: true,
      value: channel === 'keys.readKeymap' ? { text: '', canOpen: true } : undefined,
    };
  });
  const bridge: Bridge = {
    invoke,
    subscribe: vi.fn<Bridge['subscribe']>((topic, listener) => {
      listeners.set(topic, listener);
      return () => listeners.delete(topic);
    }),
  };
  return {
    bridge,
    push: (topic: string, value: unknown) => listeners.get(topic)?.(value),
    invoked: (channel: string) => invoke.mock.calls.filter(([each]) => each === channel).length,
  };
}

const ok = (value: unknown): Result<unknown> => ({ ok: true, value });
const file = (text: string, problem?: string, canOpen = problem === undefined): KeymapFile =>
  problem === undefined ? { text, canOpen } : { text, problem, canOpen };

/** The keys `id` has now, as the registry writes them. */
function keysOf(id: string): string[] {
  return registry()
    .keysOf(id)
    .map((strokes) => strokes.map((stroke) => stroke.id).join(' '));
}

/** Starts the keys feature on a bridge, as the window does. */
function start(bridge: Bridge): void {
  Reflect.set(window, 'lo', bridge);
  keys.start?.();
}

beforeEach(() => {
  createRegistry(keys.commands, 'linux');
});

describe('the keymap file in the window', () => {
  it('applies the file main has read when the window starts', async () => {
    const { bridge } = fakeBridge({
      'keys.readKeymap': async () => ok(file('bind ctrl+b keys.back\nvim normal Y y$')),
    });
    start(bridge);
    await vi.waitFor(() => expect(keysOf('keys.back')).toEqual(['ctrl+b', 'ctrl+o']));
    expect(registry().vimKeys()).toContainEqual({
      kind: 'map',
      mode: 'normal',
      keys: 'Y',
      to: 'y$',
    });
    expect(keymapState()).toEqual({ problem: undefined, canOpen: true });
  });

  it('applies each change main pushes, over the last file, and reports its bad lines', async () => {
    const { bridge, push } = fakeBridge({ 'keys.readKeymap': async () => ok(file('')) });
    start(bridge);
    push('keys.keymap', file('bind ctrl+b keys.back\nbind x nope.nothing\nvim normal Y y$'));
    expect(keysOf('keys.back')).toEqual(['ctrl+b', 'ctrl+o']);
    expect(registry().keymapErrors()).toEqual([
      { line: 2, message: "There's no command called nope.nothing." },
    ]);
    push('keys.keymap', file('bind ctrl+k keys.back'));
    expect(keysOf('keys.back')).toEqual(['ctrl+k', 'ctrl+o']);
    expect(registry().keymapErrors()).toEqual([]);
    // The vim line went with the file it was in.
    expect(
      registry()
        .vimKeys()
        .filter((key) => key.kind === 'map'),
    ).toEqual([]);
    // No file is no remaps.
    push('keys.keymap', file(''));
    expect(keysOf('keys.back')).toEqual(['ctrl+o']);
  });

  it('keeps a change pushed before main’s answer, which was given from an older file', async () => {
    const answer = Promise.withResolvers<Result<unknown>>();
    const { bridge, push } = fakeBridge({ 'keys.readKeymap': () => answer.promise });
    start(bridge);
    push('keys.keymap', file('bind ctrl+k keys.back'));
    answer.resolve(ok(file('bind ctrl+b keys.back')));
    await new Promise((done) => setTimeout(done, 20));
    expect(keysOf('keys.back')).toEqual(['ctrl+k', 'ctrl+o']);
  });

  it('shows what is wrong with the file as a whole until a file that is fine', () => {
    const { bridge, push } = fakeBridge({});
    start(bridge);
    push('keys.keymap', file('', "The keymap file is over 1 MiB, so Lo didn't read it."));
    expect(keymapState()).toEqual({
      problem: "The keymap file is over 1 MiB, so Lo didn't read it.",
      canOpen: false,
    });
    expect(keysOf('keys.back')).toEqual(['ctrl+o']);
    push('keys.keymap', file('bind ctrl+b keys.back'));
    expect(keymapState()).toEqual({ problem: undefined, canOpen: true });
  });

  it('opens the file through main, and says why in a toast when main can’t', async () => {
    let result = ok(undefined);
    const { bridge, invoked } = fakeBridge({ 'keys.openKeymap': async () => result });
    start(bridge);
    expect(registry().run('keys.openKeymap', NO_TARGET)).toBe(true);
    await vi.waitFor(() => expect(invoked('keys.openKeymap')).toBe(1));
    expect(notice()).toBeUndefined();

    result = {
      ok: false,
      error: { code: 'unopened', message: "Lo couldn't open the keymap file in a text editor." },
    };
    registry().run('keys.openKeymap', NO_TARGET);
    await vi.waitFor(() =>
      expect(notice()).toEqual({
        title: 'Open the keymap file',
        body: "Lo couldn't open the keymap file in a text editor.",
      }),
    );

    // A failure main didn't mean to show is told in Lo's words, not main's.
    result = { ok: false, error: { code: 'internal', message: 'keys.openKeymap failed.' } };
    registry().run('keys.openKeymap', NO_TARGET);
    await vi.waitFor(() => expect(notice()?.body).toBe("Lo couldn't open the keymap file."));
  });

  it('refuses to ask main to open a file main has said it won’t, and says why', () => {
    const { bridge, push, invoked } = fakeBridge({});
    start(bridge);
    const why =
      "The keymap file is executable, so Lo won't open it, which could run it. Clear its execute permission to open it from here.";
    // An executable file's keys still apply, with the reason beside them.
    push('keys.keymap', { text: 'bind ctrl+b keys.back', problem: why, canOpen: false });
    expect(keysOf('keys.back')).toEqual(['ctrl+b', 'ctrl+o']);
    expect(keymapState()).toEqual({ problem: why, canOpen: false });
    expect(registry().enabled('keys.openKeymap', NO_TARGET)).toBe(why);
    expect(registry().run('keys.openKeymap', NO_TARGET)).toBe(why);
    expect(notice()).toEqual({ title: 'Open the keymap file', body: why });
    expect(invoked('keys.openKeymap')).toBe(0);
    // Once the file can be opened, it is asked for again.
    push('keys.keymap', file(''));
    expect(registry().run('keys.openKeymap', NO_TARGET)).toBe(true);
  });
});

describe('a keymap file that tries to do harm', () => {
  it('runs nothing and takes nothing but keys for commands, whatever a line says', () => {
    const { bridge, push } = fakeBridge({});
    start(bridge);
    const hostile = [
      'bind ctrl+b keys.back; process.exit()',
      'bind ctrl+b constructor.constructor',
      'bind ctrl+b __proto__.polluted',
      'bind ctrl+b keys.toString',
      'unbind __proto__ __proto__.x',
      'vim normal <C-b> :!rm -rf ~<CR>',
      '${process.env.HOME}',
      '`rm -rf /`',
      `bind ${'ctrl+b '.repeat(100)} keys.back`,
      `bind ctrl+b keys.back${' '.repeat(2000)}`,
    ].join('\n');
    push('keys.keymap', file(hostile));
    expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined();
    // Only the `vim` line and the long sequence apply; the rest are reported by line.
    expect(
      registry()
        .keymapErrors()
        .map((error) => error.line),
    ).toEqual([1, 2, 3, 4, 5, 7, 8, 10]);
    expect(registry().vimKeys()).toContainEqual({
      kind: 'map',
      mode: 'normal',
      keys: '<C-b>',
      to: ':!rm -rf ~<CR>',
    });
  });
});

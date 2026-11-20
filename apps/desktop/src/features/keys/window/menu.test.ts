// @vitest-environment jsdom
// The app menu kept in step with the registry: it's sent as the window starts, again when a feature
// says whether a command can run has changed, though neither focus nor a key did, and not again
// when nothing in it did.

import { defineCommands, handlers } from '@lo/ui/commands';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { menuStale } from '../../../window/commands/bar.ts';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import { z } from 'zod';

import { barItem, type BarItem } from '../contract.ts';
import keys from '../keys.ts';
import feature from './index.ts';

/** Whether the stand-in feature's command can run, which a test changes. */
let applies = false;

const declarations = defineCommands('stand', {
  restart: {
    label: 'Restart to update',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 3 },
  },
});

/** What the window sends main for its menu. */
const barMenu = z.object({ items: z.array(barItem) });

/** The menus main was sent, in order. */
const sent: BarItem[][] = [];

installBridge({
  'keys.readKeymap': () => ({ text: '', canOpen: true }),
  'keys.menu': (input) => {
    sent.push(barMenu.parse(input).items);
  },
});

beforeAll(() => {
  createRegistry(
    [
      ...(feature.commands ?? []),
      ...handlers(declarations, {
        restart: { run() {}, enabled: () => (applies ? true : 'No update is ready.') },
      }),
    ],
    'mac',
  );
  feature.start?.();
});

afterEach(() => {
  applies = false;
});

/** Lets the menu's microtask send what's changed. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** Whether the stand-in's item was enabled in the menu last sent. */
const enabled = () => sent.at(-1)?.find((item) => item.id === 'stand.restart')?.enabled;

describe('the app menu', () => {
  it('is sent as the window starts, with a command that can’t run greyed', () => {
    expect(keys.feature).toBe('keys');
    expect(sent.length).toBeGreaterThan(0);
    expect(enabled()).toBe(false);
  });

  it('is sent again when a feature says what can run has changed, and not when nothing did', async () => {
    await settle();
    const before = sent.length;
    menuStale();
    await settle();
    // Nothing in the menu is different: nothing is sent.
    expect(sent).toHaveLength(before);
    applies = true;
    menuStale();
    await settle();
    expect(sent).toHaveLength(before + 1);
    expect(enabled()).toBe(true);
    applies = false;
    menuStale();
    await settle();
    expect(sent).toHaveLength(before + 2);
    expect(enabled()).toBe(false);
  });
});

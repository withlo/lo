// @vitest-environment jsdom
// Dismissing the stacks' offers: each one's menu lists its own rows, which act on the tab the offer
// is in, from the palette on the tab on screen, and only while it offers them, the offer of a
// GitHub stack wherever it's made; "for this stack" or "for #84" asks main to keep it, and "for all
// stacks" turns its setting off.

import { expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as SettingsShared from '../../settings/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { StackView } from '../contract.ts';
import { offerConvert, offerStart } from '../settings.ts';
import {
  convertNotice,
  dismissConvert,
  dismissStart,
  offerConvertSwitch,
  offerStartSwitch,
  startNotice,
} from './dismiss.ts';
import { stacks } from './layers.ts';
import { offers } from './offers.ts';

// The tab on screen, as the tab feature names it; the tab feature isn't loaded.
const on = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => on.tab,
}));
const settings = vi.hoisted(() => ({
  changed: [] as [string, unknown][],
  values: new Map<string, unknown>(),
}));
vi.mock('../../settings/window/shared.ts', async (original) => ({
  ...(await original<typeof SettingsShared>()),
  changeSetting: (setting: { key: string }, value: unknown) => {
    settings.changed.push([setting.key, value]);
    return Promise.resolve(true);
  },
  settingNow: (setting: { key: string; fallback: unknown }) =>
    settings.values.get(setting.key) ?? setting.fallback,
}));

const bridge = installBridge({ 'stacks.dismiss': () => undefined });

const TAB: PullTab = {
  id: 't1:84',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 84,
  title: 'c',
  state: 'open',
};

/** Another pull request's tab. */
const OTHER: PullTab = { ...TAB, id: 't2:19', repo: 'other', number: 19, title: 'd' };

const NONE = { kind: 'none' } as const;
const CONVERT_NOTICE = convertNotice(TAB);
const START_NOTICE = startNotice(TAB);

it('lists each offer’s rows in its own menu alone, and in the palette', () => {
  for (const handler of [dismissConvert, offerConvertSwitch]) {
    expect(handler.listed?.(CONVERT_NOTICE)).toBe(true);
    expect(handler.listed?.(START_NOTICE)).toBe(false);
    expect(handler.listed?.(NONE)).toBe(true);
  }
  for (const handler of [dismissStart, offerStartSwitch]) {
    expect(handler.listed?.(START_NOTICE)).toBe(true);
    expect(handler.listed?.(CONVERT_NOTICE)).toBe(false);
  }
});

it('dismisses an offer for the stack or layer on screen, only while it’s offered there', async () => {
  on.tab = undefined;
  expect(dismissConvert.enabled?.(NONE)).toBe('');
  on.tab = TAB;
  stacks.set(TAB.id, { kind: 'none' });
  expect(dismissConvert.enabled?.(NONE)).toBe('');
  expect(dismissStart.enabled?.(NONE)).toBe('');
  stacks.set(TAB.id, {
    kind: 'stack',
    root: 'main',
    start: null,
    githubStack: false,
    rows: [],
    notes: [],
    offered: true,
    callout: 'This branch stack merges one layer at a time.',
  });
  offers.set(TAB.id, { title: 'This diff includes #83’s changes', action: 'Hide', commit: null });
  expect(dismissConvert.enabled?.(CONVERT_NOTICE)).toBe(true);
  expect(dismissStart.enabled?.(START_NOTICE)).toBe(true);
  expect(dismissStart.named?.(START_NOTICE)).toBe('Dismiss for #84');
  await dismissConvert.run(CONVERT_NOTICE);
  await dismissStart.run(START_NOTICE);
  expect(bridge.calls.filter(([channel]) => channel === 'stacks.dismiss')).toEqual([
    ['stacks.dismiss', { id: TAB.id, notice: 'convert' }],
    ['stacks.dismiss', { id: TAB.id, notice: 'start' }],
  ]);
});

it('lists the offer of a GitHub stack’s dismissal in its menu while it’s offered, as in the merge panel where the tree makes none, and in the palette while the tree makes it', () => {
  on.tab = TAB;
  const stack: StackView = {
    kind: 'stack',
    root: 'main',
    start: null,
    githubStack: false,
    rows: [],
    notes: [],
    offered: true,
    callout: null,
  };
  stacks.set(TAB.id, stack);
  expect(dismissConvert.enabled?.(CONVERT_NOTICE)).toBe(true);
  expect(dismissConvert.enabled?.(NONE)).toBe('');
  // Dismissed for the stack, or turned off: neither the tree nor the merge panel makes it.
  stacks.set(TAB.id, { ...stack, offered: false });
  expect(dismissConvert.enabled?.(CONVERT_NOTICE)).toBe('');
  expect(dismissConvert.enabled?.(NONE)).toBe('');
});

it('dismisses an offer in the tab its menu was opened in, though another is on screen by then', async () => {
  on.tab = TAB;
  stacks.set(TAB.id, {
    kind: 'stack',
    root: 'main',
    start: null,
    githubStack: false,
    rows: [],
    notes: [],
    offered: true,
    callout: 'This branch stack merges one layer at a time.',
  });
  offers.set(TAB.id, { title: 'This diff includes #83’s changes', action: 'Hide', commit: null });
  on.tab = OTHER;
  bridge.calls.length = 0;
  expect(dismissConvert.enabled?.(CONVERT_NOTICE)).toBe(true);
  expect(dismissStart.enabled?.(START_NOTICE)).toBe(true);
  expect(dismissStart.named?.(START_NOTICE)).toBe('Dismiss for #84');
  // From the palette, it's the tab on screen's, which offers neither.
  expect(dismissConvert.enabled?.(NONE)).toBe('');
  expect(dismissStart.named?.(NONE)).toBe('Dismiss for #19');
  await dismissConvert.run(CONVERT_NOTICE);
  await dismissStart.run(START_NOTICE);
  expect(bridge.calls.filter(([channel]) => channel === 'stacks.dismiss')).toEqual([
    ['stacks.dismiss', { id: TAB.id, notice: 'convert' }],
    ['stacks.dismiss', { id: TAB.id, notice: 'start' }],
  ]);
});

it('turns an offer off from its menu, and either way from the palette, checked while on', async () => {
  settings.changed.length = 0;
  expect(offerConvertSwitch.checked?.(NONE)).toBe(true);
  await offerConvertSwitch.run(CONVERT_NOTICE);
  settings.values.set(offerStart.key, false);
  expect(offerStartSwitch.checked?.(NONE)).toBe(false);
  await offerStartSwitch.run(NONE);
  expect(settings.changed).toEqual([
    [offerConvert.key, false],
    [offerStart.key, true],
  ]);
});

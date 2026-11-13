import { parseOid } from '@lo/git';
import { PullRef } from '@lo/github';
import { APP_PULL } from '@lo/testing/git';
import { describe, expect, it } from 'vitest';

import type { Tabs } from '../contract.ts';
import type { Kept } from './pull.ts';
import { published, replayGithub, testGit } from './test/support.ts';
import { Watcher } from './watcher.ts';

const e2e = { id: 'p1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 } as const;
const missing = { id: 'p2', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 9999 } as const;
const settings = { id: 's1', kind: 'settings' } as const;
const E2E = new PullRef('rozed-dev', 'e2e', 80);
const MISSING = new PullRef('rozed-dev', 'e2e', 9999);

/** A watcher on GitHub replayed, keeping what tabs keep in a map. */
async function watcher(kept: Record<string, { login?: string; repository?: string }> = {}) {
  const replay = replayGithub('app_e2e');
  const git = await testGit();
  const sent = published();
  const changes: [string, Kept][] = [];
  const watching = new Watcher({
    github: replay.github,
    git,
    publish: sent.publish,
    store: {
      kept: (id) => kept[id] ?? {},
      keep: (id, change) => changes.push([id, change]),
    },
    log: () => undefined,
  });
  return { watching, sent, changes, replay };
}

describe('the watcher', { timeout: 60_000 }, () => {
  it('opens the pull request on screen, and only that one, and says nothing of other kinds of tab', async () => {
    const { watching, sent } = await watcher();
    const tabs: Tabs = { tabs: [e2e, missing, settings], active: 'p1' };
    watching.follow(tabs);

    expect(watching.has('p1')).toBe(true);
    expect(watching.has('p2')).toBe(true);
    expect(watching.has('s1')).toBe(false);
    expect(watching.snapshot('s1')).toBe(undefined);
    await expect
      .poll(() => watching.snapshot('p1')?.local.state, { timeout: 40_000 })
      .toMatchObject({ kind: 'ready', head: APP_PULL.head });
    // The other hasn't been shown, so nothing was read for it.
    expect(sent.pulls.some(({ id }) => id === 'p2')).toBe(false);
    expect(watching.snapshot('p2')?.pull).toMatchObject({ loading: false, header: null });

    watching.follow({ ...tabs, active: 'p2' });
    await expect.poll(() => watching.snapshot('p2')?.pull.problem?.kind).toBe('notFound');
    watching.stop();
  });

  it('closes what a closed tab started, and forgets it', async () => {
    const { watching, replay } = await watcher();
    watching.follow({ tabs: [e2e], active: 'p1' });
    const poller = replay.pollers.get('rozed-bot');
    await expect.poll(() => poller?.watches(E2E)).toBe(true);

    watching.follow({ tabs: [settings], active: 's1' });

    expect(watching.has('p1')).toBe(false);
    expect(poller?.watches(E2E)).toBe(false);
    watching.stop();
  });

  it('restores a tab acting as it did, watching it at once for the strip', async () => {
    const { watching, replay, changes } = await watcher({
      p1: { login: 'rozed-bot', repository: 'rozed-dev/e2e' },
    });
    watching.follow({ tabs: [e2e, settings], active: 's1' });
    const poller = replay.pollers.get('rozed-bot');
    await expect.poll(() => poller?.watches(E2E)).toBe(true);
    // It wasn't shown, so it isn't the open one, and its account wasn't worked out again.
    expect(poller?.open).toBe(undefined);
    expect(changes.filter(([, change]) => change.login !== undefined)).toEqual([]);
    watching.stop();
  });

  it('tells each tab when an account is removed', async () => {
    const { watching, replay } = await watcher();
    watching.follow({ tabs: [e2e], active: 'p1' });
    await expect.poll(() => watching.snapshot('p1')?.pull.acting?.kind).toBe('account');
    replay.removeAccount('rozed-bot');
    await expect.poll(() => watching.snapshot('p1')?.pull.acting?.kind).toBe('anonymous');
    watching.stop();
  });

  it('tells features in main what each pull request’s tab shows, as it changes and as it closes', async () => {
    const { watching } = await watcher();
    const heard: string[] = [];
    const stop = watching.onChange((id) => heard.push(id));
    watching.follow({ tabs: [e2e, settings], active: 'p1' });
    expect(watching.info('s1')).toBe(undefined);
    await expect
      .poll(() => watching.info('p1'), { timeout: 40_000 })
      .toMatchObject({
        id: 'p1',
        repository: { owner: 'rozed-dev', name: 'e2e' },
        number: 80,
        acting: { kind: 'account', login: 'rozed-bot' },
        shown: APP_PULL.head,
        local: { kind: 'ready', head: APP_PULL.head, mergeBase: APP_PULL.base },
      });
    expect(heard.length).toBeGreaterThan(0);
    expect(new Set(heard)).toEqual(new Set(['p1']));
    // The clone it fetched into, open to read.
    const clone = await watching.clone('p1');
    expect(await clone?.hasCommit(parseOid(APP_PULL.head))).toBe(true);

    heard.length = 0;
    watching.follow({ tabs: [settings], active: 's1' });
    expect(heard).toEqual(['p1']);
    expect(watching.info('p1')).toBe(undefined);
    expect(watching.clone('p1')).toBe(undefined);
    stop();
    watching.stop();
  });

  it('makes a view of each layer a tab shows, shows the one on screen, and closes them with the tab', async () => {
    const { watching, replay } = await watcher();
    const stack = { ...e2e, layer: 9999, layers: [80, 9999] };
    watching.follow({ tabs: [stack, settings], active: 'p1' });
    expect(watching.has('p1')).toBe(true);
    expect(watching.has('p1:9999')).toBe(true);
    // The layer on screen is read, under its view's id, and is the pull request opened, so it
    // counts as opened.
    await expect.poll(() => watching.snapshot('p1:9999')?.pull.problem?.kind).toBe('notFound');
    const poller = replay.pollers.get('rozed-bot');
    expect(poller?.open?.equals(MISSING)).toBe(true);
    await expect.poll(() => replay.cache.recent.map(({ pull }) => pull.key)).toContain(MISSING.key);
    expect(watching.info('p1:9999')).toMatchObject({ id: 'p1:9999', number: 9999 });

    watching.follow({ tabs: [{ ...stack, layer: undefined }, settings], active: 'p1' });
    await expect.poll(() => poller?.open?.equals(E2E)).toBe(true);

    watching.follow({ tabs: [settings], active: 's1' });
    expect(watching.has('p1')).toBe(false);
    expect(watching.has('p1:9999')).toBe(false);
    expect(poller?.watches(E2E)).toBe(false);
    expect(poller?.watches(MISSING)).toBe(false);
    watching.stop();
  });

  it('restores a tab at its layer, making only that view', async () => {
    const { watching } = await watcher();
    watching.follow({ tabs: [{ ...e2e, layer: 9999, layers: [9999] }], active: 'p1' });
    expect(watching.has('p1:9999')).toBe(true);
    expect(watching.has('p1')).toBe(false);
    await expect.poll(() => watching.snapshot('p1:9999')?.pull.problem?.kind).toBe('notFound');
    watching.stop();
  });

  it('leaves a pull request watched, and open, while another tab’s view of it is', async () => {
    const { watching, replay } = await watcher({
      p1: { login: 'rozed-bot' },
      'p3:80': { login: 'rozed-bot' },
    });
    // A tab opened on #9999 whose stack has #80 too, shown there before.
    const other = {
      id: 'p3',
      kind: 'pull',
      owner: 'rozed-dev',
      repo: 'e2e',
      number: 9999,
    } as const;
    const holding = { ...other, layer: 80, layers: [9999, 80] };
    watching.follow({ tabs: [e2e, holding], active: 'p1' });
    const poller = replay.pollers.get('rozed-bot');
    await expect.poll(() => poller?.open?.equals(E2E)).toBe(true);

    watching.follow({ tabs: [e2e], active: 'p1' });
    expect(poller?.watches(E2E)).toBe(true);
    expect(poller?.open?.equals(E2E)).toBe(true);
    watching.follow({ tabs: [settings], active: 's1' });
    expect(poller?.watches(E2E)).toBe(false);
    watching.stop();
  });

  it('makes a view of a run of layers, of its top layer from the run’s start, while it’s shown', async () => {
    const { watching, sent } = await watcher();
    const start = APP_PULL.base;
    const run = { layers: [79, 80], start, from: 80 };
    watching.follow({ tabs: [{ ...e2e, run }], active: 'p1' });
    expect(watching.has('p1')).toBe(true);
    expect(watching.info('p1:79-80')).toMatchObject({
      number: 80,
      compareFrom: start,
      run: [79, 80],
    });
    await expect
      .poll(() => watching.snapshot('p1:79-80')?.pull.header?.title, { timeout: 20_000 })
      .toBeDefined();
    // It starts where the run does, whatever else asks, and has no viewed marks of its own.
    watching.compareFrom('p1:79-80', undefined);
    expect(watching.info('p1:79-80')?.compareFrom).toBe(start);
    expect(watching.snapshot('p1:79-80')?.files).toBeUndefined();
    expect(sent.files.some(({ id }) => id === 'p1:79-80')).toBe(false);

    // Leaving it for the layer closes it.
    watching.follow({ tabs: [e2e], active: 'p1' });
    expect(watching.has('p1:79-80')).toBe(false);
    expect(watching.has('p1')).toBe(true);
    watching.stop();
  });
});

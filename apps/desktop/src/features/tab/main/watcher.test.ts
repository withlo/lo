import { PullRef } from '@lo/github';
import { APP_PULL } from '@lo/testing/git';
import { describe, expect, it } from 'vitest';

import type { Tabs } from '../contract.ts';
import type { Kept } from './pull.ts';
import { published, replayGithub, testGit } from './test/support.ts';
import { Watcher } from './watcher.ts';

const e2e = { id: 'p1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 78 } as const;
const missing = { id: 'p2', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 9999 } as const;
const settings = { id: 's1', kind: 'settings' } as const;
const E2E = new PullRef('rozed-dev', 'e2e', 78);

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
});

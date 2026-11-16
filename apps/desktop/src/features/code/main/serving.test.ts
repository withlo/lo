// Following views for their servers: nothing checked out or started for a view nothing trusts, or
// for one whose files no server reads; a trusted view's head checked out once it's on screen and
// needs a server; servers answering only about that head; and what the status bar says.

import { parseOid, type Oid, type TreeEntry } from '@lo/git';
import { describe, expect, it } from 'vitest';

import type { Servers } from '../contract.ts';
import type { Adapter } from './adapters.ts';
import type { PoolView, Root, ServerPool } from './servers.ts';
import { changedLanguages, ServingViews, type ServingInput, type ServingRepo } from './serving.ts';
import { blobOf, commitOf } from './test/fake.ts';

const TS: Adapter = {
  id: 'typescript',
  name: 'TypeScript',
  languages: { typescript: 'typescript' },
  prepare: () => Promise.resolve({ kind: 'ready', launch: { program: '/bin/x', args: [] } }),
};
const GO: Adapter = { ...TS, id: 'go', name: 'Go', languages: { go: 'go' } };

const head = commitOf('head');
const base = commitOf('base');

/** A tree's entry for a file at `path` holding `text`. */
function entry(path: string, text: string): TreeEntry {
  return { path: Buffer.from(path), oid: blobOf(text), mode: 'regular', size: text.length };
}

/** A local copy whose head changes `changed`, beside a README and a Go file left as they were. */
function repoOf(changed: readonly string[]) {
  const checkouts: string[] = [];
  const same = [entry('README.md', 'read me'), entry('cmd/main.go', 'package main')];
  const repo: ServingRepo = {
    async tree(rev: Oid) {
      if (rev === base) return [...same, ...changed.map((path) => entry(path, 'before'))];
      return [...same, ...changed.map((path) => entry(path, 'after'))];
    },
    async checkout(number, at) {
      checkouts.push(`${number}@${at}`);
      return `/cache/checkouts/pull-${number}/${at}`;
    },
    async hashCheckoutFile() {
      return undefined;
    },
  };
  return { repo, checkouts };
}

/** A pool that notes what it's told. */
function poolOf() {
  const synced: { views: readonly PoolView[]; screen: string | undefined }[] = [];
  const restarted: Root[] = [];
  const pool: Pick<ServerPool, 'sync' | 'shown' | 'find' | 'restart' | 'log'> = {
    sync: (views, screen) => synced.push({ views, screen }),
    shown: () => undefined,
    find: () => undefined,
    async restart(_repo, _adapter, root) {
      restarted.push(root);
    },
    log: () => undefined,
  };
  return { pool, synced, restarted, last: () => synced.at(-1)?.views ?? [] };
}

function follow(current: () => ServingInput | undefined, adapters: readonly Adapter[] = [TS, GO]) {
  const { pool, synced, restarted, last } = poolOf();
  const published: Servers[] = [];
  let screen: string | undefined = 'v1';
  const serving = new ServingViews({
    pool,
    adapters: () => adapters,
    view: (id) => (id === 'v1' ? current() : undefined),
    onScreen: () => screen,
    publish: (servers) => published.push(servers),
    log: () => undefined,
  });
  return {
    serving,
    synced,
    restarted,
    last,
    published,
    offScreen: () => {
      screen = 'other';
    },
  };
}

function input(clone: ServingRepo, change: Partial<ServingInput> = {}): ServingInput {
  return {
    id: 'v1',
    repo: 'Rozed-Dev/E2E',
    number: 80,
    trust: 'trusted',
    off: false,
    head,
    sides: { new: head, old: base },
    clone: () => Promise.resolve(clone),
    ...change,
  };
}

/** Lets what's waiting on promises settle. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
}

describe('following views for servers', () => {
  it('reads which servers the files the pull request changes need, on its new side', async () => {
    const { repo } = repoOf(['src/a.ts', 'docs/b.md']);
    expect([...(await changedLanguages(repo, { new: head, old: base }, [TS, GO]))]).toEqual([
      'typescript',
    ]);
    // With nothing to compare with, every file is new.
    expect(
      [...(await changedLanguages(repo, { new: head, old: undefined }, [TS, GO]))].toSorted(),
    ).toEqual(['go', 'typescript']);
  });

  it('checks out, downloads and starts nothing for a view nothing trusts', async () => {
    const { repo, checkouts } = repoOf(['src/a.ts']);
    const { serving, last, published } = follow(() => input(repo, { trust: 'none', off: true }));
    serving.update('v1');
    await settle();
    expect(checkouts).toEqual([]);
    expect(last()).toEqual([]);
    expect(published.at(-1)).toEqual({ view: 'v1', off: true, servers: [] });
    expect(serving.serverFor('v1', head, 'src/a.ts')).toBeUndefined();
  });

  it('checks out nothing for a trusted view whose files no server reads', async () => {
    const { repo, checkouts } = repoOf(['docs/b.md']);
    const { serving, last } = follow(() => input(repo));
    serving.update('v1');
    await settle();
    expect(checkouts).toEqual([]);
    expect(last()).toMatchObject([{ id: 'v1', root: undefined, wants: [] }]);
  });

  it('checks out a trusted view’s head once it’s on screen, and needs its servers there', async () => {
    const { repo, checkouts } = repoOf(['src/a.ts']);
    const shown = { value: input(repo) };
    const { serving, last, published, offScreen } = follow(() => shown.value);
    serving.update('v1');
    await settle();
    expect(checkouts).toEqual([`80@${head}`]);
    expect(last()).toEqual([
      {
        id: 'v1',
        repo: 'rozed-dev/e2e',
        trust: 'trusted',
        root: { folder: `/cache/checkouts/pull-80/${head}`, pull: 80 },
        wants: [TS],
      },
    ]);
    // On its way, until the pool says more.
    expect(published.at(-1)?.servers).toEqual([
      { id: 'typescript', name: 'TypeScript', state: { kind: 'starting' } },
    ]);
    // Checked again after a push: held, with nothing new checked out.
    const pushed = parseOid('d'.repeat(40));
    shown.value = input(repo, { trust: 'checking', head: pushed });
    serving.update('v1');
    await settle();
    expect(last()).toMatchObject([{ trust: 'held' }]);
    expect(checkouts).toHaveLength(1);
    // Off screen, trusted at the push: nothing checked out until it's on screen.
    offScreen();
    shown.value = input(repo, { head: pushed });
    serving.update('v1');
    await settle();
    expect(checkouts).toHaveLength(1);
  });

  it('answers only about the head it runs on, and starts a server for a file asked about', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const { serving, last } = follow(() => input(repo));
    serving.update('v1');
    await settle();
    expect(serving.serverFor('v1', base, 'src/a.ts')).toBeUndefined();
    expect(serving.serverFor('v1', head, 'docs/b.md')).toBeUndefined();
    expect(serving.serverFor('v1', head, 'src/a.ts')).toEqual({
      kind: 'starting',
      name: 'TypeScript',
    });
    // A Go file of the whole tree, asked about: its server is needed too.
    expect(serving.serverFor('v1', head, 'cmd/main.go')).toEqual({ kind: 'starting', name: 'Go' });
    expect(last()[0]?.wants).toEqual([TS, GO]);
  });

  it('says a checkout that failed, and makes it again on Restart', async () => {
    const { repo } = repoOf(['src/a.ts']);
    let fail = true;
    const failing: ServingRepo = {
      ...repo,
      checkout: (number, at) =>
        fail ? Promise.reject(new Error('the disk is full')) : repo.checkout(number, at),
    };
    const { serving, published, restarted } = follow(() => input(failing));
    serving.update('v1');
    await settle();
    expect(published.at(-1)?.servers[0]?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: "Lo couldn't check out this PR's head: the disk is full" },
    });
    fail = false;
    await serving.restart('v1', 'typescript');
    expect(restarted).toEqual([{ folder: `/cache/checkouts/pull-80/${head}`, pull: 80 }]);
  });

  it('says language servers are off on a view nothing trusts only when Lo has a server to run', () => {
    const { repo } = repoOf(['src/a.ts']);
    const { serving } = follow(() => input(repo, { trust: 'none', off: true }), []);
    serving.update('v1');
    expect(serving.servers('v1')).toEqual({ view: 'v1', off: false, servers: [] });
  });
});

// Following views for their servers: nothing checked out or started for a view nothing trusts, or
// for one whose files no server reads; a trusted view's head checked out once it's on screen and
// needs a server; servers answering only about that head; and what the status bar says.

import { GitError, parseOid, type Oid, type TreeEntry } from '@lo/git';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { Servers } from '../contract.ts';
import { ADAPTERS, type Adapter } from './adapters.ts';
import { ServerPool, type Found, type PoolView, type Root } from './servers.ts';
import {
  changedLanguages,
  repoKey,
  ServingViews,
  type ServingInput,
  type ServingRepo,
} from './serving.ts';
import { blobOf, commitOf } from './test/fake.ts';
import { StandIn } from './test/server.ts';

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

/** A pool that notes what it's told, and finds each server as `find` says. */
function poolOf(find: () => Found | undefined = () => undefined) {
  const synced: { views: readonly PoolView[]; screen: string | undefined }[] = [];
  const restarted: Root[] = [];
  const pool: Pick<ServerPool, 'sync' | 'shown' | 'find' | 'restart' | 'log'> = {
    sync: (views, screen) => synced.push({ views, screen }),
    shown: () => undefined,
    find,
    async restart(_repo, _adapter, root) {
      restarted.push(root);
    },
    log: () => undefined,
  };
  return { pool, synced, restarted, last: () => synced.at(-1)?.views ?? [] };
}

function follow(
  current: () => ServingInput | undefined,
  adapters: readonly Adapter[] = [TS, GO],
  find?: () => Found | undefined,
) {
  const { pool, synced, restarted, last } = poolOf(find);
  const published: Servers[] = [];
  let screen: string | undefined = 'v1';
  const serving = new ServingViews({
    pool,
    adapters: () => adapters,
    view: (id) => (id === 'v1' ? current() : undefined),
    onScreen: () => screen,
    publish: (servers) => published.push(servers),
    stopOn: () => Promise.resolve(),
    letGo: () => Promise.resolve(),
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

/** Lets everything under way finish: promises, and what waits a turn of the event loop. */
async function drain(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * The views `shown` holds, followed on a pool of stand-in servers, with `v1` on screen: the servers
 * it started, those whose process is still there, and each pull request let go of.
 */
function onPool(shown: ReadonlyMap<string, ServingInput>, screen: () => string = () => 'v1') {
  const started: StandIn[] = [];
  const lets: string[] = [];
  let serving: ServingViews | undefined;
  const pool = new ServerPool({
    prepare: (adapter, _progress, signal) =>
      adapter.prepare({
        install: () => Promise.reject(new Error('no downloads in tests')),
        toolchain: () => Promise.reject(new Error('no downloads in tests')),
        findCopy: () => Promise.resolve(undefined),
        developerFolder: () => Promise.resolve(undefined),
        missingPackages: () => Promise.resolve([]),
        signal,
      }),
    start(spec) {
      const server = new StandIn(spec);
      started.push(server);
      return server;
    },
    base: () => ({ home: '/home/lo', git: {}, path: ['/lo/git/bin'] }),
    changed: (repo) => serving?.changed(repo),
    log: () => undefined,
  });
  onTestFinished(() => pool.stop());
  serving = new ServingViews({
    pool,
    adapters: () => [TS],
    view: (id) => shown.get(id),
    onScreen: screen,
    publish: () => undefined,
    async stopOn(repo, pull) {
      lets.push(`stop ${repo}#${pull}`);
      await pool.stopWhere(repoKey(repo), (each) => each === pull);
    },
    async letGo(repo, pull) {
      lets.push(`let go ${repo}#${pull}`);
      await pool.stopWhere(repoKey(repo), (each) => each === pull);
    },
    log: () => undefined,
  });
  const alive = () => started.filter((server) => !server.exited);
  return { serving, started, alive, lets };
}

/** A local copy whose checkouts are usable only while `usable` says so, as `hashCheckoutFile` finds. */
function unusableAt(usable: () => boolean) {
  const { repo, checkouts } = repoOf(['src/a.ts']);
  const copy: ServingRepo = {
    ...repo,
    async hashCheckoutFile(folder) {
      if (!usable()) throw new GitError({ kind: 'invalid', what: 'checkout', value: folder });
      return blobOf('after');
    },
  };
  return { copy, checkouts };
}

/** View `v1`'s TypeScript server, once the stand-in it runs as says it's ready. */
function readyServer(serving: ServingViews, server: StandIn | undefined) {
  server?.set({ kind: 'ready' });
  const found = serving.serverFor('v1', head, 'src/a.ts');
  if (found?.kind !== 'ready') throw new Error(`TypeScript isn't ready: ${found?.kind}`);
  return found;
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
        pull: 80,
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

  it('says where a server that can’t answer is, as the pool finds it', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const why = 'The checkout’s tsconfig.json names a plugin, so Lo won’t run vtsls on it.';
    const cases: Found[] = [
      { kind: 'waiting', count: 4 },
      { kind: 'refused', why },
      { kind: 'missing', needs: 'Go 1.24 or newer' },
      { kind: 'failed' },
      { kind: 'stopped' },
    ];
    for (const found of cases) {
      const { serving } = follow(
        () => input(repo),
        [TS, GO],
        () => found,
      );
      serving.update('v1');
      await settle();
      expect(serving.serverFor('v1', head, 'src/a.ts')).toEqual({ ...found, name: 'TypeScript' });
    }
  });

  it('gives a ready server its adapter’s word on type hints, so Pyright is never asked for them', async () => {
    const { repo } = repoOf(['src/a.ts', 'src/b.py']);
    const server = new StandIn({
      name: 'stand-in',
      program: '/bin/x',
      args: [],
      root: `/cache/checkouts/pull-80/${head}`,
      home: '/home/lo',
      path: [],
      git: {},
    });
    const { serving } = follow(
      () => input(repo),
      ADAPTERS,
      () => ({ kind: 'ready', server }),
    );
    serving.update('v1');
    await settle();
    expect(serving.serverFor('v1', head, 'src/b.py')).toMatchObject({
      kind: 'ready',
      name: 'Python',
      noHints: 'Pyright has no type hints',
    });
    const typescript = serving.serverFor('v1', head, 'src/a.ts');
    expect(typescript).toMatchObject({ kind: 'ready', name: 'TypeScript' });
    expect(typescript).toHaveProperty('noHints', undefined);
  });

  it('gives a ready server each file’s own language, whichever file it was asked about from', async () => {
    const { repo } = repoOf(['infra/prod.tfvars']);
    const server = new StandIn({
      name: 'stand-in',
      program: '/bin/x',
      args: [],
      root: `/cache/checkouts/pull-80/${head}`,
      home: '/home/lo',
      path: [],
      git: {},
    });
    const { serving } = follow(
      () => input(repo),
      ADAPTERS,
      () => ({ kind: 'ready', server }),
    );
    serving.update('v1');
    await settle();
    const terraform = serving.serverFor('v1', head, 'infra/prod.tfvars');
    if (terraform?.kind !== 'ready') throw new Error('terraform-ls should be ready');
    expect(terraform.languageOf('infra/prod.tfvars')).toBe('terraform-vars');
    expect(terraform.languageOf('infra/variables.tf')).toBe('terraform');
    // Another server's file isn't its to open.
    expect(terraform.languageOf('src/a.ts')).toBeUndefined();
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
      why: { kind: 'error', message: 'Lo couldn’t check out this PR’s head: the disk is full' },
    });
    fail = false;
    await serving.restart('v1', 'typescript');
    expect(restarted).toEqual([{ folder: `/cache/checkouts/pull-80/${head}`, pull: 80 }]);
  });

  it('checks a PR’s head out again once a view of it is opened again, after none was', async () => {
    const { repo, checkouts } = repoOf(['src/a.ts']);
    let shown: ServingInput | undefined = input(repo);
    const { serving } = follow(() => shown);
    serving.update('v1');
    await settle();
    // Its tab closes, and opens again: the checkout may have gone meanwhile, with the cache cleared.
    shown = undefined;
    serving.update('v1');
    shown = input(repo);
    serving.update('v1');
    await settle();
    expect(checkouts).toEqual([`80@${head}`, `80@${head}`]);
  });

  it('says language servers are off on a view nothing trusts only when Lo has a server to run', () => {
    const { repo } = repoOf(['src/a.ts']);
    const { serving } = follow(() => input(repo, { trust: 'none', off: true }), []);
    serving.update('v1');
    expect(serving.servers('v1')).toEqual({ view: 'v1', off: false, servers: [] });
  });

  it('stops the server on a PR’s head once nothing trusts the PR, and lets go of its checkouts, while another of the repo stays trusted', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const shown = new Map([
      ['v1', input(repo, { number: 81 })],
      ['v2', input(repo, { id: 'v2' })],
    ]);
    const { serving, started, alive, lets } = onPool(shown);
    serving.update('v1');
    serving.update('v2');
    await drain();
    expect(started.map((server) => server.spec.root)).toEqual([`/cache/checkouts/pull-81/${head}`]);
    // #81, from a fork, isn't trusted any longer, as when its fork was renamed; #80 still is.
    shown.set('v1', input(repo, { number: 81, trust: 'none', off: true }));
    serving.update('v1');
    await drain();
    expect(alive()).toEqual([]);
    expect(lets).toEqual(['let go Rozed-Dev/E2E#81']);
  });

  it('lets go of what runs on a PR’s head once its tab, opened again, is decided untrusted', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const { repo: docs } = repoOf(['docs/b.md']);
    let screen = 'v1';
    const shown = new Map([
      ['v1', input(repo, { number: 81 })],
      ['v2', input(docs, { id: 'v2' })],
    ]);
    const { serving, started, alive, lets } = onPool(shown, () => screen);
    serving.update('v1');
    serving.update('v2');
    await drain();
    expect(started.map((server) => server.spec.root)).toEqual([`/cache/checkouts/pull-81/${head}`]);
    // #81's tab closes, and #80, which needs no server, is on screen: what runs on #81 runs on.
    shown.delete('v1');
    screen = 'v2';
    serving.update('v1');
    serving.update('v2');
    await drain();
    expect(alive()).toHaveLength(1);
    // Its fork renamed, #81 is opened again, and decided untrusted.
    shown.set('v3', input(repo, { id: 'v3', number: 81, trust: 'none', off: true }));
    serving.update('v3');
    await drain();
    expect(alive()).toEqual([]);
    expect(lets).toEqual(['let go Rozed-Dev/E2E#81']);
  });

  it('lets go of what runs on a PR’s head at once when its trusted tab closes and another, untrusted, stays', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const { repo: docs } = repoOf(['docs/b.md']);
    let screen = 'v1';
    const shown = new Map([
      ['v1', input(repo, { number: 81 })],
      ['v2', input(docs, { id: 'v2' })],
      ['v3', input(repo, { id: 'v3', number: 81, trust: 'none', off: true })],
    ]);
    const { serving, started, alive, lets } = onPool(shown, () => screen);
    for (const id of shown.keys()) serving.update(id);
    await drain();
    expect(started.map((server) => server.spec.root)).toEqual([`/cache/checkouts/pull-81/${head}`]);
    // While one view of #81 trusts it, the one that doesn't lets go of nothing.
    expect(lets).toEqual([]);
    // The trusted one closes, with another tab of the repo still open: #81 is untrusted now.
    shown.delete('v1');
    screen = 'v3';
    serving.update('v1');
    await drain();
    expect(alive()).toEqual([]);
    expect(lets).toEqual(['let go Rozed-Dev/E2E#81']);
  });

  it('lets go of what runs on a PR’s head once its trusted tab can’t be worked out and another is untrusted', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const shown = new Map([
      ['v1', input(repo, { number: 81 })],
      ['v3', input(repo, { id: 'v3', number: 81, trust: 'none', off: true })],
    ]);
    const { serving, alive, lets } = onPool(shown);
    for (const id of shown.keys()) serving.update(id);
    await drain();
    expect(alive()).toHaveLength(1);
    expect(lets).toEqual([]);
    // GitHub can't be reached to check #81 again in the tab that trusted it: the other's decision
    // holds, and its checkouts go.
    shown.set('v1', input(repo, { number: 81, trust: 'unknown', off: true }));
    serving.update('v1');
    await drain();
    expect(alive()).toEqual([]);
    expect(lets).toEqual(['let go Rozed-Dev/E2E#81']);
  });

  it('stops what runs, and keeps its checkouts, while trust can’t be worked out after a push', async () => {
    const { repo } = repoOf(['src/a.ts']);
    const shown = new Map([['v1', input(repo)]]);
    const { serving, alive, lets } = onPool(shown);
    serving.update('v1');
    await drain();
    expect(alive()).toHaveLength(1);
    // GitHub can't be reached to check it again.
    shown.set('v1', input(repo, { trust: 'unknown', off: true }));
    serving.update('v1');
    await drain();
    expect(alive()).toEqual([]);
    expect(lets).toEqual(['stop Rozed-Dev/E2E#80']);
    // Decided at last.
    shown.set('v1', input(repo, { trust: 'none', off: true }));
    serving.update('v1');
    await drain();
    expect(lets).toEqual(['stop Rozed-Dev/E2E#80', 'let go Rozed-Dev/E2E#80']);
  });

  it('makes a checkout a server finds isn’t the local copy’s again, with what ran on it stopped first', async () => {
    let usable = false;
    const { copy, checkouts } = unusableAt(() => usable);
    const shown = new Map([['v1', input(copy)]]);
    const { serving, started, alive, lets } = onPool(shown);
    serving.update('v1');
    await drain();
    const [first] = started;
    const ready = readyServer(serving, first);

    expect(await ready.matches('src/a.ts', blobOf('after'))).toBe('remaking');
    // Asked again meanwhile, it's on its way.
    expect(serving.serverFor('v1', head, 'src/a.ts')).toEqual({
      kind: 'starting',
      name: 'TypeScript',
    });
    await drain();
    expect(lets).toEqual(['stop Rozed-Dev/E2E#80']);
    expect(first?.exited).toBe(true);
    expect(checkouts).toEqual([`80@${head}`, `80@${head}`]);
    expect(alive().map((server) => server.spec.root)).toEqual([`/cache/checkouts/pull-80/${head}`]);
    // A late answer about the old checkout says nothing of one that's been made again.
    expect(await ready.matches('src/a.ts', blobOf('after'))).toBe(false);
    usable = true;
    const again = readyServer(serving, alive()[0]);
    expect(await again.matches('src/a.ts', blobOf('after'))).toBe(true);
    // Nor, once trust goes, of one that isn't usable.
    usable = false;
    shown.set('v1', input(copy, { trust: 'none', off: true }));
    serving.update('v1');
    await drain();
    expect(await again.matches('src/a.ts', blobOf('after'))).toBe(false);
    expect(checkouts).toHaveLength(2);
  });

  it('says a checkout made again that’s no better failed, and makes it again on Restart', async () => {
    let usable = false;
    const { copy, checkouts } = unusableAt(() => usable);
    const { serving, started, alive } = onPool(new Map([['v1', input(copy)]]));
    serving.update('v1');
    await drain();
    expect(await readyServer(serving, started[0]).matches('src/a.ts', head)).toBe('remaking');
    await drain();

    expect(await readyServer(serving, alive()[0]).matches('src/a.ts', head)).toBe('unusable');
    await drain();
    expect(alive()).toEqual([]);
    expect(serving.serverFor('v1', head, 'src/a.ts')).toEqual({
      kind: 'failed',
      name: 'TypeScript',
    });
    expect(serving.servers('v1')?.servers[0]?.state).toEqual({
      kind: 'failed',
      why: {
        kind: 'error',
        message:
          'Lo couldn’t check out this PR’s head: the checkout Lo made again isn’t usable either',
      },
    });
    usable = true;
    await serving.restart('v1', 'typescript');
    await drain();
    expect(checkouts).toHaveLength(3);
    expect(alive()).toHaveLength(1);
  });

  it('starts nothing on Restart once trust goes while the head is checked out, and lets go of that checkout', async () => {
    const { repo } = repoOf(['src/a.ts']);
    let fail = true;
    let made: (() => void) | undefined;
    const slow: ServingRepo = {
      ...repo,
      checkout: (number, at) =>
        fail
          ? Promise.reject(new Error('the disk is full'))
          : new Promise((resolve) => {
              made = () => resolve(`/cache/checkouts/pull-${number}/${at}`);
            }),
    };
    const shown = new Map([['v1', input(slow)]]);
    const { serving, started, alive, lets } = onPool(shown);
    serving.update('v1');
    await drain();
    // The checkout failed; Restart makes it again, and waits for it.
    fail = false;
    const restarting = serving.restart('v1', 'typescript');
    await drain();
    // Trust goes meanwhile: what ran is let go of.
    shown.set('v1', input(slow, { trust: 'none', off: true }));
    serving.update('v1');
    expect(lets).toEqual(['let go Rozed-Dev/E2E#80']);
    made?.();
    await restarting;
    await drain();
    expect(started).toEqual([]);
    expect(alive()).toEqual([]);
    // The checkout, finished after trust went, is let go of too.
    expect(lets).toEqual(['let go Rozed-Dev/E2E#80', 'let go Rozed-Dev/E2E#80']);
  });
});

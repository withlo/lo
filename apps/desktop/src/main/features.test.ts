import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { openDatabase } from './database.ts';
import { defineContract, reply } from '../ipc/contract.ts';
import { createRouter, defineFeature, loadFeatures, type Feature } from './features.ts';
import type { LocalGit } from './git.ts';
import { migrate } from './migrations.ts';
import { defineService, findServices, provides, type Service } from './services.ts';
import { contract as digest } from './test/features/digest/contract.ts';
import { contract as notes } from './test/features/notes/contract.ts';
import { board } from './test/features/notes/service.ts';

// Found the way main finds the real features and their migrations, from a folder of made-up ones.
const found = import.meta.glob<Feature>('./test/features/*/main/index.ts', {
  eager: true,
  import: 'default',
});
const migrations = import.meta.glob<string>('./test/features/*/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const services = findServices(
  import.meta.glob<Record<string, unknown>>('./test/features/*/service.ts', { eager: true }),
);

/** Git as features see it, before Lo has looked for one: these tests run none. */
const noGit: LocalGit = {
  status: undefined,
  cache: undefined,
  onStatus: () => undefined,
  check: () => Promise.reject(new Error('these tests run no git')),
  setCap: () => Promise.resolve(),
};

function router() {
  const sent: [string, unknown][] = [];
  const log = vi.fn<(message: string, error: unknown) => void>();
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  const routes = createRouter(loadFeatures(found), {
    isAllowedSender: (address) => address === 'lo-app://app/index.html',
    send: (channel, value) => sent.push([channel, value]),
    log,
    database,
    git: noGit,
    services,
  });
  routes.start();
  const ask = (channel: string, input?: unknown) =>
    routes.answer(channel, 'lo-app://app/index.html', input);
  return { routes, sent, log, ask };
}

describe('loadFeatures', () => {
  it('takes a feature from its own folder, with nothing listed anywhere else', () => {
    expect(loadFeatures(found).map((feature) => feature.contract.feature)).toEqual([
      'digest',
      'notes',
    ]);
  });

  it("refuses a feature whose folder doesn't match its name", () => {
    const feature = found['./test/features/notes/main/index.ts'];
    expect(() => loadFeatures({ '../features/other/main/index.ts': feature! })).toThrow(
      'defines the feature "notes", but its folder is "other"',
    );
  });

  it("doesn't take an inherited property for a handler", () => {
    const contract = defineContract('notes', {
      requests: { toString: { input: z.undefined(), reply: reply<string>() } },
      topics: {},
    });
    // The type checker takes the inherited toString for one, too.
    const feature = defineFeature(contract, { handlers: {} });
    expect(() => loadFeatures({ '../features/notes/main/index.ts': feature })).toThrow(
      'has no handler for notes.toString',
    );
  });

  it('refuses a feature missing a handler', () => {
    const feature = defineFeature(notes, {
      // @ts-expect-error A handler for every request is required.
      handlers: { add: () => ({ id: 1 }) },
    });
    expect(() => loadFeatures({ '../features/notes/main/index.ts': feature })).toThrow(
      'has no handler for notes.remove',
    );
  });
});

describe('createRouter', () => {
  it('names each request <feature>.<name>', () => {
    expect(router().routes.channels).toEqual([
      'digest.read',
      'notes.add',
      'notes.remove',
      'notes.count',
      'notes.crash',
    ]);
  });

  it('answers from its own tables, made by its own migration, and pushes on its topic', async () => {
    const { ask, sent } = router();
    expect(await ask('notes.count')).toEqual({ ok: true, value: 0 });
    expect(await ask('notes.add', { text: 'Read the diff' })).toEqual({
      ok: true,
      value: { id: 1 },
    });
    expect(await ask('notes.add', { text: 'Approve it' })).toEqual({ ok: true, value: { id: 2 } });
    expect(await ask('notes.remove', { id: 1 })).toEqual({ ok: true, value: null });
    expect(await ask('notes.count')).toEqual({ ok: true, value: 1 });
    expect(sent).toEqual([
      ['digest.started', { notes: 0 }],
      ['notes.changed', 1],
      ['notes.changed', 2],
      ['notes.changed', 1],
    ]);
  });

  it("refuses input that doesn't match the contract, without repeating it", async () => {
    const { ask } = router();
    for (const input of [undefined, { text: '' }, { text: 'hi', extra: 'hunter2' }, 'hunter2']) {
      const answer = await ask('notes.add', input);
      expect(answer).toMatchObject({ ok: false, error: { code: 'invalid' } });
      expect(JSON.stringify(answer)).not.toContain('hunter2');
    }
    expect(await ask('notes.count', { unexpected: true })).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'notes.count got a malformed request (input).' },
    });
  });

  it("answers only Lo's own page", async () => {
    const { routes } = router();
    for (const sender of ['https://example.com/', 'about:blank', undefined]) {
      expect(await routes.answer('notes.count', sender, undefined)).toEqual({
        ok: false,
        error: { code: 'forbidden', message: "notes.count answers only Lo's own page." },
      });
    }
  });

  it("refuses a request that doesn't exist", async () => {
    expect(await router().ask('notes.nothing')).toEqual({
      ok: false,
      error: { code: 'unavailable', message: "There's no request named notes.nothing." },
    });
  });

  it("passes on a handler's expected failure", async () => {
    expect(await router().ask('notes.remove', { id: 999 })).toEqual({
      ok: false,
      error: { code: 'missing', message: "There's no note 999." },
    });
  });

  it("keeps an unexpected error's text in main", async () => {
    const { ask, log } = router();
    expect(await ask('notes.crash')).toEqual({
      ok: false,
      error: { code: 'internal', message: 'notes.crash failed.' },
    });
    expect(log).toHaveBeenCalledWith('notes.crash failed:', expect.any(Error));
  });

  it("refuses to push a value that doesn't match the topic", () => {
    const sent: unknown[] = [];
    const feature = defineFeature(notes, {
      handlers: { add: () => ({ id: 1 }), remove: () => null, count: () => 0, crash: () => null },
      start({ publish }) {
        publish('changed', -1);
      },
    });
    const routes = createRouter([feature], {
      isAllowedSender: () => true,
      send: (...message) => sent.push(message),
      log: () => {},
      database: openDatabase(':memory:'),
      git: noGit,
      services: [],
    });
    expect(() => routes.start()).toThrow(z.ZodError);
    expect(sent).toEqual([]);
  });
});

/** Starts a router on made-up features, with these services defined. */
function start(features: readonly Feature[], defined: readonly Service<unknown>[] = []) {
  const sent: [string, unknown][] = [];
  const routes = createRouter(features, {
    isAllowedSender: () => true,
    send: (channel, value) => sent.push([channel, value]),
    log: () => {},
    database: openDatabase(':memory:'),
    git: noGit,
    services: defined,
  });
  routes.start();
  return { routes, sent };
}

describe('stopping', () => {
  it('stops the features the last to start first, each once the one after it has', async () => {
    const steps: string[] = [];
    const later = Promise.withResolvers<void>();
    const handlers = {
      add: () => ({ id: 1 }),
      remove: () => null,
      count: () => 0,
      crash: () => null,
    };
    const first = defineFeature(notes, {
      handlers,
      start: () => void steps.push('notes starts'),
      stop: () => void steps.push('notes stops'),
    });
    const second = defineFeature(digest, {
      handlers: { read: () => ({ notes: 0 }) },
      start: () => void steps.push('digest starts'),
      async stop() {
        steps.push('digest stopping');
        await later.promise;
        steps.push('digest stopped');
      },
    });
    const { routes } = start([first, second]);
    const stopping = routes.stop();
    await Promise.resolve();
    expect(steps).toEqual(['notes starts', 'digest starts', 'digest stopping']);
    later.resolve();
    await stopping;
    expect(steps).toEqual([
      'notes starts',
      'digest starts',
      'digest stopping',
      'digest stopped',
      'notes stops',
    ]);
  });

  it('stops the others when one fails to', async () => {
    const log = vi.fn<(message: string, error: unknown) => void>();
    const stopped: string[] = [];
    const handlers = {
      add: () => ({ id: 1 }),
      remove: () => null,
      count: () => 0,
      crash: () => null,
    };
    const routes = createRouter(
      [
        defineFeature(notes, { handlers, stop: () => void stopped.push('notes') }),
        defineFeature(digest, {
          handlers: { read: () => ({ notes: 0 }) },
          stop: () => Promise.reject(new Error('the disk is full')),
        }),
      ],
      {
        isAllowedSender: () => true,
        send: () => {},
        log,
        database: openDatabase(':memory:'),
        git: noGit,
        services: [],
      },
    );
    routes.start();
    await routes.stop();
    expect(stopped).toEqual(['notes']);
    expect(log).toHaveBeenCalledWith('digest failed to stop:', expect.any(Error));
  });
});

describe('services', () => {
  const counter = defineService<{ next(): number }>('notes.counter');
  const handlers = {
    add: () => ({ id: 1 }),
    remove: () => null,
    count: () => 0,
    crash: () => null,
  };
  /** notes, providing a counter. */
  const provider = defineFeature(notes, {
    provide() {
      let count = 0;
      return [provides(counter, { next: () => ++count })];
    },
    handlers,
  });
  /** digest, using the counter as it starts and in its handler. */
  const user = defineFeature(digest, {
    handlers: { read: (_input, { use }) => ({ notes: use(counter).next() }) },
    start: ({ publish, use }) => publish('started', { notes: use(counter).next() }),
  });

  it("lets a feature use another's service, in its start and its handlers", async () => {
    const { routes, sent } = router();
    expect(sent).toEqual([['digest.started', { notes: 0 }]]);
    await routes.answer('notes.add', 'lo-app://app/index.html', { text: 'Read the diff' });
    expect(await routes.answer('digest.read', 'lo-app://app/index.html', undefined)).toEqual({
      ok: true,
      value: { notes: 1 },
    });
  });

  it('runs every feature’s provide before any feature’s start, in either order', async () => {
    for (const features of [
      [user, provider],
      [provider, user],
    ]) {
      const { routes, sent } = start(features);
      expect(sent).toEqual([['digest.started', { notes: 1 }]]);
      expect(await routes.answer('digest.read', 'any', undefined)).toEqual({
        ok: true,
        value: { notes: 2 },
      });
    }
  });

  it('refuses a service used while features are still providing, in either order', () => {
    const early = defineFeature(digest, {
      provide({ use }) {
        use(counter).next();
        return [];
      },
      handlers: { read: () => ({ notes: 0 }) },
    });
    for (const features of [
      [early, provider],
      [provider, early],
    ]) {
      expect(() => start(features)).toThrow(
        'notes.counter was used while features were still providing theirs.',
      );
    }
  });

  it('lets only the feature a service is named for provide it', () => {
    const impostor = defineFeature(digest, {
      provide: () => [provides(counter, { next: () => 0 })],
      handlers: { read: () => ({ notes: 0 }) },
    });
    expect(() => start([impostor])).toThrow(
      'digest provides notes.counter, but only notes may: each feature provides its own services.',
    );
  });

  it('refuses a service provided twice', () => {
    const twice = defineFeature(notes, {
      provide: () => [provides(counter, { next: () => 0 }), provides(counter, { next: () => 1 })],
      handlers,
    });
    expect(() => start([twice])).toThrow('notes.counter is provided twice.');
  });

  it('refuses to start while a service a service.ts defines goes unprovided', () => {
    const silent = defineFeature(notes, { handlers });
    expect(() => start([silent, user], [board])).toThrow(
      "The notes feature defines notes.board in its service.ts, but doesn't provide it.",
    );
  });
});

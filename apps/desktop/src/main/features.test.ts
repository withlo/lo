import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { openDatabase } from './database.ts';
import { createRouter, defineFeature, loadFeatures, type Feature } from './features.ts';
import { migrate } from './migrations.ts';
import { contract as notes } from './test/features/notes/contract.ts';

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
  });
  routes.start();
  const ask = (channel: string, input?: unknown) =>
    routes.answer(channel, 'lo-app://app/index.html', input);
  return { routes, sent, log, ask };
}

describe('loadFeatures', () => {
  it('takes a feature from its own folder, with nothing listed anywhere else', () => {
    expect(loadFeatures(found).map((feature) => feature.contract.feature)).toEqual(['notes']);
  });

  it("refuses a feature whose folder doesn't match its name", () => {
    const [feature] = Object.values(found);
    expect(() => loadFeatures({ '../features/other/main/index.ts': feature! })).toThrow(
      'defines the feature "notes", but its folder is "other"',
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
      ['notes.changed', 1],
      ['notes.changed', 2],
      ['notes.changed', 1],
    ]);
  });

  it("refuses input that doesn't match the contract, without repeating it", async () => {
    const { ask } = router();
    for (const input of [undefined, { text: '' }, { text: 'hi', extra: 'hunter2' }, 'hunter2']) {
      const reply = await ask('notes.add', input);
      expect(reply).toMatchObject({ ok: false, error: { code: 'invalid' } });
      expect(JSON.stringify(reply)).not.toContain('hunter2');
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
    });
    expect(() => routes.start()).toThrow(z.ZodError);
    expect(sent).toEqual([]);
  });
});

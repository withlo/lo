import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { channel, channelName, defineContract, isResult, reply } from './contract.ts';

describe('defineContract', () => {
  it('keeps the feature, its requests and its topics', () => {
    const contract = defineContract('notes', {
      requests: { count: { input: z.undefined(), reply: reply<number>() } },
      topics: { changed: z.number() },
    });
    expect(contract.feature).toBe('notes');
    expect(Object.keys(contract.requests)).toEqual(['count']);
    expect(Object.keys(contract.topics)).toEqual(['changed']);
  });

  it.each([
    ['a feature name that isn', 'Notes', {}, {}, 'lowercase letters and digits'],
    ['a request name that isn', 'notes', { 'add-note': 0 }, {}, "isn't a request or topic name"],
    ['a topic name that isn', 'notes', {}, { 'notes.changed': 0 }, "isn't a request or topic name"],
    ['a name used twice', 'notes', { changed: 0 }, { changed: 0 }, 'both a request and a topic'],
    ['the client', 'notes', { subscribe: 0 }, {}, '"subscribe" is taken'],
  ])("refuses %s't one", (_case, feature, requests, topics, message) => {
    const spec = { input: z.undefined(), reply: reply<null>() };
    expect(() =>
      defineContract(feature, {
        requests: Object.fromEntries(Object.keys(requests).map((name) => [name, spec])),
        topics: Object.fromEntries(Object.keys(topics).map((name) => [name, z.number()])),
      }),
    ).toThrow(message);
  });
});

describe('channel', () => {
  it('names a channel <feature>.<name>', () => {
    expect(channel('app', 'info')).toBe('app.info');
    expect(channelName.test('app.info')).toBe(true);
    for (const name of ['app', 'app.info.more', 'ELECTRON_BROWSER_WINDOW', 'App.info', '.info']) {
      expect(channelName.test(name)).toBe(false);
    }
  });
});

describe('isResult', () => {
  it("accepts a reply's two shapes", () => {
    expect(isResult({ ok: true, value: 1 })).toBe(true);
    expect(isResult({ ok: false, error: { code: 'invalid', message: 'Bad.' } })).toBe(true);
  });

  it.each([null, 'ok', { ok: true }, { ok: false }, { ok: false, error: { code: 1 } }, {}])(
    'refuses %j',
    (value) => {
      expect(isResult(value)).toBe(false);
    },
  );
});

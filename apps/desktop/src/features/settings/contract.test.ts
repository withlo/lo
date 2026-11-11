import { DEFAULT_CAP } from '@lo/git';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  cacheCleared,
  cacheUsage,
  contract,
  defineSetting,
  problem,
  settingKey,
  settingsState,
} from './contract.ts';
import { cacheCap, CACHE_CAP_MAX, GB, theme } from './settings.ts';

describe('settingKey', () => {
  it('is words joined by dots, as the file spells them', () => {
    for (const key of ['theme', 'diff.layout', 'cache.cap', 'a.b.c', 'diff.showWhitespace']) {
      expect(settingKey.safeParse(key).success).toBe(true);
    }
    for (const key of [
      '',
      'Theme',
      'diff.',
      '.diff',
      'diff..layout',
      'diff layout',
      'diff-layout',
      '1diff',
      'diff.1',
      '__proto__',
      'a'.repeat(65),
    ]) {
      expect(settingKey.safeParse(key).success).toBe(false);
    }
  });
});

describe('defineSetting', () => {
  const layout = z.enum(['split', 'inline']);

  it('makes a setting of a key, a schema, a default and what the schema accepts', () => {
    expect(defineSetting('diff.layout', layout, 'split', 'split or inline')).toEqual({
      key: 'diff.layout',
      schema: layout,
      fallback: 'split',
      accepts: 'split or inline',
    });
  });

  it('refuses a key that is not written as the file writes them', () => {
    expect(() => defineSetting('Diff layout', layout, 'split', 'x')).toThrow(
      'A setting is named in words joined by dots',
    );
  });

  it('refuses a default its own schema refuses', () => {
    // The type checker would stop this too; the file's values never come through it.
    const schema: z.ZodType<string> = layout;
    expect(() => defineSetting('diff.layout', schema, 'wrapped', 'split or inline')).toThrow(
      "The default of the setting diff.layout isn't a value its schema accepts.",
    );
  });

  it('refuses a default that is not JSON, which is all the file holds', () => {
    expect(() => defineSetting('when', z.date(), new Date(0), 'a date')).toThrow(
      "The default of the setting when isn't JSON",
    );
  });
});

describe("this feature's settings", () => {
  it('has the theme follow the system until told otherwise, and accepts the three themes only', () => {
    expect(theme.key).toBe('theme');
    expect(theme.fallback).toBe('system');
    for (const value of ['dark', 'light', 'system']) {
      expect(theme.schema.safeParse(value).success).toBe(true);
    }
    for (const value of ['Dark', 'purple', '', null, 1, ['dark']]) {
      expect(theme.schema.safeParse(value).success).toBe(false);
    }
  });

  it('has the cache keep to the size git keeps it to, in whole GB', () => {
    expect(cacheCap.key).toBe('cache.cap');
    // The setting's default is the cache's own, so a file with no cap changes nothing.
    expect(cacheCap.fallback * GB).toBe(DEFAULT_CAP);
    for (const value of [1, 10, 500, CACHE_CAP_MAX]) {
      expect(cacheCap.schema.safeParse(value).success).toBe(true);
    }
    for (const value of [0, -1, 2.5, CACHE_CAP_MAX + 1, '10', null, Number.NaN]) {
      expect(cacheCap.schema.safeParse(value).success).toBe(false);
    }
    expect(cacheCap.accepts).toBe('a whole number of GB, from 1 to 10,000');
  });
});

describe('the contract', () => {
  const { set } = contract.requests;

  it('changes a setting by its key and a JSON value, and nothing else', () => {
    for (const given of [
      { key: 'theme', value: 'dark' },
      { key: 'cache.cap', value: 20 },
      { key: 'diff.layout', value: null },
      { key: 'later', value: { a: [1, 'x', null, true] } },
    ]) {
      expect(set.input.safeParse(given).success).toBe(true);
    }
    for (const given of [
      undefined,
      {},
      { key: 'theme' },
      { value: 'dark' },
      { key: 'Theme', value: 'dark' },
      { key: '../theme', value: 'dark' },
      { key: 'theme', value: 'dark', path: '/etc/passwd' },
      { key: 'theme', value: undefined },
      { key: 'theme', value: () => 'dark' },
      { key: 'theme', value: new Date(0) },
      { key: 'theme', value: Number.NaN },
    ]) {
      expect(set.input.safeParse(given).success).toBe(false);
    }
  });

  it('reads, measures the cache and clears it without being told anything', () => {
    for (const request of [
      contract.requests.read,
      contract.requests.cacheUsage,
      contract.requests.clearCache,
    ]) {
      expect(request.input.safeParse(undefined).success).toBe(true);
      expect(request.input.safeParse({ path: '/' }).success).toBe(false);
    }
  });

  it('sends the settings with where the file is, every value and what is wrong', () => {
    const state = {
      file: '~/.config/lo/settings.json',
      values: { theme: 'dark', 'cache.cap': 10 },
      problems: [{ key: 'cache.cap', message: 'cache.cap is 2.5.' }, { message: 'Not JSON.' }],
    };
    expect(settingsState.safeParse(state).success).toBe(true);
    expect(contract.topics.state.safeParse(state).success).toBe(true);
    for (const bad of [
      { ...state, file: undefined },
      { ...state, extra: 1 },
      { ...state, values: { Theme: 'dark' } },
      { ...state, values: { theme: undefined } },
      { ...state, problems: [{ message: '' }] },
      { ...state, problems: [{ message: 'x'.repeat(401) }] },
      { ...state, problems: [{ key: 'theme', message: 'x', extra: 1 }] },
    ]) {
      expect(settingsState.safeParse(bad).success).toBe(false);
    }
    expect(problem.safeParse({ message: 'x'.repeat(400) }).success).toBe(true);
  });

  it('says how much room the cache takes, or why it has none', () => {
    expect(cacheUsage.safeParse({ status: 'checking' }).success).toBe(true);
    expect(cacheUsage.safeParse({ status: 'unavailable' }).success).toBe(true);
    expect(cacheUsage.safeParse({ status: 'ready', used: 0, cap: 1 }).success).toBe(true);
    for (const bad of [
      { status: 'ready' },
      { status: 'ready', used: -1, cap: 1 },
      { status: 'ready', used: 1.5, cap: 1 },
      { status: 'ready', used: 1, cap: 0 },
      { status: 'checking', used: 1 },
      { status: 'gone' },
    ]) {
      expect(cacheUsage.safeParse(bad).success).toBe(false);
    }
    expect(cacheCleared.safeParse({ kept: 0 }).success).toBe(true);
    expect(cacheCleared.safeParse({ kept: -1 }).success).toBe(false);
  });
});

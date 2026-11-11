// Settings: the file people edit, and the window that edits it. Main reads the file, checks every
// value against the schema its feature declared, watches it and writes it; the window shows what
// main last said. A feature declares each setting it has with `defineSetting` (in its own
// `settings.ts`), and other features reach the values through this feature's service in main and
// its `window/shared.ts`.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/**
 * A setting's key, as the file spells it: words joined by dots, `diff.layout`. The file is one
 * object of these, flat (`{ "diff.layout": "inline" }`), so a key never depends on where it sits.
 */
export const settingKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/);

/** Any value JSON can hold: all that the file, and so every setting, can. */
export const settingValue = z.json();

/** A setting a feature has: its key, what its value may be, and the value when the file has none. */
export interface Setting<T> {
  readonly key: string;
  /** What the value may be. A value the file holds that this refuses is reported and ignored. */
  readonly schema: z.ZodType<T>;
  /** The value when the file has none, or has one the schema refuses. */
  readonly fallback: T;
  /** What the value may be, in words for the person editing the file: "dark, light or system". */
  readonly accepts: string;
}

/**
 * Defines a setting. `schema` must accept `fallback`, and both must be JSON, since that is what
 * the file holds; a setting that doesn't fails as it's defined.
 */
export function defineSetting<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
  accepts: string,
): Setting<T> {
  if (!settingKey.safeParse(key).success) {
    throw new Error(`A setting is named in words joined by dots, as diff.layout is, not "${key}".`);
  }
  if (!schema.safeParse(fallback).success) {
    throw new Error(`The default of the setting ${key} isn't a value its schema accepts.`);
  }
  if (!settingValue.safeParse(fallback).success) {
    throw new Error(`The default of the setting ${key} isn't JSON, which the settings file holds.`);
  }
  return { key, schema, fallback, accepts };
}

/** Something wrong in the settings file, in words for the person who wrote it. */
export const problem = z.strictObject({
  /** The setting it is about, or none when it is about the file as a whole. */
  key: settingKey.optional(),
  message: z.string().min(1).max(400),
});
export type Problem = z.output<typeof problem>;

/**
 * The settings as main has them: where the file is, the value of every setting a feature
 * declared (the file's, or its default), and what is wrong with the file.
 */
export const settingsState = z.strictObject({
  /** The file's place as a person would write it: `~/.config/lo/settings.json`. */
  file: z.string().max(1024),
  values: z.record(settingKey, settingValue),
  problems: z.array(problem).max(200),
});
export type SettingsState = z.output<typeof settingsState>;

/**
 * The cache of local copies: how much room it takes against its cap, in bytes, or why Lo has none.
 * `checking` is before Lo has looked for git; `unavailable` is without git, or when the cache's
 * folder couldn't be opened.
 */
export const cacheUsage = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('checking') }),
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({
    status: z.literal('ready'),
    used: z.number().int().min(0),
    cap: z.number().int().min(1),
  }),
]);
export type CacheUsage = z.output<typeof cacheUsage>;

/** What clearing the cache did: how many local copies it had to leave, since they were in use. */
export const cacheCleared = z.strictObject({ kept: z.number().int().min(0) });
export type CacheCleared = z.output<typeof cacheCleared>;

export const contract = defineContract('settings', {
  requests: {
    /** The settings as they are now. The `state` topic then keeps the window up to date. */
    read: { input: z.undefined(), reply: reply<SettingsState>() },
    /**
     * Changes a setting. Main refuses a key no feature declared, and a value its schema refuses
     * (`invalid`), and a change the file can't take (`unwritable`): the file has a problem that
     * writing over would lose, or can't be written. Other settings, and what Lo doesn't know of,
     * stay in the file as they are.
     */
    set: {
      input: z.strictObject({ key: settingKey, value: settingValue }),
      reply: reply<void>(),
    },
    /** How much room the local copies take. */
    cacheUsage: { input: z.undefined(), reply: reply<CacheUsage>() },
    /**
     * Clears what Lo keeps to open pull requests fast, to fetch again when it's next needed: the
     * local copies that aren't in use, and the answers saved from GitHub. Never accounts, the pull
     * requests opened lately or marks.
     */
    clearCache: { input: z.undefined(), reply: reply<CacheCleared>() },
  },
  topics: {
    /** The settings, each time they change. */
    state: settingsState,
  },
});

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

/** Settings' groups, in the order its list shows them. */
export const settingsGroups = [
  'accounts',
  'appearance',
  'keyboard',
  'pullRequests',
  'code',
  'storage',
  'integrations',
  'about',
] as const;
export type SettingsGroup = (typeof settingsGroups)[number];

/** Each group's name, as Settings' list and its heading write it. */
export const groupNames: Readonly<Record<SettingsGroup, string>> = {
  accounts: 'Accounts',
  appearance: 'Appearance',
  keyboard: 'Keyboard',
  pullRequests: 'Pull requests',
  code: 'Code intelligence',
  storage: 'Storage',
  integrations: 'Integrations',
  about: 'About',
};

/** The most a setting's description may run to: one line of Settings. */
export const DESCRIPTION_MAX = 90;

/**
 * Checks a row's words, a setting's or any other row's: a label, and one line of
 * {@link DESCRIPTION_MAX} characters at most that ends with a full stop. `what` names the row in
 * the error: "The setting theme".
 */
export function checkRowWords(what: string, label: string, description: string): void {
  if (label.trim() === '') throw new Error(`${what} has no label.`);
  if (description.length > DESCRIPTION_MAX || !description.endsWith('.')) {
    throw new Error(
      `The description of ${what.charAt(0).toLowerCase()}${what.slice(1)} is one line of ${DESCRIPTION_MAX} characters at most, ending with a full stop.`,
    );
  }
}

/** A setting a feature has: its key, what its value may be, and the value when the file has none. */
export interface Setting<T> {
  readonly key: string;
  /**
   * The group of Settings its row is in, or `file` for one only the settings file holds, as
   * `app.gpu` is: a window that draws nothing couldn't reach it.
   */
  readonly group: SettingsGroup | 'file';
  /** What its row calls it: the thing set, in four words at most. A switch reads true when on. */
  readonly label: string;
  /**
   * What a sentence calls it, as in "Couldn’t change the theme", when its label, lower-cased after
   * "the", doesn't read as the thing: "Vim keys", "where pull requests open".
   */
  readonly named?: string;
  /** One line under the label, with a full stop: what it changes that the label doesn't say. */
  readonly description: string;
  /**
   * The words each of its values goes by, in the order its row offers them, for a setting that's a
   * choice of a few: `{ split: 'Side by side', inline: 'Inline' }`.
   */
  readonly options?: Readonly<Record<string, string>>;
  /** What the value may be. A value the file holds that this refuses is reported and ignored. */
  readonly schema: z.ZodType<T>;
  /** The value when the file has none, or has one the schema refuses. */
  readonly fallback: T;
  /** What the value may be, in words for the person editing the file: "dark, light or system". */
  readonly accepts: string;
  /**
   * What the window may do with it: `write`, show it and change it, as Settings does with most; or
   * `read`, show it only. Main alone changes a `read` setting, through the settings service, as
   * the repositories language servers run on change only once main's own dialog says so. The
   * person editing the file can change either.
   */
  readonly window: 'read' | 'write';
  /**
   * What's wrong with a value the schema accepts, each in words for the person editing the file:
   * the parts of it Lo ignores. Each is reported with the setting, and the value stays as it is.
   */
  problems?(value: T): readonly string[];
}

/**
 * What a setting says of itself besides its value, as {@link Setting} has it: where Settings shows
 * it and how its row reads, which every setting has. `window` is `write` unless said.
 */
export interface SettingAbout<T> {
  readonly group: SettingsGroup | 'file';
  readonly label: string;
  readonly named?: string;
  readonly description: string;
  readonly options?: [T] extends [string] ? Readonly<Record<T, string>> : never;
  readonly window?: 'read' | 'write';
  readonly problems?: (value: T) => readonly string[];
}

/**
 * Defines a setting, with its row in Settings: Settings draws the row from what this says, and
 * finds it by the same words. `schema` must accept `fallback`, and both must be JSON, since that is
 * what the file holds. The description is one line, of {@link DESCRIPTION_MAX} characters at most,
 * and ends with a full stop; each of `options` is a value the schema accepts, `fallback` among them.
 * A setting that breaks any of this fails as it's defined.
 */
export function defineSetting<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
  accepts: string,
  about: SettingAbout<T>,
): Setting<T> {
  if (!settingKey.safeParse(key).success) {
    throw new Error(`A setting is named in words joined by dots, as diff.layout is, not "${key}".`);
  }
  if (!schema.safeParse(fallback).success) {
    throw new Error(`The default of the setting ${key} isn’t a value its schema accepts.`);
  }
  if (!settingValue.safeParse(fallback).success) {
    throw new Error(`The default of the setting ${key} isn’t JSON, which the settings file holds.`);
  }
  const { group, label, named, description, options, window = 'write', problems } = about;
  checkRowWords(`The setting ${key}`, label, description);
  if (options !== undefined) {
    const values: readonly unknown[] = Object.keys(options);
    if (!values.includes(fallback) || values.some((value) => !schema.safeParse(value).success)) {
      throw new Error(`The options of the setting ${key} are values its schema accepts.`);
    }
  }
  const setting: Setting<T> = { key, schema, fallback, accepts, group, label, description, window };
  return {
    ...setting,
    ...(named === undefined ? {} : { named }),
    ...(options === undefined ? {} : { options }),
    ...(problems === undefined ? {} : { problems }),
  };
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
     * (`invalid`), a setting the window may only read (`unwritable`), a change what the file holds
     * keeps it from making, which editing the file fixes (`settingsFile`), and a change it couldn't
     * write (`unsaved`): each with what's wrong in its message. Other settings, and what Lo
     * doesn't know of, stay in the file as they are.
     */
    set: {
      input: z.strictObject({ key: settingKey, value: settingValue }),
      reply: reply<void>(),
    },
    /**
     * Opens the settings file as text in the system's editor, so the person can fix it. It takes
     * no path: only the settings file can be opened this way. Refused, with why, for a file that
     * isn't there, isn't a plain file within the limit, or is executable (`unopened`).
     */
    openFile: { input: z.undefined(), reply: reply<void>() },
    /** How much room the local copies take. */
    cacheUsage: { input: z.undefined(), reply: reply<CacheUsage>() },
    /**
     * Clears what Lo keeps to open pull requests fast, to fetch again when it's next needed: the
     * local copies that aren't in use, and the answers saved from GitHub. Never accounts, the pull
     * requests opened lately or marks.
     */
    clearCache: { input: z.undefined(), reply: reply<CacheCleared>() },
    /**
     * Shows the cache's folder in Finder, or in the system's file manager. Refused while the cache
     * isn't open (`noCache`): before Git is found, and without it.
     */
    showCache: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {
    /** The settings, each time they change. */
    state: settingsState,
  },
});

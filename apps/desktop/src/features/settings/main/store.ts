// The settings as main keeps them: what the file says, checked against what each feature declared,
// watched for changes and written back whole. Nothing here calls Electron, so it runs under unit
// tests.
//
// A value the schema refuses is reported and ignored: the setting is at its default, and the file
// keeps what it says, so the person can fix it. What no feature declared is kept as it is. A file
// that can't be read as a whole (a syntax error, say) leaves the settings as they were, and
// nothing is written until it can be, since writing would lose what the person typed.

import { IpcError } from '../../../ipc/contract.ts';
import { settingValue, type Problem, type Setting, type SettingsState } from '../contract.ts';
import type { SettingsStore } from '../service.ts';
import {
  errorCode,
  readSettings,
  SETTINGS_SIZE_LIMIT,
  shorten,
  signature,
  writeSettings,
  type Read,
} from './file.ts';

/** How often the file is looked at, in ms. */
const INTERVAL = 400;

/** A value as JSON holds it, which is all a setting's value can be. */
type Json = SettingsState['values'][string];

/** A declared setting, as the store keeps it: what it needs of the setting, whatever its type. */
interface Entry {
  /** The setting it was made from, to tell a second declaration of the same one. */
  readonly source: object;
  readonly key: string;
  readonly accepts: string;
  /** The value when the file has none, as JSON. */
  readonly fallback: Json;
  /** The value the schema accepts, as JSON, or that it doesn't. */
  readonly check: (value: unknown) => { ok: true; value: Json } | { ok: false };
}

/** Someone who wants a setting's value now and each time it changes. */
interface Watcher {
  readonly key: string;
  /** Tells the listener `value`, which the setting's schema accepts. */
  readonly tell: (value: unknown) => void;
  /** What it was last told, as JSON, or none before the first time. */
  told: string | undefined;
}

export interface SettingsOptions {
  /** The settings file's path. */
  readonly path: string;
  /** The file's place as a person would write it. */
  readonly shown: string;
  /** Hears the state each time it changes, once the file has been read. */
  readonly changed: (state: SettingsState) => void;
  readonly log: (message: string, error?: unknown) => void;
  /** How often the file is looked at, in ms. */
  readonly interval?: number;
}

export interface Settings extends SettingsStore {
  /** The state, once the file has been read. */
  state(): Promise<SettingsState>;
  /**
   * Changes a setting and writes the file. Fails with an `IpcError`: `invalid` for a setting no
   * feature declared or a value its schema refuses, `unwritable` when the file has a problem or
   * can't be written.
   */
  set(key: string, value: unknown): Promise<void>;
  /** Looks at the file once. The store does it by itself every `interval`; tests call it. */
  check(): Promise<void>;
  /** Stops watching and waits for a change being written. */
  stop(): Promise<void>;
}

/** What the person is told of a value the schema refuses. */
function wrong(entry: Entry, found: unknown): string {
  const text = shorten(JSON.stringify(found) ?? String(found), 40);
  const fallback = shorten(JSON.stringify(entry.fallback), 40);
  return `${entry.key} is ${text}, but it must be ${entry.accepts}. Lo uses ${fallback}.`;
}

/**
 * The settings in the file at `options.path`. It starts reading at once; nothing is told to
 * watchers, or published, before the file has been read.
 */
export function createSettings(options: SettingsOptions): Settings {
  const { path, log } = options;
  const interval = options.interval ?? INTERVAL;
  const declared = new Map<string, Entry>();
  const watchers = new Set<Watcher>();
  /** The file's object as it was last read in one piece: what the settings come from. */
  let raw: Readonly<Record<string, unknown>> = {};
  /** What is wrong with the file as a whole, if anything is. */
  let wholeProblem: string | undefined;
  /** What was last published, as JSON, and as a value. */
  let sent: string | undefined;
  let latest: SettingsState | undefined;
  let loaded = false;
  /** The signature of the file `raw` was read from. */
  let seen: string | undefined;
  /** A change the last poll saw, waiting to hold still. */
  let waiting: string | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Reads, polls and writes run one after another, never at once. */
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = queue.then(job);
    queue = result.catch(() => undefined);
    return result;
  };

  /** Takes a read of the file as the settings' source. A file that can't be read keeps the last. */
  const take = (read: Read): void => {
    if (read.kind === 'problem') {
      wholeProblem = read.problem;
      return;
    }
    wholeProblem = undefined;
    raw = read.kind === 'ok' ? read.values : {};
  };

  const compute = (): SettingsState => {
    const values: Record<string, Json> = {};
    const problems: Problem[] = [];
    if (wholeProblem !== undefined) problems.push({ message: wholeProblem });
    for (const [key, entry] of declared) {
      values[key] = entry.fallback;
      if (!Object.hasOwn(raw, key)) continue;
      const found = raw[key];
      const checked = entry.check(found);
      if (checked.ok) values[key] = checked.value;
      else problems.push({ key, message: wrong(entry, found) });
    }
    return { file: options.shown, values, problems };
  };

  /** Tells the watchers what changed for them, and publishes the state if it changed. */
  const update = (): void => {
    if (!loaded) return;
    const state = compute();
    for (const watcher of watchers) {
      const value = state.values[watcher.key];
      const json = JSON.stringify(value);
      if (watcher.told === json) continue;
      watcher.told = json;
      try {
        watcher.tell(value);
      } catch (error) {
        log(`A setting's listener failed (${watcher.key}):`, error);
      }
    }
    latest = state;
    const json = JSON.stringify(state);
    if (json === sent) return;
    sent = json;
    options.changed(state);
  };

  const first = enqueue(async () => {
    seen = await signature(path);
    take(await readSettings(path));
    loaded = true;
    update();
  });

  const poll = async (): Promise<void> => {
    if (stopped) return;
    const now = await signature(path);
    if (now === seen) {
      waiting = undefined;
      return;
    }
    // A change is read once it has held still for a whole interval, so a save in the middle of
    // being written is never read.
    if (now !== waiting) {
      waiting = now;
      return;
    }
    const read = await readSettings(path);
    if (stopped) return;
    seen = now;
    waiting = undefined;
    take(read);
    update();
  };

  const check = (): Promise<void> =>
    enqueue(poll).catch((error: unknown) => {
      log("Lo couldn't look at the settings file:", error);
    });

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void check().finally(schedule);
    }, interval);
    // Watching the file never keeps Lo running.
    timer.unref();
  };
  first.then(schedule, (error: unknown) => {
    log("Lo couldn't read the settings file:", error);
    schedule();
  });

  const declare = <T>(setting: Setting<T>): void => {
    const known = declared.get(setting.key);
    if (known) {
      if (known.source !== setting)
        throw new Error(`The setting ${setting.key} is declared twice.`);
      return;
    }
    declared.set(setting.key, {
      source: setting,
      key: setting.key,
      accepts: setting.accepts,
      // `defineSetting` checked that the default is JSON.
      fallback: settingValue.parse(setting.fallback),
      check(value) {
        const parsed = setting.schema.safeParse(value);
        if (!parsed.success) return { ok: false };
        // A schema that turns the value into something JSON can't hold is refusing it.
        const json = settingValue.safeParse(parsed.data);
        return json.success ? { ok: true, value: json.data } : { ok: false };
      },
    });
    update();
  };

  return {
    declare,

    watch(setting, listener) {
      declare(setting);
      const watcher: Watcher = {
        key: setting.key,
        // The value was checked against this schema when it was computed.
        tell: (value) => listener(setting.schema.parse(value)),
        told: undefined,
      };
      watchers.add(watcher);
      update();
      return () => {
        watchers.delete(watcher);
      };
    },

    async state() {
      await first;
      return latest ?? compute();
    },

    async set(key, value) {
      const entry = declared.get(key);
      if (!entry) throw new IpcError('invalid', `There's no setting called ${key}.`);
      const checked = entry.check(value);
      if (!checked.ok) throw new IpcError('invalid', `${key} must be ${entry.accepts}.`);
      return enqueue(async () => {
        // The file as it is now, not as it was last looked at: a person may have just saved it.
        const fresh = await readSettings(path);
        take(fresh);
        update();
        if (fresh.kind === 'problem') {
          throw new IpcError(
            'unwritable',
            `Lo didn't change ${key}, since the settings file has a problem. ${fresh.problem}`,
          );
        }
        const next = { ...(fresh.kind === 'ok' ? fresh.values : {}), [key]: checked.value };
        const text = `${JSON.stringify(next, null, 2)}\n`;
        if (Buffer.byteLength(text) > SETTINGS_SIZE_LIMIT) {
          throw new IpcError(
            'unwritable',
            `Lo didn't change ${key}: the settings file would be too big.`,
          );
        }
        try {
          await writeSettings(path, text);
        } catch (error) {
          log("Lo couldn't write the settings file:", error);
          const code = errorCode(error);
          throw new IpcError(
            'unwritable',
            `Lo couldn't save ${key} to the settings file${code ? ` (${code})` : ''}.`,
          );
        }
        raw = next;
        wholeProblem = undefined;
        update();
      });
    },

    check,

    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await queue;
    },
  };
}

// The settings' values as the window has them, read and changed, for this feature's own files and
// for `shared.ts` to share with other features.

import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { client } from '../../../window/ipc.ts';
import { contract, settingValue, type Setting } from '../contract.ts';
import { settingsStore } from './store.ts';

/** The value of `setting` in what main last said, or its default. */
export function valueIn<T>(setting: Setting<T>, values: Record<string, unknown> | undefined): T {
  const parsed = setting.schema.safeParse(values?.[setting.key]);
  return parsed.success ? parsed.data : setting.fallback;
}

/** The value of a setting, once main has said, and its default until then; it follows changes. */
export function useValue<T>(setting: Setting<T>): T {
  const settings = useStore(settingsStore, (state) => state.settings);
  return valueIn(setting, settings?.values);
}

/** The value of a setting now, read once: main's, or its default until main has said. */
export function valueNow<T>(setting: Setting<T>): T {
  return valueIn(setting, settingsStore.getState().settings?.values);
}

/**
 * Why main didn't change a setting: what the settings file holds, which editing it fixes
 * (`file`); the file couldn't be saved (`unsaved`); or anything else (`other`). `reason` is main's
 * sentence for it, where what's between backticks is code, when it has one, and `details` the words
 * of what failed.
 */
export interface Refusal {
  readonly cause: 'file' | 'unsaved' | 'other';
  readonly reason: string | undefined;
  readonly details: string | undefined;
}

/** The cause of a refusal, as main's error code says it. */
function causeOf(error: unknown): Refusal['cause'] {
  if (!(error instanceof IpcError)) return 'other';
  if (error.code === 'settingsFile') return 'file';
  if (error.code === 'unsaved') return 'unsaved';
  return 'other';
}

/** Changes a setting, and says why when it can't be: `undefined` once it's written. */
export async function setValue<T>(setting: Setting<T>, value: T): Promise<Refusal | undefined> {
  try {
    await client(contract).set({
      key: setting.key,
      value: settingValue.parse(setting.schema.parse(value)),
    });
    return undefined;
  } catch (error) {
    console.error(`Lo couldn't change the setting ${setting.key}:`, error);
    const cause = causeOf(error);
    const message = error instanceof Error ? error.message : String(error);
    if (cause === 'other') return { cause, reason: undefined, details: message };
    // Main's reason, then on the lines after it the details.
    const [reason = '', ...rest] = message.split('\n');
    const details = rest.join('\n');
    return { cause, reason: reason || undefined, details: details || undefined };
  }
}

/**
 * What a setting is called in a sentence: as it says, or else its label, as a thing: "the theme".
 */
export function nameOf(setting: Pick<Setting<unknown>, 'label' | 'named'>): string {
  const { named, label } = setting;
  return named ?? `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * Why a change asked for from a key, the palette or the menu didn't happen, in a toast's line with
 * no full stop: main's reason, in plain words.
 */
export function refusalLine(
  refusal: Refusal,
  setting: Pick<Setting<unknown>, 'label' | 'named'>,
): string {
  if (refusal.reason !== undefined) return refusal.reason.replaceAll('`', '').replace(/\.$/, '');
  switch (refusal.cause) {
    case 'file':
      return 'settings.json has an error';
    case 'unsaved':
      return 'settings.json couldn’t be saved';
    case 'other':
      return `Couldn’t change ${nameOf(setting)}`;
    default:
      throw new Error(
        `A refusal Lo doesn’t know: ${JSON.stringify(refusal.cause satisfies never)}`,
      );
  }
}

/**
 * A setting as a control changes it: its value in what main said the file holds, how to write it,
 * and what a sentence calls it. Settings' rows change their settings this way, and so does a
 * screen that offers one of another feature's (`SettingChoice` in `shared.ts`).
 */
export interface Changing<T> {
  /** Its value in `values`, what main said the file holds: its default where that has none. */
  readonly valueIn: (values: Readonly<Record<string, unknown>> | undefined) => T;
  /** Writes `value`, and resolves with why the file refused it, or `undefined` once written. */
  readonly write: (value: T) => Promise<Refusal | undefined>;
  /** What a sentence calls it: "the theme". */
  readonly named: string;
}

/** `setting` as a control changes it. */
export function changingOf<T>(setting: Setting<T>): Changing<T> {
  return {
    valueIn: (values) => valueIn(setting, values),
    write: (value) => setValue(setting, value),
    named: nameOf(setting),
  };
}

/**
 * What a refusal is held against: the setting's value and what's wrong in the file. A row says a
 * refusal until either changes, since that may be what it was about.
 */
export function refusalMark<T>(setting: Pick<Changing<T>, 'valueIn'>): string {
  const settings = settingsStore.getState().settings;
  return JSON.stringify([setting.valueIn(settings?.values), settings?.problems ?? []]);
}

/** {@link refusalMark} as a hook: it follows the value and the file's problems. */
export function useRefusalMark<T>(setting: Pick<Changing<T>, 'valueIn'>): string {
  const settings = useStore(settingsStore, (state) => state.settings);
  return JSON.stringify([setting.valueIn(settings?.values), settings?.problems ?? []]);
}

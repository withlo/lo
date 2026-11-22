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
 * Changes a setting, and says why when it can't be: what main said, for a change it refused, or
 * `undefined` once it's written.
 */
export async function setValue<T>(setting: Setting<T>, value: T): Promise<string | undefined> {
  try {
    await client(contract).set({
      key: setting.key,
      value: settingValue.parse(setting.schema.parse(value)),
    });
    return undefined;
  } catch (error) {
    console.error(`Lo couldn't change the setting ${setting.key}:`, error);
    return error instanceof IpcError && (error.code === 'invalid' || error.code === 'unwritable')
      ? error.message
      : `Lo couldn't change ${setting.key}.`;
  }
}

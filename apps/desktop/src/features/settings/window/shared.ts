// What the settings feature shares with other features' window code: the slot they put their
// sections of Settings in, and the settings themselves, read and changed.

import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { defineSlot, defineView, type View } from '../../../window/slots.tsx';
import { contract, settingValue, type Problem, type Setting } from '../contract.ts';
import { sectionInfo, type SectionInfo } from './sections.ts';
import { settingsStore } from './store.ts';

/**
 * Where features put their sections of Settings. Each view is a section's settings, one `Setting`
 * after another; Settings draws its title, the line under it and its place in the list beside the
 * page. Make one with {@link defineSection}. Sections go in `order`, lower first: Accounts 10,
 * Trust 20, Pull requests 30, Appearance 40, Cache 50, Keys 60, Command line 70.
 */
export const sections = defineSlot('settings.sections');

/**
 * The rows of Settings' Pull requests section, one `Setting` per view, in `order`, lower first: how
 * a pull request's tab opens, such as on its overview or its diff (10), and how its diff is laid
 * out (20).
 */
export const opening = defineSlot('settings.opening');

/** Defines a section of Settings, for a feature's `views`. `id` is `<feature>.<name>`. */
export function defineSection(
  section: SectionInfo & { id: string; order: number; render: () => ReactNode },
): View {
  const { id, order, render, ...info } = section;
  const view = defineView(sections, { id, order, render });
  sectionInfo.set(id, info);
  return view;
}

/** The value of a setting, once main has said, and its default until then; it follows changes. */
export function useSetting<T>(setting: Setting<T>): T {
  const settings = useStore(settingsStore, (state) => state.settings);
  const found = settings?.values[setting.key];
  const parsed = setting.schema.safeParse(found);
  return parsed.success ? parsed.data : setting.fallback;
}

/**
 * The value of a setting once main has said what the settings file holds, and `undefined` until
 * then, for what mustn't act on the default by mistake; it follows changes.
 */
export function useKnownSetting<T>(setting: Setting<T>): T | undefined {
  const settings = useStore(settingsStore, (state) => state.settings);
  if (settings === undefined) return undefined;
  const parsed = setting.schema.safeParse(settings.values[setting.key]);
  return parsed.success ? parsed.data : setting.fallback;
}

/**
 * Changes a setting. Main checks the value again and writes the file; the setting then follows
 * through {@link useSetting}. When it can't be changed, Lo says why in a note, and this resolves
 * `false`.
 */
export async function changeSetting<T>(setting: Setting<T>, value: T): Promise<boolean> {
  try {
    await client(contract).set({
      key: setting.key,
      value: settingValue.parse(setting.schema.parse(value)),
    });
    return true;
  } catch (error) {
    console.error(`Lo couldn't change the setting ${setting.key}:`, error);
    notify(
      'Settings',
      error instanceof IpcError && (error.code === 'invalid' || error.code === 'unwritable')
        ? error.message
        : `Lo couldn't change ${setting.key}.`,
    );
    return false;
  }
}

/** What is wrong in the settings file now: the whole file's problem, or a setting's. */
export function useProblems(): readonly Problem[] {
  return useStore(settingsStore, (state) => state.settings?.problems) ?? [];
}

/** Where the settings file is, as a person would write it, once main has said. */
export function useSettingsFile(): string | undefined {
  return useStore(settingsStore, (state) => state.settings?.file);
}

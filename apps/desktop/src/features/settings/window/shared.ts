// What the settings feature shares with other features' window code: the slot they put their rows
// of Settings in, the settings themselves, read, changed and followed, and the file, to open.

import { createElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { defineSlot, defineView, type View } from '../../../window/slots.tsx';
import {
  checkRowWords,
  contract,
  type Problem,
  type Setting,
  type SettingsGroup,
  type SettingsState,
} from '../contract.ts';
import { SettingRowView, type ControlProps } from './Row.tsx';
import { settingsStore } from './store.ts';
import { refusalLine, setValue, useValue, valueIn, valueNow } from './values.ts';

export type { ControlProps } from './Row.tsx';

/** What Settings knows of a row besides how to draw it: where it goes, and the words it's found by. */
export interface RowAbout {
  readonly group: SettingsGroup;
  /** The row's label, in four words at most. */
  readonly label: string;
  /** Its one line, with a full stop. */
  readonly description: string;
  /** The setting's key, for a row that's one setting, which a search finds it by too. */
  readonly settingKey?: string;
  /** More words a search finds it by, such as the names a list holds. */
  readonly words?: () => readonly string[];
}

/**
 * Settings' rows, one view each, which Settings sorts into its groups by `order`, lower first, and
 * filters by what's typed in its search. Make one with {@link settingRow} for a setting, which
 * Settings draws from the setting itself, or with {@link defineRow} for anything else.
 */
export const rows = defineSlot<object, RowAbout>('settings.rows');

/**
 * A row of Settings for `setting`, drawn from what the setting says of itself: its label, its
 * description and its key, "Reset" while it isn't its default, and its control: a switch for one
 * that's on or off, a segmented control for a choice of its `options`, or `control` for any other.
 * A setting that's a list, as the trusted repos are, sets `list`, and its control is drawn as the
 * list under the row's words. A setting a command changes from a view, as `gi` does the diff's
 * layout, names it in `command`, and the row shows its key. The view's `id` is the setting's key
 * unless given, and like any view's it's named for the feature: `settings.theme` for `theme`.
 */
export function settingRow<T>(
  setting: Setting<T>,
  row: {
    readonly order: number;
    readonly id?: string;
    readonly control?: (props: ControlProps<T>) => ReactNode;
    readonly list?: boolean;
    readonly command?: string;
  },
): View {
  const { group } = setting;
  if (group === 'file') {
    throw new Error(`The setting ${setting.key} is only in the settings file, and has no row.`);
  }
  const plain = typeof setting.fallback === 'boolean' || setting.options !== undefined;
  if (!plain && row.control === undefined) {
    throw new Error(`The setting ${setting.key} needs a control of its own for its row.`);
  }
  return defineView(rows, {
    id: row.id ?? setting.key,
    order: row.order,
    group,
    label: setting.label,
    description: setting.description,
    settingKey: setting.key,
    render: () =>
      createElement(SettingRowView<T>, {
        setting,
        control: row.control,
        list: row.list,
        command: row.command,
      }),
  });
}

/**
 * A row of Settings that isn't one setting: a list, as the accounts are, or an action, as clearing
 * the cache is. Settings files it under `group`, and finds it by its label, its description and
 * `words`. `render` draws the row whole, given its words: a `Setting` with its controls, or a
 * `SettingsList`, from `@lo/ui`, so every row has the same anatomy. Its description is one line,
 * as a setting's is, and a row that breaks that fails as it's defined.
 */
export function defineRow(row: {
  readonly id: string;
  readonly group: SettingsGroup;
  readonly order: number;
  readonly label: string;
  readonly description: string;
  readonly words?: () => readonly string[];
  readonly render: (about: { label: string; description: string }) => ReactNode;
}): View {
  const { render, label, description } = row;
  checkRowWords(`The row ${row.id}`, label, description);
  return defineView(rows, { ...row, render: () => createElement(render, { label, description }) });
}

/** The value of a setting, once main has said, and its default until then; it follows changes. */
export function useSetting<T>(setting: Setting<T>): T {
  return useValue(setting);
}

/**
 * The value of a setting once main has said what the settings file holds, and `undefined` until
 * then, for what mustn't act on the default by mistake; it follows changes.
 */
export function useKnownSetting<T>(setting: Setting<T>): T | undefined {
  const settings = useStore(settingsStore, (state) => state.settings);
  return settings === undefined ? undefined : valueIn(setting, settings.values);
}

/** The value of a setting now, read once: main's, or its default until main has said. */
export function settingNow<T>(setting: Setting<T>): T {
  return valueNow(setting);
}

/**
 * Calls `listener` with a setting's value once main has said what the file holds, and again each
 * time the value changes, however it was changed: by a key, the menu, Settings or the file. Returns
 * a function that stops it.
 */
export function watchSetting<T>(setting: Setting<T>, listener: (value: T) => void): () => void {
  let last: string | undefined;
  const hear = () => {
    const settings = settingsStore.getState().settings;
    if (settings === undefined) return;
    const value = valueIn(setting, settings.values);
    const said = JSON.stringify(value);
    if (said === last) return;
    last = said;
    listener(value);
  };
  hear();
  return settingsStore.subscribe(hear);
}

/**
 * Changes a setting from a key, the palette or the menu, where there's no row to say it on. Main
 * checks the value again and writes the file; the setting then follows through
 * {@link useSetting}. When it can't be changed, a toast says why nothing happened, and this
 * resolves `false`.
 */
export async function changeSetting<T>(setting: Setting<T>, value: T): Promise<boolean> {
  const refusal = await setValue(setting, value);
  if (refusal !== undefined) refuse(refusalLine(refusal, setting));
  return refusal === undefined;
}

/**
 * Opens the settings file in the system's text editor, so the person can fix what's wrong in it,
 * as "Open `settings.json`" does. When it can't be opened, a toast says why.
 */
export async function openSettingsFile(): Promise<void> {
  try {
    await client(contract).openFile();
  } catch (error) {
    console.error("Lo couldn't open the settings file:", error);
    refuse(
      error instanceof IpcError && error.code === 'unopened'
        ? error.message
        : 'Couldn’t open `settings.json`',
    );
  }
}

/**
 * Calls `listener` with the settings each time main says they changed: the file was saved, by a
 * person or by Lo, and a value, a problem in it, or where it is changed. Returns a function that
 * stops it.
 */
export function onSettingsChange(listener: (state: SettingsState) => void): () => void {
  return client(contract).subscribe('state', (state) => listener(state));
}

/** What is wrong in the settings file now: the whole file's problem, or a setting's. */
export function useProblems(): readonly Problem[] {
  return useStore(settingsStore, (state) => state.settings?.problems) ?? [];
}

/** Where the settings file is, as a person would write it, once main has said. */
export function useSettingsFile(): string | undefined {
  return useStore(settingsStore, (state) => state.settings?.file);
}

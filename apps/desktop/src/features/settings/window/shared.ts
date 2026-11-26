// What the settings feature shares with other features' window code: the slot they put their rows
// of Settings in, the settings themselves, read, changed and followed, a setting of a few options
// as another screen offers it, the theme among them, a setting as a row outside Settings changes
// it, and the file, to open.

import { createElement, useMemo, type ReactElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { defineSlot, defineView, type Presence, type View } from '../../../window/slots.tsx';
import {
  checkRowWords,
  contract,
  groupNames,
  type Problem,
  type Setting,
  type SettingsGroup,
  type SettingsState,
} from '../contract.ts';
import { theme } from '../settings.ts';
import { SettingRowView, useChange, type ControlProps } from './Row.tsx';
import { settingsStore } from './store.ts';
import {
  changingOf,
  refusalLine,
  setValue,
  useValue,
  valueIn,
  valueNow,
  type Changing,
} from './values.ts';

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
 * unless given, and like any view's it's named for the feature: `settings.theme` for `theme`. A
 * row whose line says more while something else is on, such as another feature, reads it with
 * `useLine`, a hook: the setting's own line is what search finds it by. A row of a feature a setting
 * turns off comes and goes with it (`present`).
 */
export function settingRow<T>(
  setting: Setting<T>,
  row: {
    readonly order: number;
    readonly id?: string;
    readonly control?: (props: ControlProps<T>) => ReactNode;
    readonly list?: boolean;
    readonly command?: string;
    readonly useLine?: () => string;
    readonly present?: Presence;
  },
): View {
  const plain = typeof setting.fallback === 'boolean' || setting.options !== undefined;
  if (!plain && row.control === undefined) {
    throw new Error(`The setting ${setting.key} needs a control of its own for its row.`);
  }
  const { useLine } = row;
  if (useLine === undefined) {
    return defineView(rows, {
      ...aboutOf(setting, row),
      render: () =>
        createElement(SettingRowView<T>, {
          setting,
          control: row.control,
          list: row.list,
          command: row.command,
        }),
    });
  }
  // A component of its own, so the hook is its own.
  function Lined(): ReactNode {
    const description = useLine?.() ?? setting.description;
    checkRowWords(`The setting ${setting.key}`, setting.label, description);
    return createElement(SettingRowView<T>, {
      setting: { ...setting, description },
      control: row.control,
      list: row.list,
      command: row.command,
    });
  }
  return defineView(rows, { ...aboutOf(setting, row), render: () => createElement(Lined) });
}

/** What Settings knows of `setting`'s row besides how to draw it, and where it goes. */
function aboutOf<T>(
  setting: Setting<T>,
  row: { readonly order: number; readonly id?: string; readonly present?: Presence },
) {
  if (setting.group === 'file') {
    throw new Error(`The setting ${setting.key} is only in the settings file, and has no row.`);
  }
  return {
    id: row.id ?? setting.key,
    order: row.order,
    group: setting.group,
    label: setting.label,
    description: setting.description,
    settingKey: setting.key,
    present: row.present,
  };
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
  /** Whether it's in Settings now, for a row of a feature a setting turns off. */
  readonly present?: Presence;
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
 * One of a choice's options: its value, the words its row in Settings has for it, and the line its
 * card has where the feature gave one.
 */
export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** What its card's picture can't show, such as what a click does. Settings' row doesn't show it. */
  readonly description?: string;
}

/**
 * A setting of a few options, as a screen besides Settings offers it: the welcome offers the theme,
 * the diff's layout and how threads show in code as cards. All it says comes from the setting: its
 * key, its row's label, its options with their words in the row's order, and where its row is; and
 * from the feature, a line for each option's card where its picture can't say what it does. A
 * feature offers one of its settings this way, made in its `window/shared.ts` with
 * {@link choiceOf}, rather than handing the setting on; {@link useChoice} reads and changes it.
 */
export interface SettingChoice<T extends string> extends Changing<T> {
  readonly key: string;
  readonly label: string;
  /** Where its row is, as a path: "Settings › Appearance". */
  readonly place: string;
  readonly options: readonly ChoiceOption<T>[];
  /**
   * What the file holds of it, in `values`, what main said it holds: its own value, or its default
   * where it has none. Nothing before main has said, or where the file holds a value that isn't
   * one of its options: then a press on any card, the default's too, is a change.
   */
  readonly onFileIn: (values: Readonly<Record<string, unknown>> | undefined) => T | undefined;
}

/**
 * `setting` as another screen offers it: one of a few options, with a row in Settings. `lines` is
 * a line for each option's card, for a choice whose pictures can't show what its options do; give
 * every option one, or none.
 */
export function choiceOf<T extends string>(
  setting: Setting<T>,
  lines?: Readonly<Record<T, string>>,
): SettingChoice<T> {
  const { group, options } = setting;
  if (group === 'file' || options === undefined) {
    throw new Error(`The setting ${setting.key} isn’t a choice with a row in Settings.`);
  }
  return {
    ...changingOf(setting),
    key: setting.key,
    label: setting.label,
    place: `Settings › ${groupNames[group]}`,
    options: Object.entries(options).flatMap(([option, label]) => {
      const parsed = setting.schema.safeParse(option);
      if (!parsed.success) return [];
      const value = parsed.data;
      return [lines === undefined ? { value, label } : { value, label, description: lines[value] }];
    }),
    onFileIn: (values) => {
      if (values === undefined) return undefined;
      if (!Object.hasOwn(values, setting.key)) return setting.fallback;
      const parsed = setting.schema.safeParse(values[setting.key]);
      return parsed.success ? parsed.data : undefined;
    },
  };
}

/** Lo's colors, as another screen offers them. */
export const themeChoice = choiceOf(theme);

/**
 * A choice's value: main's, or its default until main has said or while the file's isn't one of
 * its options; and `onFile`, what the file holds of it, which is nothing then
 * ({@link SettingChoice.onFileIn}). `change` writes another, and resolves once main has answered.
 * `problem` is the `Problem` the setting's row in Settings shows for a change main refused, with
 * what to do about it, until the value or what's wrong in the file changes.
 */
export function useChoice<T extends string>(
  choice: SettingChoice<T>,
): Changed<T> & { onFile: T | undefined } {
  const settings = useStore(settingsStore, (state) => state.settings);
  const { change, problem } = useChange(choice);
  return {
    value: choice.valueIn(settings?.values),
    onFile: choice.onFileIn(settings?.values),
    change,
    problem,
  };
}

/** A setting as a control outside Settings has it: its value, how to change it, and what went wrong. */
export interface Changed<T> {
  readonly value: T;
  /** Writes another value, and resolves once main has answered, either way. */
  readonly change: (value: T) => Promise<void>;
  /** The `Problem` for a change main refused, or nothing. */
  readonly problem: ReactElement | undefined;
}

/**
 * A feature's own setting as a row outside Settings changes it, as a row of the welcome's does,
 * with the control its row in Settings has: its value, main's or its default until main has said;
 * `change`, which writes another; and `problem`, the `Problem` its row in Settings shows for a
 * change main refused, until the value or what's wrong in the file changes. No toast says it.
 */
export function useSettingChange<T>(setting: Setting<T>): Changed<T> {
  const changing = useMemo(() => changingOf(setting), [setting]);
  const value = useValue(setting);
  const { change, problem } = useChange(changing);
  return { value, change, problem };
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

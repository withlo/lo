// A setting's row in Settings, drawn from the setting itself: its label, its description and its
// key, "Reset" while it isn't its default, and its control, beside the key of the command that
// changes it elsewhere. A change main refuses is said on the row, and the control shows the value
// the file still holds.

import { Key, SegmentedControl, Setting as SettingRow, SettingsList, Switch } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { createElement, useState, type ReactNode } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import type { Setting } from '../contract.ts';
import { setValue, useValue } from './values.ts';

/** What a setting's own control gets: its value now, and how to change it. */
export interface ControlProps<T> {
  readonly value: T;
  /** Changes the setting. A change main refuses is said on the row, and the value stays. */
  readonly change: (value: T) => void;
  /** Says what's wrong with what was typed on the row, under its description, or clears it. */
  readonly note: (text: string | undefined) => void;
}

/** The control a setting gets without one of its own: a switch, or a choice of its options. */
function plainControl<T>(setting: Setting<T>, value: T, change: (value: unknown) => void) {
  if (typeof value === 'boolean') {
    return <Switch checked={value} aria-label={setting.label} onCheckedChange={change} />;
  }
  const { options } = setting;
  if (options === undefined) return null;
  return (
    <SegmentedControl
      label={setting.label}
      kind="choice"
      size="sm"
      items={Object.entries(options).map(([option, label]) => ({ value: option, label }))}
      value={String(value)}
      onChange={change}
    />
  );
}

/** Command `id`'s first key, as this system shows it, quietly: the way to the setting from a view. */
function CommandKey({ id }: { id: string }) {
  // The keys follow the keymap file.
  useKeys();
  const [first] = registry().keysOf(id);
  return first === undefined ? null : (
    <Key keys={keyLabels(first, registry().system)} quiet decorative />
  );
}

export function SettingRowView<T>({
  setting,
  control,
  list,
  command,
}: {
  setting: Setting<T>;
  control?: ((props: ControlProps<T>) => ReactNode) | undefined;
  /** The setting is a list, drawn under the row's words. */
  list?: boolean | undefined;
  /** The command that changes the setting from a view, whose key the row shows. */
  command?: string | undefined;
}) {
  const value = useValue(setting);
  const [note, setNote] = useState<string>();
  const [refused, setRefused] = useState<string>();
  const change = (next: T) => {
    setRefused(undefined);
    void setValue(setting, next).then(setRefused);
  };
  // What a plain control hands back is one of the setting's own values, checked again here.
  const changeTo = (next: unknown) => {
    const parsed = setting.schema.safeParse(next);
    if (parsed.success) change(parsed.data);
  };
  const atDefault = JSON.stringify(value) === JSON.stringify(setting.fallback);
  if (list && control) {
    return (
      <SettingsList label={setting.label} description={setting.description}>
        {refused !== undefined && <p role="alert">{refused}</p>}
        {createElement(control, { value, change, note: setNote })}
      </SettingsList>
    );
  }
  return (
    <SettingRow
      label={setting.label}
      description={setting.description}
      settingKey={setting.key}
      note={refused ?? note}
      onReset={
        setting.window === 'write' && !atDefault ? () => change(setting.fallback) : undefined
      }
      resetName={setting.label}
    >
      {command !== undefined && <CommandKey id={command} />}
      {control
        ? createElement(control, { value, change, note: setNote })
        : plainControl(setting, value, changeTo)}
    </SettingRow>
  );
}

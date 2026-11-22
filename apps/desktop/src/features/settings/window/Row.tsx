// A setting's row in Settings, drawn from the setting itself: its label, its description and its
// key, "Reset" while it isn't its default, and its control. A setting a key also changes elsewhere
// gives that key in its control's tooltip, since the key doesn't work in Settings. A change main
// refuses is a `Problem` under the row, and the control shows the value the file still holds.

import {
  Collapse,
  Problem,
  SegmentedControl,
  Setting as SettingRow,
  SettingsList,
  Switch,
  Tooltip,
} from '@lo/ui';
import { keyLabels, NO_TARGET } from '@lo/ui/commands';
import { createElement, useId, useState, type ReactElement, type ReactNode } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import type { Setting } from '../contract.ts';
import { Ticks } from './Ticks.tsx';
import { nameOf, refusalMark, setValue, useRefusalMark, useValue, type Refusal } from './values.ts';

/** What a setting's own control gets: its value now, and how to change it. */
export interface ControlProps<T> {
  readonly value: T;
  /** Changes the setting. A change main refuses is said on the row, and the value stays. */
  readonly change: (value: T) => void;
  /** Says what's wrong with what was typed on the row, under its description, or clears it. */
  readonly note: (text: string | undefined) => void;
  /** The id of that note while it's said, for the control's `aria-describedby`. */
  readonly noteId: string | undefined;
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

/**
 * The control, with command `id`'s label and key in its tooltip: the way to the setting from a
 * view. The key works there and not here, so it isn't a chip on the row.
 */
function CommandTip({ id, children }: { id: string; children: ReactElement }) {
  // The keys follow the keymap file.
  useKeys();
  const command = registry().command(id);
  if (!command) return children;
  const [first] = registry().keysOf(id);
  return (
    <Tooltip
      label={command.label}
      keys={first === undefined ? undefined : keyLabels(first, registry().system)}
    >
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}

/** A change main refused, under the row: what failed, why, and the one thing to do. */
function Refused({ name, refusal, again }: { name: string; refusal: Refusal; again: () => void }) {
  const file = refusal.cause === 'file';
  const reason =
    refusal.reason ??
    (file
      ? '`settings.json` has an error.'
      : refusal.cause === 'unsaved'
        ? '`settings.json` couldn’t be saved.'
        : undefined);
  return (
    <Problem
      title={`Couldn’t change ${name}`}
      reason={reason === undefined ? undefined : <Ticks text={reason} />}
      action={
        file
          ? {
              label: <Ticks text="Open `settings.json`" />,
              onClick: () => void registry().run('settings.openFile', NO_TARGET),
            }
          : { label: 'Try again', onClick: again }
      }
      details={refusal.details}
    />
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
  /** The command that changes the setting from a view, whose key the control's tooltip gives. */
  command?: string | undefined;
}) {
  const value = useValue(setting);
  const [note, setNote] = useState<string>();
  const noteId = useId();
  const own = {
    value,
    change: (next: T) => change(next),
    note: setNote,
    noteId: note === undefined ? undefined : noteId,
  };
  /** The last change main refused, the value asked for, and what it was held against. */
  const [refused, setRefused] = useState<{ refusal: Refusal; asked: T; mark: string }>();
  // Said until the value or what's wrong in the file changes, which may be what it was about.
  const mark = useRefusalMark(setting);
  const shown = refused !== undefined && refused.mark === mark ? refused : undefined;
  const change = (next: T) => {
    setRefused(undefined);
    void setValue(setting, next).then((refusal) => {
      // What main said of the file came before its answer, so the mark is as the refusal found it.
      if (refusal) setRefused({ refusal, asked: next, mark: refusalMark(setting) });
    });
  };
  // What a plain control hands back is one of the setting's own values, checked again here.
  const changeTo = (next: unknown) => {
    const parsed = setting.schema.safeParse(next);
    if (parsed.success) change(parsed.data);
  };
  const problem = shown && (
    <Refused name={nameOf(setting)} refusal={shown.refusal} again={() => change(shown.asked)} />
  );
  const atDefault = JSON.stringify(value) === JSON.stringify(setting.fallback);
  if (list && control) {
    return (
      <SettingsList label={setting.label} description={setting.description}>
        <Collapse open={problem !== undefined}>
          {problem && <div className="border-b border-border-subtle p-8">{problem}</div>}
        </Collapse>
        {createElement(control, own)}
      </SettingsList>
    );
  }
  const drawn = control ? createElement(control, own) : plainControl(setting, value, changeTo);
  return (
    <SettingRow
      label={setting.label}
      description={setting.description}
      settingKey={setting.key}
      note={note}
      noteId={noteId}
      below={problem}
      onReset={
        setting.window === 'write' && !atDefault ? () => change(setting.fallback) : undefined
      }
      resetName={setting.label}
    >
      {command !== undefined && drawn ? <CommandTip id={command}>{drawn}</CommandTip> : drawn}
    </SettingRow>
  );
}

// Settings' rows for the overview's lists kept per repo, under Pull requests: Collapsed sections, the
// sections that start collapsed, by heading, from `overview.collapsed`; and Ignored terms, the
// glossary terms that show as plain text, from `overview.ignored`. Each shows every repo's list,
// then each repo with one of its own, which replaces every repo's there. What's typed in a row's
// field is added to every repo's list; one already there is shown instead, and the tl;dr is
// refused as a heading, since it never folds.

import {
  Button,
  Input,
  land,
  reveal,
  ScopedList,
  type ScopedEntry,
  type ScopedKind,
  type ScopedRepo,
} from '@lo/ui';
import { useRef, useState, type ReactNode } from 'react';

import type { Setting } from '../../settings/contract.ts';
import { settingRow, type ControlProps } from '../../settings/window/shared.ts';
import {
  addToEvery,
  collapsed,
  entryKey,
  entryMax,
  everywhere,
  holds,
  ignored,
  readScoped,
  removeFrom,
  resetRepo,
  setEverywhere,
  type Scoped,
  type ScopedValue,
} from '../settings.ts';
import { overviews } from './shared.ts';

/** The tl;dr, as a heading is matched: it never collapses. */
const TLDR = entryKey('tl;dr');

/** A list's entries as rows, each entry once, however many times the file has it. */
function rowsOf(scoped: Scoped, entries: readonly string[], repo: boolean): ScopedEntry[] {
  const rows = new Map<string, ScopedEntry>();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (rows.has(key)) continue;
    rows.set(
      key,
      repo ? { key, label: entry, everywhere: everywhere(scoped, entry) } : { key, label: entry },
    );
  }
  return [...rows.values()];
}

/** The lists of `setting`, a list of `kind` kept per repo, under the row's words. */
function listsOf(setting: Setting<ScopedValue>, kind: ScopedKind) {
  return function Lists({ value, change }: ControlProps<ScopedValue>): ReactNode {
    const { scoped } = readScoped(value, setting.key);
    const repos: ScopedRepo[] = scoped.repos
      .toSorted((one, other) => one.repo.localeCompare(other.repo, 'en', { sensitivity: 'base' }))
      .map(({ repo, entries }) => ({ repo, entries: rowsOf(scoped, entries, true) }));
    // The entry as a repo's list writes it, which goes into every list as it's written.
    const labelIn = (key: string, repo: string) =>
      repos.find((each) => each.repo === repo)?.entries.find((each) => each.key === key)?.label;
    return (
      <ScopedList
        kind={kind}
        every={rowsOf(scoped, scoped.every, false)}
        repos={repos}
        onRemove={(key, repo) => change(removeFrom(value, repo, key))}
        onEverywhere={(key, repo) => {
          const label = labelIn(key, repo);
          if (label !== undefined) change(setEverywhere(value, label, true));
        }}
        onReset={(repo) => change(resetRepo(value, repo))}
      />
    );
  };
}

/** What a row's field asks for, and what it refuses, in words. */
interface FieldWords {
  /** Its placeholder: "Heading". */
  readonly placeholder: string;
  /** Its name for a screen reader: "Heading to collapse". */
  readonly label: string;
  /** Why an entry is refused, by its key, said under the row's line; nothing for one it takes. */
  readonly refuse?: ((key: string) => string | undefined) | undefined;
}

/**
 * The field that adds to every repo's list of `setting`, at the row's end, and its Add: `⏎` adds
 * too. An entry every repo's list has already is shown there, with the Land move, rather than added
 * twice.
 */
function adderOf(setting: Setting<ScopedValue>, words: FieldWords) {
  return function Add({ value, change, note, noteId }: ControlProps<ScopedValue>): ReactNode {
    const [text, setText] = useState('');
    const [refused, setRefused] = useState(false);
    const own = useRef<HTMLDivElement>(null);
    const entry = text.trim().replace(/\s+/gu, ' ');

    const add = () => {
      if (entry === '') return;
      const key = entryKey(entry);
      const why = words.refuse?.(key);
      if (why !== undefined) {
        setRefused(true);
        note(why);
        return;
      }
      setText('');
      const { scoped } = readScoped(value, setting.key);
      if (!holds(scoped.every, entry)) {
        change(addToEvery(value, entry));
        return;
      }
      const row = own.current
        ?.closest('[role="group"]')
        ?.querySelector('[data-scope="*"]')
        ?.querySelectorAll<HTMLElement>('[data-key]');
      const found = [...(row ?? [])].find((each) => each.dataset['key'] === key);
      if (!found) return;
      reveal(found);
      land(found);
    };

    // The field asks for `lo-field-w`. Where the row has less room, both go under its words.
    return (
      <div ref={own} className="flex min-w-0 items-center gap-8">
        <div className="flex w-field-w min-w-0">
          <Input
            aria-label={words.label}
            aria-describedby={noteId}
            placeholder={words.placeholder}
            maxLength={entryMax(setting.key)}
            invalid={refused}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setRefused(false);
              note(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
        </div>
        <Button disabled={entry === ''} onClick={add}>
          Add
        </Button>
      </div>
    );
  };
}

/** Collapsed sections' lists, by heading. */
export const CollapsedLists = listsOf(collapsed, 'heading');

/** Collapsed sections' field, which refuses the tl;dr. */
export const CollapsedAdd = adderOf(collapsed, {
  placeholder: 'Heading',
  label: 'Heading to collapse',
  refuse: (key) => (key === TLDR ? 'The tl;dr can’t collapse.' : undefined),
});

/** Ignored terms' lists, by term. */
export const IgnoredLists = listsOf(ignored, 'term');

/** Ignored terms' field. */
export const IgnoredAdd = adderOf(ignored, { placeholder: 'Term', label: 'Term to ignore' });

// Settings › Pull requests, after whether agents write overviews (6): the sections that start
// collapsed, then the terms ignored. Both go with overviews.
export const CollapsedRow = settingRow(collapsed, {
  order: 7,
  control: CollapsedLists,
  list: true,
  actions: CollapsedAdd,
  present: overviews,
});

export const IgnoredRow = settingRow(ignored, {
  order: 8,
  control: IgnoredLists,
  list: true,
  actions: IgnoredAdd,
  present: overviews,
});

// Settings' Collapsed sections row, under Pull requests: the overview sections that start
// collapsed, by heading, from `overview.collapsed`. Every repo's list, then each repo with one of
// its own, which replaces every repo's there. A heading typed in the row's field is added to every
// repo's list; one already there is shown instead, and the tl;dr is refused, since it never folds.

import { Button, Input, land, reveal, ScopedList, type ScopedEntry, type ScopedRepo } from '@lo/ui';
import { useRef, useState } from 'react';

import { settingRow, type ControlProps } from '../../settings/window/shared.ts';
import {
  addToEvery,
  collapsed,
  ENTRY_MAX,
  entryKey,
  everywhere,
  holds,
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

/** A list's entries as rows, each heading once, however many times the file has it. */
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

/** The lists, under the row's words: every repo's, then each repo's own, by name. */
export function Lists({ value, change }: ControlProps<ScopedValue>) {
  const { scoped } = readScoped(value, collapsed.key);
  const repos: ScopedRepo[] = scoped.repos
    .toSorted((one, other) => one.repo.localeCompare(other.repo, 'en', { sensitivity: 'base' }))
    .map(({ repo, entries }) => ({ repo, entries: rowsOf(scoped, entries, true) }));
  // The heading as a repo's list writes it, which goes into every list as it's written.
  const labelIn = (key: string, repo: string) =>
    repos.find((each) => each.repo === repo)?.entries.find((each) => each.key === key)?.label;
  return (
    <ScopedList
      kind="heading"
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
}

/**
 * The field that adds a heading to every repo's list, at the row's end, and its Add: `⏎` adds too.
 * A heading every repo's list has already is shown there, with the Land move, rather than added
 * twice.
 */
export function Add({ value, change, note, noteId }: ControlProps<ScopedValue>) {
  const [text, setText] = useState('');
  const [refused, setRefused] = useState(false);
  const own = useRef<HTMLDivElement>(null);
  const heading = text.trim().replace(/\s+/gu, ' ');

  const add = () => {
    if (heading === '') return;
    const key = entryKey(heading);
    if (key === TLDR) {
      setRefused(true);
      note('The tl;dr can’t collapse.');
      return;
    }
    setText('');
    const { scoped } = readScoped(value, collapsed.key);
    if (!holds(scoped.every, heading)) {
      change(addToEvery(value, heading));
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
          aria-label="Heading to collapse"
          aria-describedby={noteId}
          placeholder="Heading"
          maxLength={ENTRY_MAX}
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
      <Button disabled={heading === ''} onClick={add}>
        Add
      </Button>
    </div>
  );
}

// Settings › Pull requests, after whether agents write overviews (6). It goes with overviews.
export default settingRow(collapsed, {
  order: 7,
  control: Lists,
  list: true,
  actions: Add,
  present: overviews,
});

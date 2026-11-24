// Settings, in its tab: its groups in a list, and beside it one column of the rows every feature
// put in the `settings.rows` slot, under a search field that filters them, with what is wrong with
// the settings file above them.

import {
  EmptyState,
  Input,
  Key,
  Problem,
  reveal,
  SettingsCommand,
  SettingsGroup,
  SettingsPage,
  Ticks,
} from '@lo/ui';
import { keyLabels, NO_TARGET } from '@lo/ui/commands';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { useViews } from '../../../window/slots.tsx';
import { groupNames, settingsGroups, type SettingsGroup as Group } from '../contract.ts';
import { onMoveSection, onSearch, searchStore } from './nav.ts';
import { rows, useProblems, type RowAbout } from './shared.ts';

/** The id of a group's element, and what the list goes to. */
const groupId = (group: Group) => `settings-${group}`;

/** `settings.json`, as code. */
const FILE = <span className="code-small">settings.json</span>;

/** What is wrong in the settings file, above the rows, where the person who edited it looks. */
function Problems() {
  const problems = useProblems();
  if (problems.length === 0) return null;
  const whole = problems.some(({ key }) => key === undefined);
  const settings = new Set(problems.flatMap(({ key }) => (key === undefined ? [] : [key]))).size;
  return (
    <Problem
      title={
        whole ? (
          <>Can’t read {FILE}</>
        ) : (
          `Can’t use ${settings === 1 ? '1 setting' : `${settings} settings`}`
        )
      }
      reason={problems.map(({ key, message }) => (
        // A line each, inside the reason's paragraph.
        <span key={`${key ?? ''} ${message}`} className="block" data-problem="">
          <Ticks text={message} />
        </span>
      ))}
      action={{
        label: <>Open {FILE}</>,
        onClick: () => void registry().run('settings.openFile', NO_TARGET),
      }}
    />
  );
}

/** Whether a row holds every word of `query`, in its label, its line, its key or its own words. */
export function matches(row: RowAbout, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [row.label, row.description, row.settingKey ?? '', ...(row.words?.() ?? [])]
    .join('\n')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Whether the body is scrolled as far down as it goes, having scrolled at all. */
function atEnd(body: HTMLElement): boolean {
  return body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
}

/** The group whose top is the last at or above the top of the body, or the last at the end. */
function groupOnScreen(body: HTMLElement): string | undefined {
  const all = [...body.querySelectorAll<HTMLElement>('[data-settings-section]')];
  const top = body.getBoundingClientRect().top;
  let found = all[0];
  for (const group of all) {
    if (group.getBoundingClientRect().top - top <= 1) found = group;
  }
  if (atEnd(body)) found = all.at(-1);
  return found?.dataset.settingsSection;
}

/** The key that goes to the search, as this system shows it now, at the field's end. */
function SearchKey() {
  useKeys();
  const [first] = registry().keysOf('settings.search');
  return first ? <Key keys={keyLabels(first, registry().system)} quiet decorative /> : null;
}

/** Puts `text` in the search, which filters the rows by it. */
const setQuery = (text: string) => searchStore.setState({ query: text });

/** Settings, the page of the tab of that kind. */
export function SettingsTab() {
  const views = useViews(rows);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const query = useStore(searchStore, (state) => state.query);
  /** Whether the field has focus, when the key that goes to it isn't shown. */
  const [searching, setSearching] = useState(false);
  const [current, setCurrent] = useState<string>();
  /**
   * The group last gone to by the list or a key, which stays the one on screen while the body
   * can't scroll its top up to the top, as near the end, until the person scrolls back up.
   */
  const chosen = useRef<string>(undefined);
  const shown = views.filter((view) => matches(view, query));
  const groups = settingsGroups.filter((group) => shown.some((view) => view.group === group));
  const items = groups.map((group) => ({ id: groupId(group), label: groupNames[group] }));
  const here = items.some(({ id }) => id === current) ? current : items[0]?.id;

  const go = useCallback((id: string) => {
    chosen.current = id;
    setCurrent(id);
    const group = body.current?.querySelector(`[data-settings-section="${id}"]`);
    // Its own pane, and nothing round it: the window never scrolls.
    if (group) reveal(group, { block: 'start' });
  }, []);

  // `j` and `k` move between groups, from the one on screen.
  const ids = items.map(({ id }) => id).join(' ');
  useEffect(() => {
    const order = ids === '' ? [] : ids.split(' ');
    return onMoveSection((step) => {
      const at = Math.max(0, order.indexOf(here ?? order[0] ?? ''));
      const next = order[Math.min(order.length - 1, Math.max(0, at + step))];
      if (next !== undefined) go(next);
    });
  }, [ids, here, go]);

  // The search is the page's: one opened later starts with none.
  useEffect(() => () => searchStore.setState({ query: '' }), []);

  // `/` and `⌘F` go to the search, with what it holds selected.
  useEffect(
    () =>
      onSearch(() => {
        field.current?.focus();
        field.current?.select();
      }),
    [],
  );

  // Settings is the middle of the window, so `Esc` brings focus here. So does opening it, when
  // focus was nowhere in particular: on the window, or on the middle itself, which `Esc` leaves it
  // on while no view is there. Focus in a field or on a control stays where it is.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) {
      root.current?.focus();
    }
    return setMiddle({
      focus: () => root.current?.focus(),
      holds: (element) => element === root.current,
      here: () => undefined,
    });
  }, []);

  const searched = query.trim();
  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="settings"
      data-lo-tab="browser"
      className="flex min-h-0 flex-1 flex-col focus-visible:shadow-none"
    >
      <SettingsPage
        items={items}
        current={here}
        onGo={go}
        bodyRef={body}
        onBodyScroll={(event) => {
          const scrolled = event.currentTarget;
          if (chosen.current !== undefined && atEnd(scrolled)) return;
          chosen.current = undefined;
          setCurrent(groupOnScreen(scrolled));
        }}
        search={
          // The key that goes to the field is at its end while it would do something there.
          <div className="relative">
            <Input
              ref={field}
              type="search"
              aria-label="Search settings"
              placeholder="Search settings"
              value={query}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              onChange={(event) => {
                setQuery(event.target.value);
                body.current?.scrollTo?.({ top: 0 });
              }}
              onKeyDown={(event) => {
                // Down from the field, to the first control of the rows it found.
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                body.current
                  ?.querySelector<HTMLElement>(
                    'button:not([tabindex="-1"]), input, [role="switch"]',
                  )
                  ?.focus();
              }}
            />
            {!searching && query === '' && (
              <span className="pointer-events-none absolute inset-y-0 end-8 flex items-center">
                <SearchKey />
              </span>
            )}
          </div>
        }
        footer={
          <>
            <SettingsCommand command="settings.openFile" variant="ghost" size="sm">
              Open {FILE}
            </SettingsCommand>
            <SettingsCommand command="keys.openKeymap" variant="ghost" size="sm">
              Open keymap file
            </SettingsCommand>
          </>
        }
      >
        <Problems />
        {searched !== '' && shown.length === 0 && (
          // The rest of the column, as a view with nothing in it fills its view. Its scope is where
          // "Clear search"'s key works, which leaves the fields' keys to them.
          <div className="grid min-w-0 flex-1" data-lo-scope="noMatch">
            <EmptyState
              title={`No settings match “${searched}”`}
              actions={['settings.clearSearch']}
            />
          </div>
        )}
        {groups.map((group) => (
          <SettingsGroup key={group} id={groupId(group)} title={groupNames[group]}>
            {shown
              .filter((view) => view.group === group)
              .map((view) => (
                <div key={view.id} data-settings-row={view.id}>
                  {createElement(view.render, {})}
                </div>
              ))}
          </SettingsGroup>
        ))}
      </SettingsPage>
    </div>
  );
}

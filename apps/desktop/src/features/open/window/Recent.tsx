// Recent pull requests, the tab that stands in for an empty strip: the pull requests opened lately,
// across every account, newest first, with a filter; or, before any, how to open one.

import { Button, Input, Key } from '@lo/ui';
import { keyLabels, NO_TARGET } from '@lo/ui/commands';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';

import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import type { RecentPull } from '../contract.ts';
import { loadRecent, openRow, pasteLink, setFilterField } from './actions.ts';
import {
  acrossAccounts,
  chosenRow,
  filterRecent,
  groupRecent,
  recentStore,
  rowKey,
  whenOpened,
} from './rows.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** A key cap for `id`'s first key, if it has one. */
function KeyFor({ id, className }: { id: string; className?: string }) {
  const keys = keyOf(id);
  return keys ? <Key keys={keys} decorative className={className} /> : null;
}

/** The icon of a pull request, in no state's color: Lo keeps no state for the list. */
function PullIcon({ large }: { large?: boolean }) {
  return (
    <svg
      className={large ? 'lo-i size-40 text-fg-subtle' : 'lo-i text-icon-muted'}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="4.5" cy="3.75" r="1.5" />
      <circle cx="4.5" cy="12.25" r="1.5" />
      <circle cx="11.5" cy="12.25" r="1.5" />
      <path d="M4.5 5.25v5.5M11.5 10.75V6.5c0-1.1-.9-2-2-2H7.5M9 3 7.5 4.5 9 6" />
    </svg>
  );
}

/** The id of a row's element, for the list's `aria-activedescendant`. */
function rowId(row: RecentPull): string {
  return `recent-${rowKey(row).replace(/[^a-z0-9-]/g, '-')}`;
}

/** One pull request opened lately. */
function Row({ row, chosen, now }: { row: RecentPull; chosen: boolean; now: number }) {
  return (
    <div
      id={rowId(row)}
      role="option"
      aria-selected={chosen}
      onClick={() => void openRow(row)}
      className={`list-columns min-h-list-row-h cursor-default rounded-sm px-12 text-fg text-ui hover:bg-hover ${chosen ? 'bg-current-strong' : ''}`}
    >
      <PullIcon />
      <span className="truncate text-fg-muted code-small">
        {row.owner}/<span className="text-fg">{row.repo}</span>{' '}
        <span className="tabular-nums">#{row.number}</span>
      </span>
      <span className="truncate">{row.title ?? ''}</span>
      <span className="truncate text-fg-muted text-small">{row.login}</span>
      <span className="text-right text-fg-muted tabular-nums text-small">
        {whenOpened(row.openedAt, now)}
      </span>
    </div>
  );
}

/** Before any pull request was opened: how to open one. */
function FirstRun() {
  return (
    <div className="grid h-full place-items-center p-32 text-center">
      <div className="flex max-w-read-measure flex-col items-center gap-12">
        <PullIcon large />
        <h2 className="m-0 text-heading">No pull requests yet</h2>
        <p className="m-0 text-fg-muted read-body">
          Paste a link to a pull request. Every pull request you open, from any account, shows up
          here, newest first.
        </p>
        <div className="mt-6 flex gap-8">
          <Button variant="primary" onClick={() => registry().run('open.box', NO_TARGET)}>
            Review a pull request
            <KeyFor id="open.box" className="text-on-accent" />
          </Button>
          <Button onClick={() => void pasteLink()}>
            Paste a link
            <KeyFor id="open.paste" />
          </Button>
        </div>
        <div className="mt-16 flex flex-wrap justify-center gap-12 text-fg-muted text-small">
          {[
            ['keys.palette', 'Every action'],
            ['keys.help', 'Every key'],
            ['settings.open', 'Settings'],
          ].map(([id = '', label]) => (
            <span key={id} className="inline-flex items-center gap-6 whitespace-nowrap">
              <KeyFor id={id} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Recent pull requests, the page of the tab of that kind. */
export function RecentTab() {
  useKeys();
  const { rows, query, chosen } = useStore(recentStore);
  const accounts = useAccounts();
  const list = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const now = Date.now();

  // Asked afresh each time it's shown, since other tabs opened pull requests meanwhile.
  useEffect(() => {
    void loadRecent();
  }, []);

  // The list is the middle of the window, so `Esc` brings focus here, as does showing it when
  // focus was nowhere in particular.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) {
      list.current?.focus();
    }
    return setMiddle({ focus: () => list.current?.focus(), here: () => undefined });
  }, []);

  const any = rows !== undefined && rows.length > 0;
  useEffect(() => {
    setFilterField(any ? filter.current : null);
    return () => setFilterField(null);
  }, [any]);

  const shown = filterRecent(rows ?? [], query);
  const current = chosenRow(shown, chosen);
  const groups = groupRecent(shown, now);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-chrome">
      <header className="flex h-header-h flex-none items-center gap-12 px-16">
        <h1 className="m-0 text-title">Recent pull requests</h1>
        <span className="text-fg-muted text-small">
          {acrossAccounts((accounts ?? []).map(({ login }) => login))}
        </span>
        <span className="flex-1" />
        {any && (
          <>
            <div className="w-tab-w">
              <Input
                ref={filter}
                type="search"
                aria-label="Filter recent pull requests"
                placeholder="Filter by repo, number or title"
                value={query}
                onChange={(event) => recentStore.setState({ query: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void openRow();
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    list.current?.focus();
                  }
                }}
              />
            </div>
            <KeyFor id="open.filter" />
          </>
        )}
        <Button
          variant={any ? 'primary' : 'secondary'}
          onClick={() => registry().run('open.box', NO_TARGET)}
        >
          Review a pull request
          <KeyFor id="open.box" className={any ? 'text-on-accent' : undefined} />
        </Button>
      </header>
      <main className="relative min-h-0 flex-1 overflow-auto sheet">
        <div
          ref={list}
          // Focusable by the keyboard, as a listbox is, so focus that leaves for a dialog or a menu
          // comes back to the list itself, not to a button in it.
          tabIndex={0}
          role="listbox"
          aria-label="Recent pull requests"
          aria-activedescendant={current ? rowId(current) : undefined}
          data-lo-scope="recent"
          className="flex h-full flex-col px-16 pt-12 pb-32 focus-visible:shadow-none"
        >
          {rows === undefined ? null : !any ? (
            <FirstRun />
          ) : shown.length === 0 ? (
            <p className="m-0 p-32 text-center text-fg-muted text-ui">
              No recent pull request matches “{query}”.
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.label}
                role="group"
                aria-label={group.label}
                className="flex flex-col"
              >
                <div
                  className="px-12 pt-16 pb-6 text-small-medium text-fg-muted"
                  aria-hidden="true"
                >
                  {group.label}
                </div>
                {group.rows.map((row) => (
                  <Row key={rowKey(row)} row={row} chosen={row === current} now={now} />
                ))}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

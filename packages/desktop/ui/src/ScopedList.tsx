// A list Settings keeps per repo, as the overview's collapsed sections and ignored terms are: every
// repo's list, then each repo that has a list of its own, which replaces every repo's there. It goes
// inside a `SettingsList`'s box, a head row for each scope and its entries under it.

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { showFormat } from './controls.ts';
import { EmptyState } from './EmptyState.tsx';
import type { IconName } from './icons.ts';
import { SettingsListItem } from './Settings.tsx';
import { ShownText } from './ShownText.tsx';

/** What a list holds: an overview's section headings, or glossary terms. */
export type ScopedKind = 'heading' | 'term';

/** One entry of a scope's list: a heading, or a term. */
export interface ScopedEntry {
  /** What tells it from the rest of its scope's entries, and what the callbacks name. */
  key: string;
  /** The heading or the term, as it's written in the list. */
  label: string;
  /**
   * It's in every repo's list too, so a repo's entry has no "Collapse in every repo" or "Ignore in
   * every repo". Every repo's own entries don't read it.
   */
  everywhere?: boolean | undefined;
}

/** A repo with a list of its own, which replaces every repo's list there. */
export interface ScopedRepo {
  /** The repo, as GitHub writes it: `rozed-dev/e2e`. */
  repo: string;
  entries: readonly ScopedEntry[];
}

export interface ScopedListProps {
  kind: ScopedKind;
  /** Every repo's list, the setting's `*`. */
  every: readonly ScopedEntry[];
  /** Each repo with a list of its own, by name. */
  repos?: readonly ScopedRepo[] | undefined;
  /** "Remove" or "Stop ignoring" was pressed on an entry: of a repo's list, or every repo's. */
  onRemove?: ((key: string, repo: string | undefined) => void) | undefined;
  /** "Collapse in every repo" or "Ignore in every repo" was pressed on a repo's entry. */
  onEverywhere?: ((key: string, repo: string) => void) | undefined;
  /** "Reset" was pressed on a repo: its list goes, and every repo's applies there again. */
  onReset?: ((repo: string) => void) | undefined;
}

/** What each kind of list says, and its buttons' names for a screen reader, by the entry. */
interface Words {
  none: string;
  icon: IconName;
  everywhere: string;
  everywhereOf: (name: string) => string;
  remove: string;
  removeOf: (name: string) => string;
  label: string;
}

const WORDS: Readonly<Record<ScopedKind, Words>> = {
  heading: {
    none: 'No collapsed sections',
    icon: 'list-tree',
    everywhere: 'Collapse in every repo',
    everywhereOf: (name) => `Collapse ${name} in every repo`,
    remove: 'Remove',
    removeOf: (name) => `Remove ${name}`,
    label: 'Collapsed sections',
  },
  term: {
    none: 'No ignored terms',
    icon: 'book-a',
    everywhere: 'Ignore in every repo',
    everywhereOf: (name) => `Ignore ${name} in every repo`,
    remove: 'Stop ignoring',
    removeOf: (name) => `Stop ignoring ${name}`,
    label: 'Ignored terms',
  },
};

/** Every repo's scope, as the list's elements name it. */
const EVERY = '*';

/** What a press asked to go, and where focus goes once it has, if it was in what went. */
interface Leaving {
  /** Whether what was pressed has gone from the list. */
  gone: (list: HTMLElement) => boolean;
  /** Where focus goes then, the first of these that's there, else the list itself. */
  next: (list: HTMLElement) => readonly (HTMLElement | null | undefined)[];
}

/** The element of scope `scope` in `list`, by its name: `*` for every repo's. */
function scopeIn(list: HTMLElement, scope: string): HTMLElement | undefined {
  return [...list.querySelectorAll<HTMLElement>('[data-scope]')].find(
    (each) => each.dataset['scope'] === scope,
  );
}

/** The row of entry `key` in scope `scope` of `list`. */
function entryIn(list: HTMLElement, scope: string, key: string): HTMLElement | undefined {
  const holder = scopeIn(list, scope);
  if (holder === undefined) return undefined;
  return [...holder.querySelectorAll<HTMLElement>('[data-key]')].find(
    (each) => each.dataset['key'] === key,
  );
}

/** The first button of `element`, where focus goes in it. */
function buttonOf(element: HTMLElement | undefined): HTMLElement | null | undefined {
  return element?.querySelector<HTMLElement>('button');
}

/**
 * Scopes of a list kept per repo, each a head row (30 px, `text-small`, `lo-fg-muted`, a hairline
 * over each but the first) then its entries: "Every repo", then each repo as "rozed-dev/e2e ·
 * replaces every repo’s list" with "Reset" at its end. A press that takes away the button it was
 * on hands focus on, as `TrustList` does: to the next entry, else the one before, else the list.
 * Under 420 px of the list's own box, an entry's buttons go under its label.
 */
export function ScopedList({
  kind,
  every,
  repos = [],
  onRemove,
  onEverywhere,
  onReset,
}: ScopedListProps) {
  const words = WORDS[kind];
  const list = useRef<HTMLDivElement>(null);
  const leaving = useRef<Leaving | null>(null);
  // Once what was pressed is gone, as the caller shows it, focus that was in it is gone too.
  useLayoutEffect(() => {
    const pending = leaving.current;
    const root = list.current;
    if (pending === null || root === null || !pending.gone(root)) return;
    leaving.current = null;
    const active = root.ownerDocument.activeElement;
    // Focus that went somewhere else on its own is left where it went.
    if (active !== null && active !== root.ownerDocument.body) return;
    const target = pending.next(root).find((each) => each !== null && each !== undefined) ?? root;
    target.focus();
  });

  const entries = (scope: string, held: readonly ScopedEntry[]) => (
    <div role="list" aria-label={scope === EVERY ? 'Every repo' : scope}>
      {held.map((entry, at) => {
        const name = showFormat(entry.label);
        const remove = () => {
          const after = held[at + 1]?.key;
          const before = held[at - 1]?.key;
          leaving.current = {
            gone: (root) => entryIn(root, scope, entry.key) === undefined,
            next: (root) => [
              after === undefined ? undefined : buttonOf(entryIn(root, scope, after)),
              before === undefined ? undefined : buttonOf(entryIn(root, scope, before)),
              buttonOf(scopeIn(root, scope)),
            ],
          };
          onRemove?.(entry.key, scope === EVERY ? undefined : scope);
        };
        const everywhere = () => {
          leaving.current = {
            gone: (root) =>
              entryIn(root, scope, entry.key)?.querySelector('[data-everywhere]') == null,
            next: (root) => [
              buttonOf(entryIn(root, scope, entry.key)),
              buttonOf(scopeIn(root, scope)),
            ],
          };
          onEverywhere?.(entry.key, scope);
        };
        return (
          <SettingsListItem
            key={entry.key}
            stacks
            data={{ 'data-key': entry.key }}
            label={
              <span className="min-w-0 truncate text-fg">
                <ShownText text={entry.label} />
              </span>
            }
          >
            {scope !== EVERY && entry.everywhere !== true && (
              <Button
                variant="ghost"
                size="sm"
                data-everywhere=""
                aria-label={words.everywhereOf(name)}
                onClick={everywhere}
              >
                {words.everywhere}
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label={words.removeOf(name)} onClick={remove}>
              {words.remove}
            </Button>
          </SettingsListItem>
        );
      })}
    </div>
  );

  if (every.length === 0 && repos.length === 0) {
    return (
      <div
        ref={list}
        role="group"
        tabIndex={-1}
        aria-label={words.label}
        className="outline-none focus-visible:shadow-ring-inset"
      >
        <EmptyState fit="list" icon={words.icon} title={words.none} />
      </div>
    );
  }
  return (
    <div
      ref={list}
      role="group"
      tabIndex={-1}
      aria-label={words.label}
      className="scoped-list outline-none focus-visible:shadow-ring-inset"
    >
      <Scope scope={EVERY} head="Every repo">
        {every.length > 0 ? (
          entries(EVERY, every)
        ) : (
          <EmptyRow icon={words.icon} title="None in every repo" />
        )}
      </Scope>
      {repos.map(({ repo, entries: held }, at) => (
        <Scope
          key={repo}
          scope={repo}
          head={
            <>
              <ShownText text={repo} /> · replaces every repo’s list
            </>
          }
          reset={() => {
            const after = repos[at + 1]?.repo;
            const before = repos[at - 1]?.repo ?? EVERY;
            leaving.current = {
              gone: (root) => scopeIn(root, repo) === undefined,
              next: (root) => [
                after === undefined ? undefined : buttonOf(scopeIn(root, after)),
                buttonOf(scopeIn(root, before)),
              ],
            };
            onReset?.(repo);
          }}
          resetName={showFormat(repo)}
        >
          {held.length > 0 ? (
            entries(repo, held)
          ) : (
            <EmptyRow icon={words.icon} title="None in this repo" />
          )}
        </Scope>
      ))}
    </div>
  );
}

/** A scope's head row, then its entries. */
function Scope({
  scope,
  head,
  reset,
  resetName,
  children,
}: {
  scope: string;
  head: ReactNode;
  reset?: (() => void) | undefined;
  resetName?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} data-scope={scope}>
      <div className="flex scoped-head items-center gap-8 px-12 text-fg-muted text-small">
        <span id={id} className="min-w-0 flex-1 truncate">
          {head}
        </span>
        {reset !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={resetName === undefined ? 'Reset' : `Reset ${resetName}`}
            onClick={reset}
          >
            Reset
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

/** A scope with nothing in its list: one row that says so. */
function EmptyRow({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="flex min-h-row-h items-center px-12 py-8">
      <EmptyState fit="row" icon={icon} title={title} />
    </div>
  );
}

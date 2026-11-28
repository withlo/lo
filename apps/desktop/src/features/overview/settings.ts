// The overview's settings: whether there are overviews at all, which the window shows in Settings ›
// Pull requests before what a pull request's tab opens on, and main reads before it reads one;
// whether coding agents write one by themselves, which the overview skill's hook reads; which
// sections of an overview start collapsed, and which glossary terms the reader ignores, each kept
// per repo; and how Lo reads and writes such lists.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Whether there are overviews. On, as Lo starts, a pull request's tab has the Overview view, with
 * its mark and status item, the overview's notes in the diff and its marks in a stack; Lo reads
 * each pull request's overview, and offers the prompts that write one and the overview skill. Off,
 * none of it is anywhere, and nothing is read. On again, it all comes back.
 */
export const on = defineSetting('overview.on', z.boolean(), true, 'true or false', {
  group: 'pullRequests',
  label: 'Show overviews',
  named: 'whether overviews show',
  description: 'Overviews coding agents write, the prompts for them and the overview skill.',
});

/**
 * Whether coding agents write an overview by themselves, after they open a pull request or push to
 * one, as the overview skill's hook asks them to. Lo itself reads nothing of it: the hook reads the
 * file. It says what agents write, not what Lo shows, so its row stays while overviews are off.
 */
export const auto = defineSetting('overview.auto', z.boolean(), true, 'true or false', {
  group: 'pullRequests',
  label: 'Write overviews automatically',
  named: 'whether overviews are written automatically',
  description: 'Coding agents write one after opening or pushing to a pull request.',
});

// Lists kept per repo in the settings file, as the collapsed sections and the ignored terms are:
// every repo's list under `*`, and a repo's own under its name, which replaces every repo's there.
//
//   { "*": ["Testing"], "rozed-dev/e2e": ["Testing", "Rollout"] }
//
// Entries are matched as plain text, ignoring case and runs of spaces, and repos as GitHub names
// them, in any case. An entry Lo can't read is reported and ignored, and stays in the file: Lo
// changes only the lists it writes, and keeps the rest of the value as it is.

/** Every repo's list, as the setting names it. */
export const EVERY = '*';

/**
 * The setting's value as the file holds it: an object, each of whose lists Lo reads on its own
 * (`readScoped`), so one it can't read is reported and ignored while the rest still count.
 */
export const scopedValue = z.record(z.string(), z.json());
export type ScopedValue = z.output<typeof scopedValue>;

/** One of the value's lists, or an entry of one, as the file holds it. */
type Json = ScopedValue[string];

/** A list kept per repo, as Lo reads it. */
export interface Scoped {
  /** Every repo's list, each entry as it's written. */
  readonly every: readonly string[];
  /** Each repo with a list of its own, by its name as the file writes it, in the file's order. */
  readonly repos: readonly ScopedRepo[];
}

/** A repo's own list. */
export interface ScopedRepo {
  readonly repo: string;
  readonly entries: readonly string[];
}

/**
 * A repo's name as GitHub writes it, `owner/name`: an owner of letters, digits and single hyphens,
 * and a name of letters, digits, `.`, `-` and `_`, other than `.` and `..`.
 */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

/** The most an entry may run to: a heading's words, as the outline keeps them, or a term. */
export const ENTRY_MAX = 200;

/** The most of the entries Lo ignores that it names one by one. */
const NAMED = 5;

/** An entry as it's matched: plain text, in one case, its runs of spaces one space, trimmed. */
export function entryKey(entry: string): string {
  return entry.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** Whether `one` and `other` name the same repo, as GitHub compares them: in any case. */
export function sameRepo(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

/** An entry Lo reads: text, with something in it, of {@link ENTRY_MAX} characters at most. */
function readable(entry: unknown): entry is string {
  return typeof entry === 'string' && entry.trim() !== '' && entry.length <= ENTRY_MAX;
}

/** Why Lo can't read `entry`, in words. */
function whyNot(entry: unknown): string {
  if (typeof entry !== 'string') return 'isn’t text';
  return entry.trim() === '' ? 'is empty' : `is longer than ${ENTRY_MAX} characters`;
}

/**
 * The lists `value` holds, as Lo reads them, and what it says of what it ignores, each in words
 * for the person editing the file: a key that's neither `*` nor a repo, a list that isn't one, and
 * an entry that isn't text. `key` is the setting's, which the words name.
 */
export function readScoped(
  value: ScopedValue,
  key: string,
): { scoped: Scoped; problems: string[] } {
  const ignored: string[] = [];
  let every: string[] = [];
  const repos: ScopedRepo[] = [];
  for (const [scope, list] of Object.entries(value)) {
    // The key as the file writes it, for the person editing it.
    const named = `“${scope.slice(0, 140)}”`;
    if (scope !== EVERY && !REPO.test(scope)) {
      ignored.push(`${key} has ${named}, which isn’t a repo, so Lo ignores it.`);
      continue;
    }
    if (!Array.isArray(list)) {
      ignored.push(`${key}’s ${named} isn’t a list, so Lo ignores it.`);
      continue;
    }
    const entries: string[] = [];
    for (const [at, entry] of list.entries()) {
      if (readable(entry)) entries.push(entry);
      else
        ignored.push(`${key}’s entry ${at + 1} under ${named} ${whyNot(entry)}, so Lo ignores it.`);
    }
    if (scope === EVERY) every = entries;
    else if (!repos.some((each) => sameRepo(each.repo, scope)))
      repos.push({ repo: scope, entries });
  }
  const problems = ignored.slice(0, NAMED);
  if (ignored.length > NAMED) {
    const more = ignored.length - NAMED;
    problems.push(`${key} has ${more} more ${more === 1 ? 'entry' : 'entries'} Lo ignores.`);
  }
  return { scoped: { every, repos }, problems };
}

/** Whether `entries` holds `entry`, matched as plain text. */
export function holds(entries: readonly string[], entry: string): boolean {
  const key = entryKey(entry);
  return entries.some((each) => entryKey(each) === key);
}

/** `repo`'s own list in `scoped`, if it has one. */
export function ownList(scoped: Scoped, repo: string): ScopedRepo | undefined {
  return scoped.repos.find((each) => sameRepo(each.repo, repo));
}

/** The list that applies in `repo`: its own, else every repo's. */
export function listIn(scoped: Scoped, repo: string): readonly string[] {
  return ownList(scoped, repo)?.entries ?? scoped.every;
}

/** Whether `entry` is in the list that applies in `repo`: "In this repo" is on. */
export function inRepo(scoped: Scoped, repo: string, entry: string): boolean {
  return holds(listIn(scoped, repo), entry);
}

/**
 * Whether `entry` is in every repo's list and in each repo's own: "In every repo" is on, and it
 * applies wherever the reader reads.
 */
export function everywhere(scoped: Scoped, entry: string): boolean {
  return holds(scoped.every, entry) && scoped.repos.every((each) => holds(each.entries, entry));
}

/** The key of `repo`'s own list in `value`, as the file spells it, if it has one. */
function keyOf(value: ScopedValue, repo: string): string | undefined {
  return Object.keys(value).find((scope) => scope !== EVERY && sameRepo(scope, repo));
}

/**
 * `list`, a list the file holds, with `entry` in it or out of it, and none of `also`, the other
 * names of what it names, such as a term's aliases, in it either way: it's listed once, by
 * `entry`. What Lo can't read stays.
 */
function changed(list: readonly Json[], entry: string, listed: boolean, also: readonly string[]) {
  const keys = new Set([entry, ...also].map(entryKey));
  const without = list.filter((each) => !readable(each) || !keys.has(entryKey(each)));
  return listed ? [...without, entry.trim()] : without;
}

/** The list `value` holds under `scope`, or none where it holds none, or no list. */
function listOf(value: ScopedValue, scope: string): Json[] | undefined {
  const list = value[scope];
  return Array.isArray(list) ? list : undefined;
}

/** Whether two lists the file holds have the same entries, as Lo reads and matches them. */
function sameEntries(one: readonly Json[], other: readonly Json[]): boolean {
  const keys = (list: readonly Json[]) =>
    new Set(list.flatMap((each) => (readable(each) ? [entryKey(each)] : [])));
  const a = keys(one);
  const b = keys(other);
  return a.size === b.size && [...a].every((each) => b.has(each));
}

/** `value` with every repo's list set to `list`, first, as the file reads best. */
function withEvery(value: ScopedValue, list: Json[]): ScopedValue {
  const rest = Object.fromEntries(Object.entries(value).filter(([scope]) => scope !== EVERY));
  return { [EVERY]: list, ...rest };
}

/**
 * `value` with `entry` in or out of the list that applies in `repo`, as "In this repo" writes it:
 * the repo's list with the change becomes its own, starting from every repo's where it has none,
 * and one that ends up the same as every repo's goes, since every repo's applies there then.
 * `also` are the entry's other names, which go from the list too: see {@link changed}.
 */
export function setInRepo(
  value: ScopedValue,
  repo: string,
  entry: string,
  listed: boolean,
  also: readonly string[] = [],
): ScopedValue {
  const key = keyOf(value, repo);
  const every = listOf(value, EVERY) ?? [];
  const from = (key === undefined ? undefined : listOf(value, key)) ?? every;
  const list = changed(from, entry, listed, also);
  const next = { ...value };
  if (sameEntries(list, every)) {
    if (key !== undefined) delete next[key];
    return next;
  }
  next[key ?? repo] = list;
  return next;
}

/**
 * `value` with `entry` in or out of every list, as "In every repo" writes it: on, it's added to
 * every repo's list and to each repo's own; off, it's taken out of all of them. `also` are the
 * entry's other names, which go from every list too: see {@link changed}.
 */
export function setEverywhere(
  value: ScopedValue,
  entry: string,
  listed: boolean,
  also: readonly string[] = [],
): ScopedValue {
  const next: ScopedValue = {};
  for (const [scope, list] of Object.entries(value)) {
    next[scope] =
      scope !== EVERY && Array.isArray(list) ? changed(list, entry, listed, also) : list;
  }
  return withEvery(next, changed(listOf(value, EVERY) ?? [], entry, listed, also));
}

/** `value` with `entry` added to every repo's list, as Settings adds one. */
export function addToEvery(value: ScopedValue, entry: string): ScopedValue {
  return withEvery(value, changed(listOf(value, EVERY) ?? [], entry, true, []));
}

/**
 * `value` with `entry` taken out of one list: every repo's, or a repo's own, which then goes where
 * it's the same as every repo's.
 */
export function removeFrom(
  value: ScopedValue,
  repo: string | undefined,
  entry: string,
): ScopedValue {
  if (repo !== undefined) return setInRepo(value, repo, entry, false);
  return withEvery(value, changed(listOf(value, EVERY) ?? [], entry, false, []));
}

/** `value` without `repo`'s own list: every repo's applies there again. */
export function resetRepo(value: ScopedValue, repo: string): ScopedValue {
  const key = keyOf(value, repo);
  if (key === undefined) return value;
  const next = { ...value };
  delete next[key];
  return next;
}

/**
 * The sections of an overview that start collapsed, by heading, kept per repo: every repo's under
 * `*`, and a repo's own under its name, which replaces every repo's there. A heading matches as
 * plain text, ignoring case and runs of spaces, and the tl;dr never collapses. An entry Lo can't
 * read is reported and ignored.
 */
export const collapsed = defineSetting(
  'overview.collapsed',
  scopedValue,
  {},
  'lists of headings, by repo or "*"',
  {
    group: 'pullRequests',
    label: 'Collapsed sections',
    description: 'Overview sections that start collapsed, by heading. The tl;dr always shows.',
    problems: (value) => readScoped(value, 'overview.collapsed').problems,
  },
);

/**
 * The glossary terms the reader ignores, by term, kept per repo as the collapsed sections are. A
 * term ignored is plain text in every overview of the repo, with no underline, card or stop for
 * `Tab`, and its row waits in the Glossary section's Ignored group. An entry matches a term by its
 * name or any of its aliases, as plain text, ignoring case and runs of spaces. An entry Lo can't
 * read is reported and ignored.
 */
export const ignored = defineSetting(
  'overview.ignored',
  scopedValue,
  {},
  'lists of terms, by repo or "*"',
  {
    group: 'pullRequests',
    label: 'Ignored terms',
    description: 'Glossary terms that show as plain text, without their definitions.',
    problems: (value) => readScoped(value, 'overview.ignored').problems,
  },
);

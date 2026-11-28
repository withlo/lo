// Which definition an overview shows for each term: the repository's, from its definitions, for
// every term they hold that the overview doesn't mark, in every overview, old ones too; the
// overview's own for a term it marks new or changed, which its review reviews; and the overview's
// own for every term while the repository has none, or Lo can't read them. Only the overview's
// marks tag a term: an unmarked one is never new or changed, whatever the repository holds. While
// the pull request is open, a marked term's tag follows the repository's definitions as they are
// now. A plain function of the overview, the definitions and the pull request, tested alone; the
// views draw what it says.

import type { Account, Definition, GlossaryEntry, Origin, OverviewBlock } from '@lo/artifact';

import type { PullState } from '../../tab/contract.ts';
import type { StoredTerm } from '../jobs.ts';
import { storedTerm, type RepoTerms } from './terms.ts';

/** Who wrote a definition, where it came from, and when, as the repository's definitions say. */
export interface TermByline {
  written: StoredTerm['written'];
  by: Account;
  from: Origin;
  /** When, as an RFC 3339 time in UTC. */
  at: string;
}

/** A definition a term had before the one shown, with its byline. */
export interface Before extends TermByline {
  definition: string;
  blocks: OverviewBlock[];
}

/**
 * What an overview shows for a term:
 *
 * - `key`: the key the overview names it by;
 * - `name`: its name as the overview's glossary writes it, else as the repository's definitions do;
 * - `source`: whose definition shows: the repository's current one (`store`), or the overview's own
 *   (`overview`);
 * - `blocks`: the definition that shows, to draw;
 * - `tag`: whether the pull request adds the term (`new`) or changes it (`changed`), for a term
 *   the overview marks: an unmarked term has none. On an open or draft pull request, and a stack's
 *   overview, it follows the repository's definitions as they are now: a marked term they don't
 *   hold is new, one they hold otherwise is changed, and one they hold with the same definition,
 *   which the pull request then changes nothing in, has none, so theirs shows. Merged or closed,
 *   or without definitions Lo can read, it's as the overview marks it, since the merge is what
 *   took it;
 * - `before`: for a changed term, the definition it replaces, when Lo knows it: the repository's
 *   current one, or for a merged pull request, the one its merge replaced, from the term's earlier
 *   definitions;
 * - `stored`: the repository's entry for it, when they hold it, under its name or an alias: who
 *   wrote it, whether it's locked, its suggestions and earlier definitions;
 * - `byline`: who wrote the repository's current definition of it, where what shows for the term
 *   holds that definition: as the definition that shows, as the one a changed term replaces on a
 *   pull request that didn't merge, or as the one a merged pull request's merge brought, while
 *   it's still the current one. None where it would name who wrote a definition nothing shows;
 * - `own`: the overview's own entry, when its glossary defines it.
 */
export interface ShownTerm {
  key: string;
  name: string;
  source: 'store' | 'overview';
  blocks: OverviewBlock[];
  tag: 'new' | 'changed' | undefined;
  before: Before | undefined;
  stored: StoredTerm | undefined;
  byline: TermByline | undefined;
  own: Definition | undefined;
}

/**
 * The definitions an overview shows:
 *
 * - `of`: what it shows for the term `key` names, a term in its text or its glossary, or nothing
 *   when neither the overview nor the repository's definitions define it, so it's plain text;
 * - `marked`: the terms of its glossary it adds or changes, by name, and `rest`, the others, by
 *   name, as its Glossary section lists them;
 * - `added`, `changed`: how many it adds and changes, for the line at its top;
 * - `terms`: the repository's definitions, as far as the window knows: when they aren't `read`,
 *   every definition shown is the overview's own, and this says why.
 */
export interface Definitions {
  of(key: string): ShownTerm | undefined;
  marked: ShownTerm[];
  rest: ShownTerm[];
  added: number;
  changed: number;
  terms: RepoTerms;
}

/**
 * What an overview is of, for its terms' tags: a pull request, by its number and state, or a
 * stack, whose overview follows the repository's definitions as they are now.
 */
export type Subject = { kind: 'pull'; number: number; state: PullState } | { kind: 'stack' };

/**
 * The definitions an overview shows: its glossary's items, `glossary`, as its tree holds them, with
 * `entries`, the same as written, which the repository's definitions are compared with; the
 * repository's definitions, `terms`; and what the overview is of, `subject`.
 */
export function definitionsOf(
  glossary: readonly Definition[],
  entries: readonly GlossaryEntry[],
  terms: RepoTerms,
  subject: Subject,
): Definitions {
  const store = terms.kind === 'read' ? terms.terms : undefined;
  // A mark is moot only while the pull request can still change the definitions.
  const live = subject.kind === 'stack' || isOpen(subject.state);
  const written = new Map<string, GlossaryEntry>();
  for (const entry of entries) if (!written.has(entry.key)) written.set(entry.key, entry);

  const shown = new Map<string, ShownTerm>();
  for (const own of glossary) {
    if (shown.has(own.key)) continue;
    const stored = store && storedTerm(store, own.key);
    const entry = written.get(own.key);
    const tag = live && store ? tagNow(own.mark, entry, stored) : own.mark;
    const theirs = tag === undefined && stored !== undefined;
    shown.set(own.key, {
      key: own.key,
      name: own.name,
      source: theirs ? 'store' : 'overview',
      blocks: theirs ? stored.blocks : own.children,
      tag,
      before: tag === 'changed' && stored ? beforeOf(stored, subject) : undefined,
      stored,
      byline: stored && (theirs || current(stored, tag, subject)) ? bylineOf(stored) : undefined,
      own,
    });
  }

  const marked: ShownTerm[] = [];
  const rest: ShownTerm[] = [];
  for (const term of shown.values()) (term.tag === undefined ? rest : marked).push(term);
  const byName = (a: ShownTerm, b: ShownTerm) => COLLATOR.compare(a.name, b.name);
  marked.sort(byName);
  rest.sort(byName);

  return {
    of(key) {
      const own = shown.get(key);
      if (own) return own;
      // A term the text links that only the repository's definitions hold.
      const stored = store && storedTerm(store, key);
      if (!stored) return undefined;
      return {
        key,
        name: stored.term,
        source: 'store',
        blocks: stored.blocks,
        tag: undefined,
        before: undefined,
        stored,
        byline: bylineOf(stored),
        own: undefined,
      };
    },
    marked,
    rest,
    added: counted(marked, 'new'),
    changed: counted(marked, 'changed'),
    terms,
  };
}

/**
 * How many terms of `marked` are tagged `tag`: two entries the repository's definitions hold as
 * one term, under its name and an alias, count once.
 */
function counted(marked: readonly ShownTerm[], tag: ShownTerm['tag']): number {
  const terms = new Set<string>();
  for (const term of marked) {
    if (term.tag === tag) terms.add(term.stored ? `stored ${term.stored.key}` : `own ${term.key}`);
  }
  return terms.size;
}

/** The items of an overview's glossary, in the order written: its `## Glossary` section's. */
export function glossaryOf(blocks: readonly OverviewBlock[]): Definition[] {
  return blocks.flatMap((block) => (block.kind === 'glossary' ? block.terms : []));
}

/** The order of a glossary's terms, by name: the overview's glossary's own. */
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function isOpen(state: PullState): boolean {
  switch (state) {
    case 'open':
    case 'draft':
      return true;
    case 'merged':
    case 'closed':
      return false;
    default:
      state satisfies never;
      return false;
  }
}

/**
 * The tag of a term the overview marks `mark`, written as `entry`, on an open pull request, as the
 * repository's definitions hold it now, `stored`: new where they don't hold it, none where they
 * hold the definition the overview gives it, which makes the mark moot, and changed otherwise.
 */
function tagNow(
  mark: Definition['mark'],
  entry: GlossaryEntry | undefined,
  stored: StoredTerm | undefined,
): ShownTerm['tag'] {
  if (mark === undefined) return undefined;
  if (stored === undefined) return 'new';
  return moot(entry, stored) ? undefined : 'changed';
}

/**
 * Whether what shows for a term the overview tags `tag`, and doesn't show the repository's
 * definition of, still holds their current one, `stored`'s: as the definition a changed term
 * replaces, unless the pull request merged, or as the one a merged pull request's merge brought,
 * which nothing has changed since.
 */
function current(stored: StoredTerm, tag: ShownTerm['tag'], subject: Subject): boolean {
  if (subject.kind === 'stack' || subject.state !== 'merged') return tag === 'changed';
  return stored.from === subject.number;
}

/** Who wrote the repository's current definition of a term, where from, and when. */
function bylineOf(stored: StoredTerm): TermByline {
  const { written, by, from, at } = stored;
  return { written, by, from, at };
}

/**
 * Whether the repository's definitions, as they are now, make a glossary entry's mark moot: they
 * hold its term with the definition the overview gives it.
 */
function moot(entry: GlossaryEntry | undefined, stored: StoredTerm | undefined): boolean {
  const definition = entry?.definition;
  return (
    stored !== undefined &&
    definition !== undefined &&
    sameDefinition(definition, stored.definition)
  );
}

/**
 * The definition a changed term replaces: for a merged pull request, the one its merge replaced,
 * the earlier definition after the one it brought, or none when the term's earlier definitions no
 * longer list it, as when the term was locked and the change became a suggestion; otherwise the
 * repository's current one.
 */
function beforeOf(stored: StoredTerm, subject: Subject): Before | undefined {
  if (subject.kind === 'stack' || subject.state !== 'merged') return drawn(stored);
  const { number } = subject;
  if (stored.from === number) return drawn(stored.changes[0]);
  const at = stored.changes.findIndex(({ from }) => from === number);
  return at === -1 ? undefined : drawn(stored.changes[at + 1]);
}

function drawn(
  definition: (TermByline & { definition: string; blocks: OverviewBlock[] }) | undefined,
): Before | undefined {
  if (!definition) return undefined;
  const { written, by, from, at, blocks } = definition;
  return { definition: definition.definition, blocks, written, by, from, at };
}

/**
 * Whether two definitions, as written, are the same, but for the runs of spaces in them, as the
 * overview's checker compares a glossary's with the repository's.
 */
export function sameDefinition(a: string, b: string): boolean {
  return squeezed(a) === squeezed(b);
}

function squeezed(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim();
}

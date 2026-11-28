/**
 * Changes to the repository's definitions, the store, each made as a new store: a term added, a
 * term's definition replaced, with the one it had kept first among its changes, and a change
 * suggested for a locked term. And the store written as `terms.json`, as {@link parseStore} reads
 * it back. The workflow makes these changes when a pull request merges; nothing changes a store in
 * place.
 */

import { utf8Length } from './source.ts';
import {
  STORE_LIMITS,
  type Account,
  type Change,
  type Origin,
  type Store,
  type StoreTerm,
  type Suggestion,
  type Written,
} from './store.ts';
import { termKey } from './targets.ts';

/** A definition as a term holds it: its text, and who wrote it, where it came from and when. */
export interface Definition {
  definition: string;
  written: Written;
  by: Account;
  from: Origin;
  at: string;
}

/** A store with no terms, as a repository's first one starts. */
export function emptyStore(): Store {
  return { format: 1, terms: new Map(), names: new Map() };
}

/**
 * Whether two definitions, as written, are the same, but for the runs of spaces in them: a
 * glossary's entry and the store's, say.
 */
export function sameDefinition(a: string, b: string): boolean {
  return squeezed(a) === squeezed(b);
}

/** `text` with each run of spaces as one, and none at either end. */
function squeezed(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim();
}

/**
 * `store` with `term`, as written, added, defined as `given`, with no aliases. Throws when a term
 * already goes by its name, its own or an alias's.
 */
export function withTerm(store: Store, term: string, given: Definition): Store {
  const key = termKey(term);
  if (store.names.has(key)) throw new Error(`The store has a term named ${JSON.stringify(key)}.`);
  const terms = new Map(store.terms);
  terms.set(key, { key, term, ...definitionOf(given), aliases: [], suggestions: [], changes: [] });
  const names = new Map(store.names);
  names.set(key, key);
  return { format: store.format, terms, names };
}

/**
 * `store` with the term `key` defined as `next`, and the definition it had first among its
 * changes, of which it keeps the newest {@link STORE_LIMITS.changes}. Throws when there's no such
 * term.
 */
export function withDefinition(store: Store, key: string, next: Definition): Store {
  const current = termOf(store, key);
  const previous: Change = definitionOf(current);
  const terms = new Map(store.terms);
  terms.set(key, {
    ...current,
    ...definitionOf(next),
    changes: [previous, ...current.changes].slice(0, STORE_LIMITS.changes),
  });
  return { ...store, terms };
}

/**
 * `store` with `suggestion` first among the suggestions of the locked term `key`, of which it keeps
 * the newest {@link STORE_LIMITS.suggestions}. Throws when there's no such term, or it isn't locked.
 */
export function withSuggestion(store: Store, key: string, suggestion: Suggestion): Store {
  const current = termOf(store, key);
  if (!current.locked) throw new Error(`${JSON.stringify(key)} isn't locked.`);
  const terms = new Map(store.terms);
  terms.set(key, {
    ...current,
    suggestions: [
      {
        definition: suggestion.definition,
        by: suggestion.by,
        from: suggestion.from,
        at: suggestion.at,
      },
      ...current.suggestions,
    ].slice(0, STORE_LIMITS.suggestions),
  });
  return { ...store, terms };
}

function termOf(store: Store, key: string): StoreTerm {
  const term = store.terms.get(key);
  if (!term) throw new Error(`The store has no term ${JSON.stringify(key)}.`);
  return term;
}

/** Only the fields of a definition, from anything holding one. */
function definitionOf({ definition, written, by, from, at }: Definition): Definition {
  return { definition, written, by, from, at };
}

/**
 * `store` as `terms.json`: its terms in the order of their keys, each with its fields in the
 * format's order, aliases, suggestions and changes left out when there are none, and at most
 * `changes` of each term's changes, the newest. Two spaces indent it, and a line break ends it.
 */
export function storeText(store: Store, changes: number = STORE_LIMITS.changes): string {
  // No prototype, so a term keyed `__proto__` is a key like any other.
  const terms: Record<string, unknown> = Object.create(null);
  for (const key of [...store.terms.keys()].toSorted()) {
    terms[key] = termJson(store.terms.get(key)!, changes);
  }
  return `${JSON.stringify({ format: store.format, terms }, null, 2)}\n`;
}

/**
 * `store` as {@link storeText} writes it, within the store's size: with every change each term
 * keeps, or, when that's too large, fewer of each term's changes, the newest, as few as none.
 * Older ones are in the ref's history. Undefined when even none is too large.
 */
export function fittedStoreText(store: Store): string | undefined {
  for (let changes: number = STORE_LIMITS.changes; ; changes = Math.floor(changes / 2)) {
    const text = storeText(store, changes);
    if (utf8Length(text, STORE_LIMITS.size + 1) <= STORE_LIMITS.size) return text;
    if (changes === 0) return undefined;
  }
}

function termJson(term: StoreTerm, changes: number): Record<string, unknown> {
  return {
    term: term.term,
    definition: term.definition,
    ...(term.aliases.length > 0 ? { aliases: term.aliases } : {}),
    written: term.written,
    by: accountJson(term.by),
    from: originJson(term.from),
    at: term.at,
    ...(term.locked ? { locked: { by: accountJson(term.locked.by), at: term.locked.at } } : {}),
    // Only a locked term holds suggestions.
    ...(term.locked && term.suggestions.length > 0
      ? {
          suggestions: term.suggestions.map((each) => ({
            definition: each.definition,
            by: accountJson(each.by),
            from: originJson(each.from),
            at: each.at,
          })),
        }
      : {}),
    ...(changes > 0 && term.changes.length > 0
      ? {
          changes: term.changes.slice(0, changes).map((each) => ({
            definition: each.definition,
            written: each.written,
            by: accountJson(each.by),
            from: originJson(each.from),
            at: each.at,
          })),
        }
      : {}),
  };
}

function accountJson(account: Account): Account {
  return 'login' in account ? { login: account.login } : { name: account.name };
}

/** `#` and a pull request's number, or `lo`. */
function originJson(from: Origin): string {
  return from === 'lo' ? 'lo' : `#${from}`;
}

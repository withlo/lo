/**
 * Changes to the repository's definitions, the store, each made as a new store: a term added, a
 * term's definition replaced, with the one it had kept first among its changes, a change suggested
 * for a locked term, and a person's edit of a term in Lo. And the store written as `terms.json`, as
 * {@link parseStore} reads it back. The workflow makes the first three when a pull request merges,
 * and Lo the last; nothing changes a store in place.
 */

import { utf8Length } from './source.ts';
import {
  parseStore,
  STORE_LIMITS,
  type Account,
  type Change,
  type Origin,
  type Store,
  type StoreTerm,
  type Suggestion,
} from './store.ts';
import { termKey } from './targets.ts';

/**
 * A definition as a term holds it: its text, and who wrote it, where it came from and when, as a
 * {@link Change}, one it had before, holds it too.
 */
export type StoreDefinition = Change;

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
export function withTerm(store: Store, term: string, given: StoreDefinition): Store {
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
export function withDefinition(store: Store, key: string, next: StoreDefinition): Store {
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
 * the newest {@link STORE_LIMITS.suggestions}. Throws when there's no such term, or it isn't
 * locked.
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

/**
 * A person's edit of a term, in Lo: its definition and the other forms that name it, by the account
 * signed in, at a time. It's human-written, from `lo`, and the definition it replaces goes first
 * among the term's changes. A locked term takes it too: a lock only turns merged pull requests'
 * changes into suggestions.
 */
export interface TermEdit {
  /** The term as written, which an edit never renames: what adds it back if it was deleted. */
  term: string;
  /** Its definition, one paragraph. Its spaces at either end go. */
  definition: string;
  /**
   * The other forms that name it, each as written: those with nothing but spaces, and those that
   * name the term itself or another form before them, go.
   */
  aliases: readonly string[];
  by: Account;
  /** When, as an RFC 3339 time in UTC: `2026-11-27T10:30:00Z`. */
  at: string;
}

/**
 * The term as an edit started from it, which says whether it changed since: its definition and the
 * forms that name it; or none, for a term the store didn't hold, as one deleted elsewhere is.
 */
export type EditBase = { definition: string; aliases: readonly string[] } | null;

/**
 * What an edit of a term came to: `edited`, the store with it; `same`, where the store holds it
 * already, so nothing changes; `changed`, where the term isn't as the edit started from it (another
 * definition, other forms, or deleted, `undefined`, or there again), with what it is now; or
 * `refused`, where the store can't hold it, in a sentence: a form that names another term, too
 * many, or a definition its rules refuse.
 */
export type EditResult =
  | { kind: 'edited'; store: Store }
  | { kind: 'same' }
  | { kind: 'changed'; term: StoreTerm | undefined }
  | { kind: 'refused'; message: string };

/**
 * `store` with `edit` of the term `key`, a term's key, made: where the term is as `base` says it
 * was as the edit started, else what it is now. A term deleted since the edit started is added back
 * only from a base of none, as "Save mine" asks once Lo has said it was. A term that holds the edit
 * already, however it came to, changes nothing.
 */
export function editTerm(store: Store, key: string, base: EditBase, edit: TermEdit): EditResult {
  const current = store.terms.get(key);
  const text = edit.definition.trim();
  const aliases = aliasesOf(edit.term, edit.aliases);
  if (current && sameDefinition(current.definition, text) && sameNames(current.aliases, aliases)) {
    return { kind: 'same' };
  }
  if (base === null ? current !== undefined : !current || !isAsBase(current, base)) {
    return { kind: 'changed', term: current };
  }
  const refusal = editRefusal(store, key, edit.term, aliases, current === undefined);
  if (refusal !== undefined) return { kind: 'refused', message: refusal };
  const given: StoreDefinition = {
    definition: text,
    written: 'human',
    by: edit.by,
    from: 'lo',
    at: edit.at,
  };
  const defined = current ? withDefinition(store, key, given) : withTerm(store, edit.term, given);
  const next = withAliases(defined, key, aliases);
  // The store's own rules, on the term alone: its definition, its forms, who and when.
  const alone: Store = {
    format: 1,
    terms: new Map([[key, next.terms.get(key)!]]),
    names: new Map([[key, key]]),
  };
  const read = parseStore(storeText(alone));
  if (!read.ok) return { kind: 'refused', message: read.problem.message };
  return { kind: 'edited', store: next };
}

/**
 * Why `store` can't take the term `key`, named `term`, named by `aliases` too, in a sentence: too
 * many forms, a form another term goes by, and for one it adds (`adds`), a store that's full or a
 * name another term goes by.
 */
function editRefusal(
  store: Store,
  key: string,
  term: string,
  aliases: readonly string[],
  adds: boolean,
): string | undefined {
  if (aliases.length > STORE_LIMITS.aliases) {
    return `A term has at most ${STORE_LIMITS.aliases} other forms, and this has ${aliases.length}.`;
  }
  for (const alias of aliases) {
    const owner = store.names.get(termKey(alias));
    if (owner !== undefined && owner !== key) {
      return `${JSON.stringify(alias)} names ${JSON.stringify(owner)}, another term.`;
    }
  }
  if (!adds) return undefined;
  if (termKey(term) !== key)
    return `${JSON.stringify(term)} isn't the term ${JSON.stringify(key)}.`;
  const owner = store.names.get(key);
  if (owner !== undefined)
    return `${JSON.stringify(term)} names ${JSON.stringify(owner)}, another term.`;
  if (store.terms.size >= STORE_LIMITS.terms) {
    return `The store holds ${STORE_LIMITS.terms.toLocaleString('en-US')} terms, the most it may.`;
  }
  return undefined;
}

/** Whether `term` is as `base` says it was: the same definition, and the same forms. */
function isAsBase(term: StoreTerm, base: NonNullable<EditBase>): boolean {
  return (
    sameDefinition(term.definition, base.definition) &&
    sameNames(term.aliases, aliasesOf(term.term, base.aliases))
  );
}

/** The keys `names` go by, each once, in order. */
function keysOf(names: readonly string[]): string[] {
  return [...new Set(names.map(termKey))].toSorted();
}

/** Whether two lists of forms name the same, whatever their order, case and runs of spaces. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const [one, two] = [keysOf(a), keysOf(b)];
  return one.length === two.length && one.every((name, index) => name === two[index]);
}

/**
 * `aliases` of `term` as an edit leaves them: each without spaces at either end, and none that's
 * empty, names the term or names what one before it does.
 */
export function aliasesOf(term: string, aliases: readonly string[]): string[] {
  const seen = new Set([termKey(term)]);
  const kept: string[] = [];
  for (const each of aliases) {
    const alias = each.trim();
    const key = termKey(alias);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(alias);
  }
  return kept;
}

/** `store` with the term `key` named by `aliases` besides its own name, and by nothing else. */
function withAliases(store: Store, key: string, aliases: readonly string[]): Store {
  const current = termOf(store, key);
  const names = new Map(store.names);
  for (const alias of current.aliases) {
    if (names.get(termKey(alias)) === key) names.delete(termKey(alias));
  }
  for (const alias of aliases) names.set(termKey(alias), key);
  names.set(key, key);
  const terms = new Map(store.terms);
  terms.set(key, { ...current, aliases: [...aliases] });
  return { ...store, terms, names };
}

/** Only the fields of a definition, from anything holding one. */
function definitionOf({ definition, written, by, from, at }: StoreDefinition): StoreDefinition {
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

/**
 * The repository's definitions: the store, `terms.json` in the commit at `refs/lo/terms` in a pull
 * request's base repository. It holds the terms the repository's overviews define, each with its
 * current definition, who wrote it and its last changes. The workflow adds a merged pull request's
 * New and Changed terms, and people with push access edit them in Lo; writers only read it.
 *
 * Anyone who can push to the repository can write it, and the checker may read one from anywhere,
 * so it's read under limits: its size is checked before its text is read, reading it takes time in
 * proportion to its size, and it's refused whole at the first thing wrong, never read in part.
 */

import { isPlainTerm, notDefinitionText } from './definitions.ts';
import { quote, UNSAFE } from './findings.ts';
import { LIMITS } from './limits.ts';
import { utf8Length } from './source.ts';
import { readTerm, termKey } from './targets.ts';

/** The ref the store is on, in a pull request's base repository. */
export const STORE_REF = 'refs/lo/terms';

/** The store's file, the one file its commit holds. */
export const STORE_FILE = 'terms.json';

/** The newest format of the store this package reads. */
export const STORE_FORMAT: number = 1;

export const STORE_LIMITS = Object.freeze({
  /** The most bytes of UTF-8 in `terms.json`, a byte-order mark aside. */
  size: 2 * 1024 * 1024,
  /** The most terms. */
  terms: 5_000,
  /** The most aliases one term has. */
  aliases: 20,
  /** The most of a term's earlier definitions it keeps, newest first. */
  changes: 50,
  /** The most suggestions a locked term holds, newest first. */
  suggestions: 50,
  /** The most bytes of UTF-8 in a definition. */
  definition: 2_048,
  /** The most bytes of UTF-8 in a git name, for a writer GitHub couldn't name. */
  name: 256,
});

/** The store, read. */
export interface Store {
  /** The format it's written in. */
  format: number;
  /** Each term, by its key: its name in lower case, as `term:` links name it ({@link termKey}). */
  terms: ReadonlyMap<string, StoreTerm>;
  /** Each name a term goes by, its own and its aliases', as keys, to the key of its term. */
  names: ReadonlyMap<string, string>;
}

/** A term in the store, and its definition. */
export interface StoreTerm {
  /** What it's keyed by: {@link termKey} of `term`. */
  key: string;
  /** The term as written: "Bucket". */
  term: string;
  /**
   * Its definition: one or two sentences of Markdown, on one line, holding text, inline code,
   * links into the code and links to other terms.
   */
  definition: string;
  /** Other forms that name it, such as "buckets", each as written. */
  aliases: string[];
  /** Whether an agent wrote the definition, in an overview, or a person, in Lo. */
  written: Written;
  /** Who wrote it. */
  by: Account;
  /** Where it came from: the pull request whose overview it was in, or `lo`, edited in Lo. */
  from: Origin;
  /** When, as an RFC 3339 time in UTC: `2026-11-27T10:30:00Z`. */
  at: string;
  /** Who locked it, and when, if it's locked: a merged pull request then only suggests a change. */
  locked?: Lock;
  /** For a locked term, the changes merged pull requests proposed, newest first. */
  suggestions: Suggestion[];
  /** Its earlier definitions, newest first: the last {@link STORE_LIMITS.changes}. */
  changes: Change[];
}

export type Written = 'agent' | 'human';

/**
 * A writer: a GitHub account by its login, or, for a commit whose email GitHub can't map to an
 * account, the commit's git name, which isn't verified.
 */
export type Account = { login: string } | { name: string };

/** A pull request's number, or `lo`. */
export type Origin = number | 'lo';

export interface Lock {
  by: Account;
  at: string;
}

/** A change a merged pull request proposed to a locked term. */
export interface Suggestion {
  definition: string;
  by: Account;
  /** The pull request. */
  from: number;
  at: string;
}

/** A definition a term had before. */
export interface Change {
  definition: string;
  written: Written;
  by: Account;
  from: Origin;
  at: string;
}

/** What reading `terms.json` gave: the store, or why it can't be used. */
export type StoreRead = { ok: true; store: Store } | { ok: false; problem: StoreProblem };

/**
 * Why the store can't be used. Past one of its limits: `too-large`, `too-many` and `too-long`.
 * Unread: `encoding`, `syntax`, `format`, `format-newer` and `unreadable`. Not what it may hold:
 * `shape`, `key`, `key-twice` and `name-twice`.
 */
export type StoreProblemCode =
  | 'unreadable'
  | 'too-large'
  | 'too-many'
  | 'too-long'
  | 'encoding'
  | 'syntax'
  | 'format'
  | 'format-newer'
  | 'shape'
  | 'key'
  | 'key-twice'
  | 'name-twice';

export interface StoreProblem {
  code: StoreProblemCode;
  /** Where in `terms.json`, such as `terms["bucket"].changes[2].at`, when it's one value. */
  at?: string;
  /** One or two sentences, saying what's wrong. */
  message: string;
}

/**
 * `source`, the bytes or text of `terms.json`, read as the store. Pure and synchronous, and never
 * throws: what can't be read is a problem.
 */
export function parseStore(source: Uint8Array | string): StoreRead {
  try {
    return { ok: true, store: read(source) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, problem: error.problem };
    // Nothing above throws on any input but a refusal, so this is a backstop.
    return {
      ok: false,
      problem: {
        code: 'unreadable',
        message: "Lo couldn't read terms.json, for a reason it can't name.",
      },
    };
  }
}

/** Why the store is refused, thrown from where it's found to {@link parseStore}. */
class Refusal extends Error {
  readonly problem: StoreProblem;

  constructor(problem: StoreProblem) {
    super(problem.message);
    this.problem = problem;
  }
}

function refuse(code: StoreProblemCode, at: string | undefined, message: string): never {
  throw new Refusal(at === undefined ? { code, message } : { code, at, message });
}

function read(source: Uint8Array | string): Store {
  const text = textOf(source);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    // The engine's message says where, and may quote the text, so only where is kept.
    const where = /line (\d+) column (\d+)/.exec(error instanceof Error ? error.message : '');
    refuse(
      'syntax',
      undefined,
      where
        ? `terms.json isn't JSON, from line ${where[1]}, column ${where[2]}.`
        : "terms.json isn't JSON.",
    );
  }
  const root = object(value, undefined, 'terms.json');
  if (!Object.hasOwn(root, 'format')) {
    refuse('format', 'format', 'terms.json has no format. It holds "format": 1.');
  }
  const format = root['format'];
  if (typeof format !== 'number' || !Number.isSafeInteger(format) || format < 1) {
    refuse('format', 'format', 'The format is a whole number, such as "format": 1.');
  }
  if (format > STORE_FORMAT) {
    refuse(
      'format-newer',
      'format',
      `terms.json is in format ${format}, and this version of Lo reads format ${STORE_FORMAT}.`,
    );
  }
  // Past the format, which comes first: a newer one may be written otherwise.
  const repeated = keyedTwice(text);
  if (repeated) {
    refuse(
      'key-twice',
      undefined,
      `terms.json has the key ${JSON.stringify(quote(repeated.key))} twice in one object, the second time on line ${repeated.line}.`,
    );
  }
  only(root, ['format', 'terms'], undefined);
  const terms = object(field(root, 'terms', undefined), 'terms', 'terms');
  const keys = Object.keys(terms);
  if (keys.length > STORE_LIMITS.terms) {
    refuse(
      'too-many',
      'terms',
      `The store holds ${keys.length.toLocaleString('en-US')} terms, and holds at most ${STORE_LIMITS.terms.toLocaleString('en-US')}.`,
    );
  }

  const entries = new Map<string, StoreTerm>();
  const names = new Map<string, string>();
  for (const key of keys) {
    const at = `terms[${JSON.stringify(quote(key))}]`;
    const entry = termOf(terms[key], at);
    if (entry.key !== key) {
      refuse(
        'key',
        at,
        `${at} is keyed by its term in lower case: ${JSON.stringify(quote(entry.key))}.`,
      );
    }
    entries.set(key, entry);
    names.set(key, key);
  }
  // Every term is named before any alias, so an alias that names another term is found whichever
  // comes first.
  for (const [key, entry] of entries) {
    for (const [index, alias] of entry.aliases.entries()) {
      const name = termKey(alias);
      const owner = names.get(name);
      if (owner !== undefined) {
        const at = `terms[${JSON.stringify(quote(key))}].aliases[${index}]`;
        refuse('name-twice', at, `${at} ${twice(name, key, owner)}`);
      }
      names.set(name, key);
    }
  }
  return { format, terms: entries, names };
}

/** Why an alias whose key is `name`, of the term `key`, names what `owner` already goes by. */
function twice(name: string, key: string, owner: string): string {
  if (name === key) return 'is the term itself.';
  if (owner === key) return 'is one of its aliases already.';
  return `names ${JSON.stringify(quote(owner))}, another term.`;
}

/**
 * The first key `text`, which is JSON, has twice in one object, and the line of the second. JSON
 * keeps the last, so a store read and written back would lose the first. One pass, keeping the
 * keys of each object still open.
 */
function keyedTwice(text: string): { key: string; line: number } | undefined {
  // The keys of each object open, and undefined for each list.
  const open: (Set<string> | undefined)[] = [];
  let line = 1;
  let key = false;
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at);
    if (unit === 0x0a) line += 1;
    else if (unit === 0x7b) {
      open.push(new Set());
      key = true;
    } else if (unit === 0x5b) {
      open.push(undefined);
      key = false;
    } else if (unit === 0x7d || unit === 0x5d) {
      open.pop();
      key = false;
    } else if (unit === 0x2c) key = open.at(-1) !== undefined;
    else if (unit === 0x22) {
      const start = at;
      let escaped = false;
      for (at += 1; at < text.length && text.charCodeAt(at) !== 0x22; at++) {
        if (text.charCodeAt(at) === 0x5c) {
          escaped = true;
          at += 1;
        }
      }
      const keys = open.at(-1);
      if (key && keys) {
        // A key may be written with escapes, as "\u0061" is "a".
        const unquoted: unknown = escaped
          ? JSON.parse(text.slice(start, at + 1))
          : text.slice(start + 1, at);
        const name = typeof unquoted === 'string' ? unquoted : '';
        if (keys.has(name)) return { key: name, line };
        keys.add(name);
        key = false;
      }
    }
  }
  return undefined;
}

/** `source` as text, once it's no larger than the store may be and is UTF-8. */
function textOf(source: Uint8Array | string): string {
  if (typeof source === 'string') {
    const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
    if (utf8Length(text, STORE_LIMITS.size + 1) > STORE_LIMITS.size) tooLarge();
    if (!text.isWellFormed()) refuse('encoding', undefined, "terms.json isn't UTF-8.");
    return text;
  }
  const bom = source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf ? 3 : 0;
  const body = source.subarray(bom);
  if (body.length > STORE_LIMITS.size) tooLarge();
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return refuse('encoding', undefined, "terms.json isn't UTF-8.");
  }
}

function tooLarge(): never {
  refuse(
    'too-large',
    undefined,
    `terms.json is larger than ${STORE_LIMITS.size / 1024 / 1024} MiB, the most the store may be.`,
  );
}

/** The term at `at`, from its entry, `value`. */
function termOf(value: unknown, at: string): StoreTerm {
  const entry = object(value, at, at);
  only(
    entry,
    [
      'term',
      'definition',
      'aliases',
      'written',
      'by',
      'from',
      'at',
      'locked',
      'suggestions',
      'changes',
    ],
    at,
  );
  const term = termText(field(entry, 'term', at), `${at}.term`);
  const aliases = list(entry, 'aliases', at, STORE_LIMITS.aliases, termText);
  const locked = Object.hasOwn(entry, 'locked') ? lock(entry['locked'], `${at}.locked`) : undefined;
  // Unlocking a term takes its suggestions too: they wait only while it's locked.
  if (!locked && Object.hasOwn(entry, 'suggestions')) {
    refuse(
      'shape',
      `${at}.suggestions`,
      `${at} has suggestions, and isn't locked. Only a locked term holds suggestions.`,
    );
  }
  return {
    key: termKey(term),
    term,
    definition: definition(field(entry, 'definition', at), `${at}.definition`),
    aliases,
    written: written(field(entry, 'written', at), `${at}.written`),
    by: account(field(entry, 'by', at), `${at}.by`),
    from: origin(field(entry, 'from', at), `${at}.from`),
    at: time(field(entry, 'at', at), `${at}.at`),
    ...(locked ? { locked } : {}),
    suggestions: list(entry, 'suggestions', at, STORE_LIMITS.suggestions, suggestion),
    changes: list(entry, 'changes', at, STORE_LIMITS.changes, change),
  };
}

function lock(value: unknown, at: string): Lock {
  const locked = object(value, at, at);
  only(locked, ['by', 'at'], at);
  return {
    by: account(field(locked, 'by', at), `${at}.by`),
    at: time(field(locked, 'at', at), `${at}.at`),
  };
}

function suggestion(value: unknown, at: string): Suggestion {
  const each = object(value, at, at);
  only(each, ['definition', 'by', 'from', 'at'], at);
  return {
    definition: definition(field(each, 'definition', at), `${at}.definition`),
    by: account(field(each, 'by', at), `${at}.by`),
    from: pull(field(each, 'from', at), `${at}.from`),
    at: time(field(each, 'at', at), `${at}.at`),
  };
}

function change(value: unknown, at: string): Change {
  const each = object(value, at, at);
  only(each, ['definition', 'written', 'by', 'from', 'at'], at);
  return {
    definition: definition(field(each, 'definition', at), `${at}.definition`),
    written: written(field(each, 'written', at), `${at}.written`),
    by: account(field(each, 'by', at), `${at}.by`),
    from: origin(field(each, 'from', at), `${at}.from`),
    at: time(field(each, 'at', at), `${at}.at`),
  };
}

// Values.

type Fields = { readonly [key: string]: unknown };

/** `value` as an object, which `what` names in a message. */
function object(value: unknown, at: string | undefined, what: string): Fields {
  if (isFields(value)) return value;
  return refuse('shape', at, `${what} is an object, inside { and }.`);
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refuses a field of `record`, at `at`, that isn't one of `fields`. */
function only(record: Fields, fields: readonly string[], at: string | undefined): void {
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) {
      const where = `${at === undefined ? '' : `${at}.`}${quote(key)}`;
      refuse('shape', where, `${where} isn't a field the store has.`);
    }
  }
}

/** `record`'s field `key`, which it must have. */
function field(record: Fields, key: string, at: string | undefined): unknown {
  const where = at === undefined ? key : `${at}.${key}`;
  if (!Object.hasOwn(record, key)) refuse('shape', where, `${where} is missing.`);
  return record[key];
}

/**
 * `record`'s field `key`, a list of at most `most`, each read with `each`: empty when it's left
 * out.
 */
function list<T>(
  record: Fields,
  key: string,
  at: string,
  most: number,
  each: (value: unknown, at: string) => T,
): T[] {
  if (!Object.hasOwn(record, key)) return [];
  const where = `${at}.${key}`;
  const value = record[key];
  if (!Array.isArray(value)) refuse('shape', where, `${where} is a list, inside [ and ].`);
  if (value.length > most) {
    refuse('too-many', where, `${where} holds ${value.length}, and holds at most ${most}.`);
  }
  return value.map((item, index) => each(item, `${where}[${index}]`));
}

/** A term or an alias: as an overview's glossary may name a term. */
function termText(value: unknown, at: string): string {
  if (typeof value !== 'string') refuse('shape', at, `${at} is a term, as a string.`);
  if (utf8Length(value, LIMITS.argument + 1) > LIMITS.argument) {
    refuse(
      'too-long',
      at,
      `${at} is longer than ${LIMITS.argument.toLocaleString('en-US')} bytes, the most a term may be.`,
    );
  }
  if (termKey(value) === '') refuse('shape', at, `${at} is empty.`);
  if (!isPlainTerm(value) || !readTerm(value).ok) {
    refuse(
      'shape',
      at,
      `${at} is plain text, with no line break, tab, invisible or control character, and no space at either end.`,
    );
  }
  return value;
}

/**
 * A definition: on one line, so with no control character, and holding no invisible one, within
 * its limit, and read as Markdown, only text, inline code, and links to code and terms.
 */
function definition(value: unknown, at: string): string {
  if (typeof value !== 'string') refuse('shape', at, `${at} is a definition, as a string.`);
  if (value.trim() === '') refuse('shape', at, `${at} is empty.`);
  if (utf8Length(value, STORE_LIMITS.definition + 1) > STORE_LIMITS.definition) {
    refuse(
      'too-long',
      at,
      `${at} is longer than ${STORE_LIMITS.definition.toLocaleString('en-US')} bytes, the most a definition may be.`,
    );
  }
  if (UNSAFE.test(value)) {
    refuse('shape', at, `${at} holds a line break, or an invisible or control character.`);
  }
  const not = notDefinitionText(value);
  if (not?.why !== undefined) refuse('shape', at, `${at} holds ${not.what}. ${not.why}`);
  if (not !== undefined) {
    refuse(
      'shape',
      at,
      `${at} holds ${not.what}. A definition holds only text, inline code, and links to code and terms.`,
    );
  }
  return value;
}

function written(value: unknown, at: string): Written {
  if (value === 'agent' || value === 'human') return value;
  return refuse('shape', at, `${at} is "agent" or "human".`);
}

/**
 * A GitHub login: letters, digits and hyphens, not starting with a hyphen, at most 39 in all, and
 * `[bot]` after an app's.
 */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/;

function account(value: unknown, at: string): Account {
  const record = object(value, at, at);
  const keys = Object.keys(record);
  const kind = keys.length === 1 ? keys[0] : undefined;
  if (kind === 'login') {
    const login = record['login'];
    if (typeof login === 'string' && LOGIN.test(login)) return { login };
    refuse('shape', `${at}.login`, `${at}.login is a GitHub account's login, such as "octocat".`);
  }
  if (kind === 'name') {
    const given = record['name'];
    const where = `${at}.name`;
    if (typeof given !== 'string' || given.trim() === '' || UNSAFE.test(given)) {
      refuse('shape', where, `${where} is a git name, with no invisible or control character.`);
    }
    if (utf8Length(given, STORE_LIMITS.name + 1) > STORE_LIMITS.name) {
      refuse(
        'too-long',
        where,
        `${where} is longer than ${STORE_LIMITS.name} bytes, the most a name may be.`,
      );
    }
    return { name: given };
  }
  return refuse(
    'shape',
    at,
    `${at} holds one field: "login", a GitHub account's, or "name", a git name GitHub couldn't map to one.`,
  );
}

/** The largest number GitHub gives a pull request. */
const MAX_PR = 2 ** 31 - 1;

/** `lo`, or `#` and a pull request's number. */
function origin(value: unknown, at: string): Origin {
  if (value === 'lo') return 'lo';
  const number = pullOf(value);
  if (number !== undefined) return number;
  return refuse('shape', at, `${at} is "#" and a pull request's number, such as "#4797", or "lo".`);
}

/** `#` and a pull request's number. */
function pull(value: unknown, at: string): number {
  const number = pullOf(value);
  if (number !== undefined) return number;
  return refuse('shape', at, `${at} is "#" and a pull request's number, such as "#4797".`);
}

function pullOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^#[1-9][0-9]{0,9}$/.test(value)) return undefined;
  const number = Number(value.slice(1));
  return number <= MAX_PR ? number : undefined;
}

const TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?Z$/;

/** The days in each month of a year that isn't a leap year. */
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** An RFC 3339 time in UTC, to the second or finer: `2026-11-27T10:30:00Z`. */
function time(value: unknown, at: string): string {
  if (typeof value === 'string' && isTime(value)) return value;
  return refuse('shape', at, `${at} is a time in UTC, such as "2026-11-27T10:30:00Z".`);
}

/** Whether `text` is a time {@link TIME} matches, on a day its month has. */
function isTime(text: string): boolean {
  const match = TIME.exec(text);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS[month - 1];
  return (
    days !== undefined && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59
  );
}

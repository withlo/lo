import { describe, expect, test } from 'vitest';

import { LIMITS, parseStore, STORE_LIMITS, type StoreRead } from './index.ts';

const AT = '2026-11-27T10:30:00Z';

/** A term's entry with what it must hold, and `more`. */
function entry(term: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    term,
    definition: `The ${term}.`,
    written: 'agent',
    by: { login: 'octocat' },
    from: '#4797',
    at: AT,
    ...more,
  };
}

/** `terms.json` holding `terms`, keyed by each term's key. */
function store(terms: Record<string, unknown>, root: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 1, terms, ...root });
}

/** The problem reading `text` found, as `code@where`. */
function problem(text: string | Uint8Array): string {
  const read = parseStore(text);
  if (read.ok) return 'read';
  const { code, at } = read.problem;
  return at === undefined ? code : `${code}@${at}`;
}

function termsOf(read: StoreRead) {
  if (!read.ok) throw new Error(read.problem.message);
  return read.store.terms;
}

describe('the store', () => {
  test('reads each term by its key, with what it leaves out as none', () => {
    const read = parseStore(store({ bucket: entry('Bucket') }));
    expect(read).toEqual({
      ok: true,
      store: {
        format: 1,
        terms: new Map([
          [
            'bucket',
            {
              key: 'bucket',
              term: 'Bucket',
              definition: 'The Bucket.',
              aliases: [],
              written: 'agent',
              by: { login: 'octocat' },
              from: 4797,
              at: AT,
              suggestions: [],
              changes: [],
            },
          ],
        ]),
        names: new Map([['bucket', 'bucket']]),
      },
    });
  });

  test('reads aliases, a lock, suggestions and changes', () => {
    const read = parseStore(
      store({
        'token bucket': entry('Token  bucket', {
          aliases: ['buckets', 'Token Buckets'],
          written: 'human',
          by: { login: 'mona-lisa' },
          from: 'lo',
          at: '2026-11-27T10:30:00.123Z',
          locked: { by: { login: 'mona-lisa' }, at: AT },
          suggestions: [
            { definition: 'A pool.', by: { login: 'dependabot[bot]' }, from: '#12', at: AT },
          ],
          changes: [
            {
              definition: 'Tokens.',
              written: 'agent',
              by: { name: 'A. Writer' },
              from: '#4797',
              at: '2024-02-29T23:59:59Z',
            },
          ],
        }),
        token: entry('token', { aliases: [] }),
      }),
    );
    const bucket = termsOf(read).get('token bucket');
    expect(bucket).toMatchObject({
      term: 'Token  bucket',
      aliases: ['buckets', 'Token Buckets'],
      written: 'human',
      from: 'lo',
      locked: { by: { login: 'mona-lisa' }, at: AT },
      suggestions: [{ definition: 'A pool.', by: { login: 'dependabot[bot]' }, from: 12, at: AT }],
      changes: [{ definition: 'Tokens.', by: { name: 'A. Writer' }, from: 4797 }],
    });
    expect(read.ok && [...read.store.names]).toEqual([
      ['token bucket', 'token bucket'],
      ['token', 'token'],
      ['buckets', 'token bucket'],
      ['token buckets', 'token bucket'],
    ]);
  });

  test('reads the same from bytes as from text, a byte-order mark aside', () => {
    const text = store({ bucket: entry('Bucket') });
    const bytes = new TextEncoder().encode(`\uFEFF${text}`);
    expect(parseStore(bytes)).toEqual(parseStore(text));
    expect(parseStore(`\uFEFF${text}`)).toEqual(parseStore(text));
    expect(problem(store({}))).toBe('read');
  });

  test('a term keyed other than by its key is refused', () => {
    expect(problem(store({ Bucket: entry('Bucket') }))).toBe('key@terms["Bucket"]');
    expect(problem(store({ 'hash  map': entry('Hash map') }))).toBe('key@terms["hash  map"]');
    expect(problem(store({ 'hash map': entry('Hash  map') }))).toBe('read');
  });

  test('a name two terms go by is refused, whichever comes first', () => {
    const named = (aliases: string[]) => entry('Bucket', { aliases });
    expect(problem(store({ bucket: named(['Bucket']) }))).toBe(
      'name-twice@terms["bucket"].aliases[0]',
    );
    expect(problem(store({ bucket: named(['buckets', 'BUCKETS']) }))).toBe(
      'name-twice@terms["bucket"].aliases[1]',
    );
    expect(problem(store({ bucket: named(['token']), token: entry('token') }))).toBe(
      'name-twice@terms["bucket"].aliases[0]',
    );
    expect(problem(store({ token: entry('token'), bucket: named(['token']) }))).toBe(
      'name-twice@terms["bucket"].aliases[0]',
    );
    const both = store({ bucket: named(['pool']), tank: entry('tank', { aliases: ['Pool'] }) });
    expect(problem(both)).toBe('name-twice@terms["tank"].aliases[0]');
    const read = parseStore(both);
    expect(!read.ok && read.problem.message).toBe(
      'terms["tank"].aliases[0] names "bucket", another term.',
    );
  });
});

describe('what the store refuses', () => {
  test('one past its size, before its text is read', () => {
    const past = new Uint8Array(STORE_LIMITS.size + 1).fill(0xff);
    expect(problem(past)).toBe('too-large');
    expect(problem('x'.repeat(STORE_LIMITS.size + 1))).toBe('too-large');
    // Counted in bytes of UTF-8, not characters.
    expect(problem('é'.repeat(STORE_LIMITS.size / 2 + 1))).toBe('too-large');
  });

  test('anything but UTF-8 JSON', () => {
    expect(problem(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]))).toBe('encoding');
    expect(problem('{"format": 1, "terms": {"\uD800": 1}}')).toBe('encoding');
    expect(problem('')).toBe('syntax');
    expect(problem('{"format": 1, "terms": {},}')).toBe('syntax');
    const read = parseStore('{\n  "format": 1,\n  "terms": {\n    x\n  }\n}');
    expect(!read.ok && read.problem.message).toMatch(/^terms\.json isn't JSON\b/);
  });

  test('a format it doesn’t read, or none', () => {
    expect(problem(JSON.stringify({ terms: {} }))).toBe('format@format');
    for (const format of ['"1"', '0', '1.5', '-1', '1e400', '9007199254740993', 'null']) {
      expect(problem(`{"format": ${format}, "terms": {}}`)).toBe('format@format');
    }
    // A newer format is all that's read: it may hold what this one can't.
    const newer = parseStore(JSON.stringify({ format: 2, terms: [], more: true }));
    expect(newer).toEqual({
      ok: false,
      problem: {
        code: 'format-newer',
        at: 'format',
        message: 'terms.json is in format 2, and this version of Lo reads format 1.',
      },
    });
  });

  test('what isn’t the store’s shape', () => {
    expect(problem('[]')).toBe('shape');
    expect(problem('1')).toBe('shape');
    expect(problem(store({}, { other: 1 }))).toBe('shape@other');
    expect(problem(JSON.stringify({ format: 1 }))).toBe('shape@terms');
    expect(problem(JSON.stringify({ format: 1, terms: [] }))).toBe('shape@terms');
    expect(problem(store({ bucket: 'The bucket.' }))).toBe('shape@terms["bucket"]');
    for (const field of ['term', 'definition', 'written', 'by', 'from', 'at']) {
      const missing = entry('bucket');
      delete missing[field];
      expect(problem(store({ bucket: missing }))).toBe(`shape@terms["bucket"].${field}`);
    }
    expect(problem(store({ bucket: entry('bucket', { note: 'x' }) }))).toBe(
      'shape@terms["bucket"].note',
    );
    expect(problem(store({ bucket: entry('bucket', { aliases: 'buckets' }) }))).toBe(
      'shape@terms["bucket"].aliases',
    );
    expect(problem(store({ bucket: entry('bucket', { locked: true }) }))).toBe(
      'shape@terms["bucket"].locked',
    );
    expect(problem(store({ bucket: entry('bucket', { locked: { by: { login: 'a' } } }) }))).toBe(
      'shape@terms["bucket"].locked.at',
    );
  });

  test.each([
    ['a definition that is empty', { definition: '  ' }, 'shape@terms["b"].definition'],
    ['a definition on two lines', { definition: 'One.\nTwo.' }, 'shape@terms["b"].definition'],
    ['a definition with a tab', { definition: 'One.\tTwo.' }, 'shape@terms["b"].definition'],
    [
      'a definition with a right-to-left override',
      { definition: 'A \u202Eb' },
      'shape@terms["b"].definition',
    ],
    ['a definition that isn’t text', { definition: ['A.'] }, 'shape@terms["b"].definition'],
    ['a term that is empty', { term: ' ' }, 'shape@terms["b"].term'],
    ['a term with a zero-width space', { term: 'b\u200B' }, 'shape@terms["b"].term'],
    ['an alias with a control character', { aliases: ['b\u001B'] }, 'shape@terms["b"].aliases[0]'],
    ['a writer other than an agent or a person', { written: 'bot' }, 'shape@terms["b"].written'],
    ['a login with a space', { by: { login: 'a b' } }, 'shape@terms["b"].by.login'],
    ['a login starting with -', { by: { login: '-a' } }, 'shape@terms["b"].by.login'],
    ['a login of 40', { by: { login: 'a'.repeat(40) } }, 'shape@terms["b"].by.login'],
    ['only a bot’s suffix', { by: { login: '[bot]' } }, 'shape@terms["b"].by.login'],
    ['a login and a name', { by: { login: 'a', name: 'A' } }, 'shape@terms["b"].by'],
    ['neither', { by: {} }, 'shape@terms["b"].by'],
    ['an empty name', { by: { name: '' } }, 'shape@terms["b"].by.name'],
    ['a name with a newline', { by: { name: 'A\nB' } }, 'shape@terms["b"].by.name'],
    ['a number for where', { from: 4797 }, 'shape@terms["b"].from'],
    ['no #', { from: '4797' }, 'shape@terms["b"].from'],
    ['a leading zero', { from: '#04797' }, 'shape@terms["b"].from'],
    ['pull request 0', { from: '#0' }, 'shape@terms["b"].from'],
    ['more than GitHub gives', { from: '#2147483648' }, 'shape@terms["b"].from'],
    ['Lo in capitals', { from: 'Lo' }, 'shape@terms["b"].from'],
    ['a date alone', { at: '2026-11-27' }, 'shape@terms["b"].at'],
    ['an offset', { at: '2026-11-27T10:30:00+01:00' }, 'shape@terms["b"].at'],
    ['a day the month lacks', { at: '2026-02-29T10:30:00Z' }, 'shape@terms["b"].at'],
    ['hour 24', { at: '2026-11-27T24:00:00Z' }, 'shape@terms["b"].at'],
    ['a leap second', { at: '2026-12-31T23:59:60Z' }, 'shape@terms["b"].at'],
    ['month 13', { at: '2026-13-01T00:00:00Z' }, 'shape@terms["b"].at'],
    ['a time as a number', { at: 1_764_239_400 }, 'shape@terms["b"].at'],
    [
      'a suggestion from Lo',
      {
        locked: { by: { login: 'a' }, at: AT },
        suggestions: [{ definition: 'A.', by: { login: 'a' }, from: 'lo', at: AT }],
      },
      'shape@terms["b"].suggestions[0].from',
    ],
    [
      'suggestions for a term that isn’t locked',
      { suggestions: [{ definition: 'A.', by: { login: 'a' }, from: '#1', at: AT }] },
      'shape@terms["b"].suggestions',
    ],
    ['a term with a line break', { term: 'b\nc' }, 'shape@terms["b"].term'],
    ['a term with a tab', { term: 'b\tc' }, 'shape@terms["b"].term'],
    ['a term with a carriage return', { term: 'b\rc' }, 'shape@terms["b"].term'],
    ['a term with a space at its end', { term: 'b ' }, 'shape@terms["b"].term'],
    ['a term with a space at its start', { term: '\u00A0b' }, 'shape@terms["b"].term'],
    ['an alias with a space at its end', { aliases: ['bs '] }, 'shape@terms["b"].aliases[0]'],
    ['an alias with a form feed', { aliases: ['b\fs'] }, 'shape@terms["b"].aliases[0]'],
    ['a definition in bold', { definition: 'A **b**.' }, 'shape@terms["b"].definition'],
    ['a definition with emphasis', { definition: 'A _b_.' }, 'shape@terms["b"].definition'],
    ['a definition struck through', { definition: 'A ~b~.' }, 'shape@terms["b"].definition'],
    ['an image', { definition: 'A ![b](figures/b.png).' }, 'shape@terms["b"].definition'],
    ['HTML', { definition: 'A <img src="b.png">.' }, 'shape@terms["b"].definition'],
    ['a web link', { definition: 'A [b](https://b.test).' }, 'shape@terms["b"].definition'],
    [
      'a javascript: link',
      { definition: 'A [b](javascript:alert(1)).' },
      'shape@terms["b"].definition',
    ],
    ['an autolink', { definition: 'A <https://b.test>.' }, 'shape@terms["b"].definition'],
    ['a www. address', { definition: 'At www.example.com.' }, 'shape@terms["b"].definition'],
    [
      'a link to code written wrongly',
      { definition: 'A [b](code:/b.ts).' },
      'shape@terms["b"].definition',
    ],
    ['a link to a section', { definition: 'A [b](#b).' }, 'shape@terms["b"].definition'],
    [
      'a change missing who wrote it',
      { changes: [{ definition: 'A.', by: { login: 'a' }, from: 'lo', at: AT }] },
      'shape@terms["b"].changes[0].written',
    ],
  ])('%s', (_what, more, found) => {
    expect(problem(store({ b: entry('b', more) }))).toBe(found);
  });

  test('a year that is a leap year has its 29th of February', () => {
    expect(problem(store({ b: entry('b', { at: '2000-02-29T00:00:00Z' }) }))).toBe('read');
    expect(problem(store({ b: entry('b', { at: '1900-02-29T00:00:00Z' }) }))).toBe(
      'shape@terms["b"].at',
    );
  });

  test('more terms, aliases, suggestions or changes than it holds', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= STORE_LIMITS.terms; i++) many[`t${i}`] = entry(`t${i}`);
    expect(problem(store(many))).toBe('too-many@terms');
    delete many['t0'];
    expect(problem(store(many))).toBe('read');

    const aliases = Array.from({ length: STORE_LIMITS.aliases + 1 }, (_, i) => `b${i}`);
    expect(problem(store({ b: entry('b', { aliases }) }))).toBe('too-many@terms["b"].aliases');
    expect(problem(store({ b: entry('b', { aliases: aliases.slice(1) }) }))).toBe('read');

    const change = { definition: 'A.', written: 'agent', by: { login: 'a' }, from: '#1', at: AT };
    const changes = Array.from({ length: STORE_LIMITS.changes + 1 }, () => change);
    expect(problem(store({ b: entry('b', { changes }) }))).toBe('too-many@terms["b"].changes');
    expect(problem(store({ b: entry('b', { changes: changes.slice(1) }) }))).toBe('read');

    const suggestion = { definition: 'A.', by: { login: 'a' }, from: '#1', at: AT };
    const suggestions = Array.from({ length: STORE_LIMITS.suggestions + 1 }, () => suggestion);
    const locked = { by: { login: 'a' }, at: AT };
    expect(problem(store({ b: entry('b', { locked, suggestions }) }))).toBe(
      'too-many@terms["b"].suggestions',
    );
    expect(problem(store({ b: entry('b', { locked, suggestions: suggestions.slice(1) }) }))).toBe(
      'read',
    );
  });

  test('a definition, a term or a name past its length', () => {
    const at = (definition: string) => problem(store({ b: entry('b', { definition }) }));
    expect(at('é'.repeat(STORE_LIMITS.definition / 2))).toBe('read');
    expect(at(`${'é'.repeat(STORE_LIMITS.definition / 2)}.`)).toBe(
      'too-long@terms["b"].definition',
    );
    const long = 'b'.repeat(LIMITS.argument + 1);
    expect(problem(store({ [long]: entry(long) }))).toMatch(/^too-long@terms\["b+…"\]\.term$/);
    const name = { name: 'n'.repeat(STORE_LIMITS.name + 1) };
    expect(problem(store({ b: entry('b', { by: name }) }))).toBe('too-long@terms["b"].by.name');
  });

  test('a definition holds text, inline code, and links to code and terms, as Markdown reads it', () => {
    const at = (definition: string) => problem(store({ b: entry('b', { definition }) }));
    expect(
      at(
        'Tokens per_request, in `take()` at [the limiter](code:src/a.ts#L1-L2), for [buckets](term:bucket), when a < b, in ~5 ms, \\*not bold\\*.',
      ),
    ).toBe('read');
    // Each definition the store holds, its earlier ones and suggestions too.
    const change = {
      definition: 'A *b*.',
      written: 'agent',
      by: { login: 'a' },
      from: '#1',
      at: AT,
    };
    expect(problem(store({ b: entry('b', { changes: [change] }) }))).toBe(
      'shape@terms["b"].changes[0].definition',
    );
    const read = parseStore(store({ b: entry('b', { definition: 'A **b**.' }) }));
    expect(!read.ok && read.problem.message).toBe(
      'terms["b"].definition holds bold text. A definition holds only text, inline code, and links to code and terms.',
    );
    const wrong = parseStore(store({ b: entry('b', { definition: 'A [b](code:/b.ts).' }) }));
    expect(!wrong.ok && wrong.problem.message).toMatch(
      /^terms\["b"\]\.definition holds a link whose address is wrong\. ./,
    );
  });

  test('a key twice in one object, as JSON would keep only the last', () => {
    const one = JSON.stringify(entry('b'));
    expect(problem('{"format": 1, "format": 1, "terms": {}}')).toBe('key-twice');
    expect(problem(`{"format": 1, "terms": {"b": ${one}, "b": ${one}}}`)).toBe('key-twice');
    // However the key is written.
    expect(problem(`{"format": 1, "terms": {"b": ${one}, "\\u0062": ${one}}}`)).toBe('key-twice');
    const twice = parseStore(`{\n"format": 1,\n"terms": {\n"b": ${one},\n"b": ${one}}}`);
    expect(!twice.ok && twice.problem.message).toBe(
      'terms.json has the key "b" twice in one object, the second time on line 5.',
    );
    // Once in each of two objects, or as a value, it's once.
    const locked = { by: { login: 'a' }, at: AT };
    expect(problem(store({ b: entry('b', { locked, term: 'b' }), at: entry('at') }))).toBe('read');
    expect(
      problem(
        `{"format": 1, "terms": {"b": ${JSON.stringify(entry('b', { aliases: ['term', 'at'] }))}}}`,
      ),
    ).toBe('read');
  });
});

describe('hostile stores', () => {
  test('names an object has are terms like any other', () => {
    const read = parseStore(
      store({
        ['__proto__']: entry('__proto__', {
          definition: 'The `__proto__`.',
          aliases: ['constructor'],
        }),
        tostring: entry('toString', { aliases: ['hasOwnProperty'] }),
      }),
    );
    expect([...termsOf(read).keys()]).toEqual(['__proto__', 'tostring']);
    expect(read.ok && read.store.names.get('constructor')).toBe('__proto__');
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  test('a message never holds what moves or hides text, and quotes little of it', () => {
    const key = `b\u202E${'x'.repeat(200)}`;
    const read = parseStore(store({ [key]: entry('b') }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problem.code).toBe('key');
    expect(read.problem.message + (read.problem.at ?? '')).not.toMatch(
      /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u,
    );
    expect(read.problem.message.length).toBeLessThan(200);
  });

  test('deep or wide input is refused without walking it', () => {
    const size = STORE_LIMITS.size;
    const started = performance.now();
    const deep = `${'['.repeat(size / 2)}${']'.repeat(size / 2)}`;
    expect(problem(deep)).toBe('shape');
    const nested = store({ b: entry('b', { aliases: [JSON.parse('[[[[[[[[1]]]]]]]]')] }) });
    expect(problem(nested)).toBe('shape@terms["b"].aliases[0]');
    const flat = store({
      b: entry('b', { changes: Array.from({ length: (size - 1_000) / 2 }, () => 0) }),
    });
    expect(flat.length).toBeLessThan(size);
    expect(problem(flat)).toBe('too-many@terms["b"].changes');
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

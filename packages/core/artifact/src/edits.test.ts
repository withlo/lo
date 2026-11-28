import { describe, expect, test } from 'vitest';

import {
  emptyStore,
  fittedStoreText,
  parseStore,
  sameDefinition,
  STORE_LIMITS,
  storeText,
  withDefinition,
  withSuggestion,
  withTerm,
  type StoreDefinition,
  type Store,
} from './index.ts';
import { utf8Length } from './source.ts';

const AT = '2026-11-27T10:30:00Z';
const LATER = '2026-11-28T09:00:00Z';

/** A definition from pull request `from`, by octocat. */
function definition(text: string, from: number | 'lo' = 4797, at = AT): StoreDefinition {
  return { definition: text, written: 'agent', by: { login: 'octocat' }, from, at };
}

/** The store `text` reads as. Throws if it's refused. */
function read(text: string): Store {
  const got = parseStore(text);
  if (!got.ok) throw new Error(got.problem.message);
  return got.store;
}

/** A store of Bucket, with the alias "buckets", locked, with a suggestion and a change. */
const FULL = JSON.stringify({
  format: 1,
  terms: {
    bucket: {
      term: 'Bucket',
      definition: 'The tokens a tenant has to spend.',
      aliases: ['buckets'],
      written: 'human',
      by: { login: 'mona' },
      from: 'lo',
      at: LATER,
      locked: { by: { login: 'mona' }, at: LATER },
      suggestions: [
        { definition: 'A tenant’s tokens.', by: { name: 'A. Writer' }, from: '#12', at: LATER },
      ],
      changes: [
        {
          definition: 'The tokens a tenant has.',
          written: 'agent',
          by: { login: 'octocat' },
          from: '#4797',
          at: AT,
        },
      ],
    },
    token: {
      term: 'Token',
      definition: 'What a request spends.',
      written: 'agent',
      by: { login: 'octocat' },
      from: '#4797',
      at: AT,
    },
  },
});

/** The earlier definitions of Bucket in the store `text` reads as. */
function changesIn(text: string): string[] {
  return read(text)
    .terms.get('bucket')!
    .changes.map((change) => change.definition);
}

/** A long definition, ending in `n`. */
function long(n: number | string): string {
  return `${'Tokens a tenant spends. '.repeat(80)}${n}.`;
}

/** A store of `terms` terms, each with the most changes it keeps, of long definitions. */
function large(terms: number): Store {
  let store = emptyStore();
  for (let term = 0; term < terms; term++) {
    store = withTerm(store, `Term ${term}`, definition(long(0)));
    for (let n = 1; n <= STORE_LIMITS.changes; n++) {
      store = withDefinition(store, `term ${term}`, definition(long(n), n));
    }
  }
  return store;
}

describe('writing the store', () => {
  test('reads back as the store it was', () => {
    const store = read(FULL);
    expect(read(storeText(store))).toEqual(store);
  });

  test('writes each field in the format’s order, and leaves out empty lists', () => {
    const text = storeText(read(FULL));
    expect(Object.keys(JSON.parse(text).terms.bucket)).toEqual([
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
    ]);
    expect(Object.keys(JSON.parse(text).terms.token)).toEqual([
      'term',
      'definition',
      'written',
      'by',
      'from',
      'at',
    ]);
    expect(text.startsWith('{\n  "format": 1,\n  "terms": {\n')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  test('writes the same text for the same terms, whatever order they came in', () => {
    const one = withTerm(
      withTerm(emptyStore(), 'Token', definition('A.')),
      'Bucket',
      definition('B.'),
    );
    const two = withTerm(
      withTerm(emptyStore(), 'Bucket', definition('B.')),
      'Token',
      definition('A.'),
    );
    expect(storeText(one)).toBe(storeText(two));
    expect(Object.keys(JSON.parse(storeText(one)).terms)).toEqual(['bucket', 'token']);
  });

  test('keeps a term named as an object’s own names are', () => {
    const store = withTerm(
      withTerm(emptyStore(), '__proto__', definition('The `__proto__`.')),
      'constructor',
      definition('The `constructor`.'),
    );
    expect([...read(storeText(store)).terms.keys()]).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  test('keeps at most as many of each term’s changes as it’s asked to, the newest', () => {
    let store = withTerm(emptyStore(), 'Bucket', definition('One.'));
    store = withDefinition(store, 'bucket', definition('Two.', 2));
    store = withDefinition(store, 'bucket', definition('Three.', 3));
    expect(changesIn(storeText(store))).toEqual(['Two.', 'One.']);
    expect(changesIn(storeText(store, 1))).toEqual(['Two.']);
    expect(changesIn(storeText(store, 0))).toEqual([]);
  });
});

describe('changing the store', () => {
  test('adds a term by its key, with no aliases, suggestions or changes', () => {
    const store = withTerm(emptyStore(), 'Hash  Map', definition('A map.'));
    expect(store.terms.get('hash map')).toEqual({
      key: 'hash map',
      term: 'Hash  Map',
      ...definition('A map.'),
      aliases: [],
      suggestions: [],
      changes: [],
    });
    expect(store.names.get('hash map')).toBe('hash map');
  });

  test('refuses a term whose name another goes by, its own or an alias', () => {
    const store = read(FULL);
    expect(() => withTerm(store, 'BUCKET', definition('B.'))).toThrow('named "bucket"');
    expect(() => withTerm(store, 'Buckets', definition('B.'))).toThrow('named "buckets"');
  });

  test('leaves the store it changes as it was', () => {
    const store = read(FULL);
    const before = storeText(store);
    withTerm(store, 'Tenant', definition('T.'));
    withDefinition(store, 'token', definition('New.', 5));
    withSuggestion(store, 'bucket', { definition: 'S.', by: { login: 'x' }, from: 6, at: AT });
    expect(storeText(store)).toBe(before);
  });

  test('replaces a definition, and keeps the one it had first among its changes', () => {
    const store = withDefinition(read(FULL), 'bucket', {
      definition: 'What a tenant spends from.',
      written: 'agent',
      by: { name: 'A. Writer' },
      from: 31,
      at: LATER,
    });
    const bucket = store.terms.get('bucket')!;
    expect(bucket).toMatchObject({
      term: 'Bucket',
      aliases: ['buckets'],
      definition: 'What a tenant spends from.',
      written: 'agent',
      by: { name: 'A. Writer' },
      from: 31,
      at: LATER,
      locked: { by: { login: 'mona' }, at: LATER },
    });
    expect(bucket.changes.map(({ definition: text, from }) => [text, from])).toEqual([
      ['The tokens a tenant has to spend.', 'lo'],
      ['The tokens a tenant has.', 4797],
    ]);
  });

  test('keeps the newest changes and suggestions, as many as a term holds', () => {
    let store = withTerm(emptyStore(), 'Bucket', definition('0.', 1));
    for (let n = 1; n <= STORE_LIMITS.changes + 5; n++) {
      store = withDefinition(store, 'bucket', definition(`${n}.`, n + 1));
    }
    const { changes } = store.terms.get('bucket')!;
    expect(changes).toHaveLength(STORE_LIMITS.changes);
    expect(changes[0]!.definition).toBe(`${STORE_LIMITS.changes + 4}.`);

    let locked = read(FULL);
    for (let n = 1; n <= STORE_LIMITS.suggestions + 5; n++) {
      locked = withSuggestion(locked, 'bucket', {
        definition: `${n}.`,
        by: { login: 'octocat' },
        from: n,
        at: AT,
      });
    }
    const { suggestions } = locked.terms.get('bucket')!;
    expect(suggestions).toHaveLength(STORE_LIMITS.suggestions);
    expect(suggestions[0]!.from).toBe(STORE_LIMITS.suggestions + 5);
    expect(parseStore(storeText(locked)).ok).toBe(true);
  });

  test('suggests a change only to a locked term', () => {
    const suggestion = { definition: 'S.', by: { login: 'x' }, from: 6, at: AT };
    expect(() => withSuggestion(read(FULL), 'token', suggestion)).toThrow("isn't locked");
    expect(() => withSuggestion(read(FULL), 'tenant', suggestion)).toThrow('no term "tenant"');
    expect(() => withDefinition(read(FULL), 'tenant', definition('T.'))).toThrow(
      'no term "tenant"',
    );
  });
});

describe('fitting the store in its size', () => {
  test('writes every change while they fit', () => {
    const store = large(1);
    expect(fittedStoreText(store)).toBe(storeText(store));
  });

  test('keeps fewer of each term’s changes when every change would take it past its size', () => {
    const store = large(25);
    expect(utf8Length(storeText(store))).toBeGreaterThan(STORE_LIMITS.size);
    const text = fittedStoreText(store)!;
    expect(utf8Length(text)).toBeLessThanOrEqual(STORE_LIMITS.size);
    const kept = read(text).terms.get('term 0')!.changes;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(STORE_LIMITS.changes);
    expect(kept[0]!.from).toBe(STORE_LIMITS.changes - 1);
  });

  test('gives nothing when even no changes are too large', () => {
    let store = emptyStore();
    for (let term = 0; term < 1_200; term++) {
      store = withTerm(store, `Term ${term}`, definition(long(term)));
    }
    expect(fittedStoreText(store)).toBeUndefined();
  });
});

test('definitions are the same but for runs of spaces', () => {
  expect(sameDefinition('The  tokens\ta tenant has. ', 'The tokens a tenant has.')).toBe(true);
  expect(sameDefinition('The tokens.', 'The Tokens.')).toBe(false);
});

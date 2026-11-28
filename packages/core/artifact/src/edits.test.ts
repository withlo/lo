import { describe, expect, test } from 'vitest';

import {
  aliasesOf,
  editTerm,
  emptyStore,
  fittedStoreText,
  parseStore,
  sameDefinition,
  STORE_LIMITS,
  storeText,
  withDefinition,
  withSuggestion,
  withTerm,
  type EditBase,
  type EditResult,
  type StoreDefinition,
  type Store,
  type TermEdit,
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

/** The store `result` made: throws unless the edit was made. */
function edited(result: EditResult): Store {
  if (result.kind !== 'edited') throw new Error(`The edit came to ${result.kind}.`);
  return result.store;
}

describe('editing a term', () => {
  const by = { login: 'ravi-k' };
  /** An edit of Bucket, by ravi-k, at `LATER`. */
  function edit(text: string, aliases: readonly string[] = ['buckets']): TermEdit {
    return { term: 'Bucket', definition: text, aliases, by, at: LATER };
  }
  /** Bucket as FULL holds it, for an edit to start from. */
  const BASE: EditBase = { definition: 'The tokens a tenant has to spend.', aliases: ['buckets'] };

  test('saves the definition as human-written by the account, from Lo, and keeps the one it replaces first among its changes', () => {
    const store = edited(editTerm(read(FULL), 'bucket', BASE, edit('  What a tenant spends.  ')));
    const bucket = store.terms.get('bucket')!;
    expect(bucket).toMatchObject({
      term: 'Bucket',
      definition: 'What a tenant spends.',
      written: 'human',
      by,
      from: 'lo',
      at: LATER,
      // A lock stops merged pull requests, not an edit in Lo, and keeps its suggestions.
      locked: { by: { login: 'mona' }, at: LATER },
      suggestions: [{ definition: 'A tenant’s tokens.' }],
    });
    expect(bucket.changes.map((change) => change.definition)).toEqual([
      'The tokens a tenant has to spend.',
      'The tokens a tenant has.',
    ]);
    expect(read(storeText(store))).toEqual(store);
  });

  test('names the term by the forms the edit gives, and by no other', () => {
    const store = edited(
      editTerm(
        read(FULL),
        'bucket',
        BASE,
        edit('A tenant’s tokens.', [' token bucket ', '', 'BUCKET', 'Token  Bucket', 'pail']),
      ),
    );
    expect(store.terms.get('bucket')!.aliases).toEqual(['token bucket', 'pail']);
    expect(store.names.get('token bucket')).toBe('bucket');
    expect(store.names.get('pail')).toBe('bucket');
    expect(store.names.has('buckets')).toBe(false);
    expect(store.names.get('token')).toBe('token');
    expect(read(storeText(store)).names).toEqual(store.names);
  });

  test('changes nothing where the store holds the edit already, but for runs of spaces, however it came to', () => {
    expect(
      editTerm(read(FULL), 'bucket', BASE, edit('The tokens  a tenant has to spend.', ['Buckets'])),
    ).toEqual({ kind: 'same' });
    // Saved meanwhile, as this edit is, from another definition.
    const older: EditBase = { definition: 'The tokens a tenant has.', aliases: [] };
    expect(
      editTerm(read(FULL), 'bucket', older, edit('The tokens a tenant has to spend.')),
    ).toEqual({ kind: 'same' });
  });

  test('says what the term is now when it changed since the edit started', () => {
    const store = read(FULL);
    const bucket = store.terms.get('bucket');
    const older: EditBase = { definition: 'The tokens a tenant has.', aliases: ['buckets'] };
    expect(editTerm(store, 'bucket', older, edit('Mine.'))).toEqual({
      kind: 'changed',
      term: bucket,
    });
    const fewer: EditBase = { ...BASE, aliases: [] };
    expect(editTerm(store, 'bucket', fewer, edit('Mine.'))).toEqual({
      kind: 'changed',
      term: bucket,
    });
    // Whatever the order and case its forms are written in, the term is as it was.
    const same: EditBase = { ...BASE, aliases: ['BUCKETS', 'bucket'] };
    expect(editTerm(store, 'bucket', same, edit('Mine.')).kind).toBe('edited');
  });

  test('says a term deleted since the edit started is gone, and adds it back from a base of none', () => {
    const store = read(FULL);
    expect(editTerm(store, 'tenant', BASE, { ...edit('Mine.'), term: 'Tenant' })).toEqual({
      kind: 'changed',
      term: undefined,
    });
    const added = edited(
      editTerm(store, 'tenant', null, { ...edit('Who spends.', ['tenants']), term: 'Tenant' }),
    );
    expect(added.terms.get('tenant')).toMatchObject({
      term: 'Tenant',
      definition: 'Who spends.',
      aliases: ['tenants'],
      written: 'human',
      from: 'lo',
      changes: [],
    });
    expect(added.names.get('tenants')).toBe('tenant');
    // Back meanwhile, it's changed again.
    expect(editTerm(store, 'bucket', null, edit('Mine.')).kind).toBe('changed');
  });

  test('refuses a form another term goes by, too many forms, and a definition the store can’t hold', () => {
    const store = read(FULL);
    expect(editTerm(store, 'bucket', BASE, edit('Mine.', ['token']))).toEqual({
      kind: 'refused',
      message: '"token" names "token", another term.',
    });
    const many = Array.from({ length: STORE_LIMITS.aliases + 1 }, (_, n) => `pail ${n}`);
    expect(editTerm(store, 'bucket', BASE, edit('Mine.', many)).kind).toBe('refused');
    const bold = editTerm(store, 'bucket', BASE, edit('The **tokens**.'));
    expect(bold).toMatchObject({ kind: 'refused', message: expect.stringMatching(/\bbold\b/) });
    expect(editTerm(store, 'bucket', BASE, edit('   ')).kind).toBe('refused');
    // A term added back can't take a name another goes by.
    const named = editTerm(store, 'buckets', null, { ...edit('Mine.', []), term: 'Buckets' });
    expect(named).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/another term/),
    });
  });

  test('adds no term to a store that holds as many as it may', () => {
    let store = emptyStore();
    for (let term = 0; term < STORE_LIMITS.terms; term++) {
      store = withTerm(store, `Term ${term}`, definition('A term.'));
    }
    const result = editTerm(store, 'pail', null, { ...edit('Mine.', []), term: 'Pail' });
    expect(result).toMatchObject({ kind: 'refused', message: expect.stringMatching(/the most/) });
  });

  test('leaves the store it edits as it was', () => {
    const store = read(FULL);
    const before = storeText(store);
    editTerm(store, 'bucket', BASE, edit('Mine.', ['pail']));
    expect(storeText(store)).toBe(before);
    expect(store.names.has('pail')).toBe(false);
  });
});

test('an edit’s forms lose their spaces at either end, and those that are empty or name the term or one before', () => {
  expect(
    aliasesOf('Bucket', [' pail ', 'bucket', 'PAIL', '  ', 'token  bucket', 'Token Bucket']),
  ).toEqual(['pail', 'token  bucket']);
});

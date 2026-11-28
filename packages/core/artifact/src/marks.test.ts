import { describe, expect, test } from 'vitest';

import { overview, PREAMBLE_LINES } from '../test/support.ts';
import { answer, overviewFiles, repository, type Paths } from '../test/readers.ts';
import {
  checkArtifact,
  parseArtifact,
  parseStore,
  readStore,
  STORE_LIMITS,
  STORE_READ,
  type CheckedArtifact,
  type FileAnswer,
  type StoreRead,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;
const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';

/** A line linking each item's term, so none is unused. */
function links(items: readonly string[]): string {
  const terms = items.flatMap((item) => {
    const term = /^- (?:\*\*|__)(.*?)(?:\*\*|__)/.exec(item)?.[1];
    return term === undefined ? [] : [`[x](<term:${term.replaceAll('\\', '')}>)`];
  });
  return terms.join(' ');
}

/** A store holding `terms`, each a term and its definition, and the last with `aliases`. */
function store(terms: Record<string, string>, aliases: string[] = []): StoreRead {
  const entries = Object.entries(terms).map(([term, definition], index, all) => [
    term.toLowerCase(),
    {
      term,
      definition,
      ...(index === all.length - 1 && aliases.length > 0 ? { aliases } : {}),
      written: 'agent',
      by: { login: 'octocat' },
      from: '#4790',
      at: '2026-11-27T10:30:00Z',
    },
  ]);
  const read = parseStore(JSON.stringify({ format: 1, terms: Object.fromEntries(entries) }));
  if (!read.ok) throw new Error(read.problem.message);
  return read;
}

/** `items`, a glossary, checked against `stored`. */
async function check(stored: StoreRead | undefined, ...items: string[]): Promise<CheckedArtifact> {
  const text = overview(`${links(items)}\n\n## Glossary\n\n${items.join('\n')}\n`);
  const files = overviewFiles({ 'artifact.md': text });
  return checkArtifact(parseArtifact(text), files, repository(COMMIT, {}).readCode, {
    pr: 4797,
    ...(stored === undefined ? {} : { store: stored }),
  });
}

function codes(checked: CheckedArtifact): string[] {
  return checked.findings.map(({ code, line }) => (line === undefined ? code : `${code}@${line}`));
}

const STORED = store({ Bucket: 'The tokens a tenant has.', Tenant: 'Whoever pays.' }, ['tenants']);

describe('marks, against the repository’s definitions', () => {
  test('pass when each says how its term stands to them', async () => {
    const checked = await check(
      STORED,
      '- **Bucket**: The tokens a',
      '  tenant  has.',
      '- **Tenant** (changed): Whoever pays, and their keys.',
      '- **Token** (new): One request.',
    );
    expect(checked.findings).toEqual([]);
    expect(checked.outcome.kind).toBe('shown');
  });

  test('fail, leaving the overview shown, when one doesn’t', async () => {
    const checked = await check(
      STORED,
      '- **Bucket**: Tokens.',
      '- **Tenant** (changed): Whoever pays.',
      '- **Token**: One request.',
      '- **Tenants** (new): Those who pay.',
      '- **Map** (changed): A map.',
    );
    expect(codes(checked)).toEqual([
      `term-differs@${LINE + 4}`,
      `term-unchanged@${LINE + 5}`,
      `term-not-stored@${LINE + 6}`,
      `term-stored@${LINE + 7}`,
      `term-not-stored@${LINE + 8}`,
    ]);
    expect(checked.outcome.kind).toBe('shown');
    expect(checked.findings.map(({ message }) => message)).toEqual([
      '"Bucket"\'s definition isn\'t the one in the repository\'s definitions, which says "The tokens a tenant has.". Write that, or mark it (changed): **Bucket** (changed): definition.',
      '"Tenant" is marked (changed), and its definition is the repository\'s already. Take the mark off.',
      'The repository\'s definitions don\'t have "Token". Mark it (new): **Token** (new): definition.',
      '"Tenants" is marked (new), and the repository\'s definitions have it, as another name for "Tenant". Mark it (changed) to change its definition.',
      '"Map" is marked (changed), and the repository\'s definitions don\'t have it. Mark it (new).',
    ]);
  });

  test('a term marked new that they have with its definition is told to drop the mark', async () => {
    const checked = await check(STORED, '- **Bucket** (new): The tokens a tenant has.');
    expect(checked.findings[0]?.message).toBe(
      '"Bucket" is marked (new), and the repository\'s definitions have it, with this definition. Take the mark off.',
    );
  });

  test('a term not marked, whose definition is more than a paragraph, differs', async () => {
    const checked = await check(STORED, '- **Bucket**: The tokens a tenant has.', '', '  More.');
    expect(codes(checked)).toEqual([`term-differs@${LINE + 4}`]);
  });

  test('a marked term whose definition they can’t hold is refused, with or without them', async () => {
    for (const stored of [undefined, STORED]) {
      const checked = await check(stored, '- **Bucket** (changed): The *tokens*.');
      expect(codes(checked)).toEqual([`mark-definition@${LINE + 4}`]);
    }
  });

  test('aren’t checked without them', async () => {
    const checked = await check(undefined, '- **Bucket**: Tokens.', '- **Tenant** (changed): A.');
    expect(checked.findings).toEqual([]);
  });

  test('aren’t checked when they can’t be read, which is a warning', async () => {
    const unread = parseStore('{"format": 1, "terms": []}');
    const checked = await check(unread, '- **Bucket**: Tokens.');
    expect(codes(checked)).toEqual(['store-unread']);
    expect(checked.findings[0]?.severity).toBe('warning');
    expect(checked.findings[0]?.message).toBe(
      `The repository's definitions, at refs/lo/terms, can't be read, so the glossary's marks weren't checked. ${unread.ok ? '' : unread.problem.message}`,
    );
    expect(checked.outcome.kind).toBe('shown');
    // Without a glossary, nothing is checked, so nothing is said.
    const text = overview('');
    const quiet = await checkArtifact(
      parseArtifact(text),
      overviewFiles({ 'artifact.md': text }),
      repository(COMMIT, {}).readCode,
      { store: unread },
    );
    expect(quiet.findings).toEqual([]);
  });

  test('are checked on an invalid overview too', async () => {
    const checked = await check(STORED, '- **Token**: One request.', '- **Bad**:');
    expect(codes(checked)).toEqual([
      // The line before the glossary links the term the item would have defined.
      `term-undefined@${LINE}`,
      `term-not-stored@${LINE + 4}`,
      `glossary-item@${LINE + 5}`,
    ]);
    expect(checked.outcome.kind).toBe('invalid');
  });
});

describe('readStore', () => {
  const signal = new AbortController().signal;
  const STORE = '{"format": 1, "terms": {}}';

  /** The store in a commit holding `paths`. */
  function from(paths: Paths): Promise<StoreRead> {
    return readStore(async (path, cap) => answer(paths, path, cap), signal);
  }

  test('reads terms.json, a byte-order mark aside', async () => {
    expect(await from({ 'terms.json': STORE })).toMatchObject({ ok: true });
    const marked = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(STORE)]);
    expect(await from({ 'terms.json': marked })).toMatchObject({ ok: true });
  });

  test('refuses a commit without it as a file', async () => {
    expect(await from({})).toEqual({
      ok: false,
      problem: { code: 'commit', message: 'The commit at refs/lo/terms has no terms.json.' },
    });
    expect(await from({ 'terms.json': { kind: 'link', size: 4 } })).toEqual({
      ok: false,
      problem: {
        code: 'commit',
        message: "terms.json, at refs/lo/terms, is a link. It's a file.",
      },
    });
    const noCommit = await readStore(
      async (): Promise<FileAnswer> => ({ kind: 'noCommit' }),
      signal,
    );
    expect(noCommit).toMatchObject({ ok: false, problem: { code: 'commit' } });
  });

  test('refuses one past its size by the size alone', async () => {
    let asked = 0;
    const read = await readStore(async (_path, cap) => {
      asked = cap;
      return { kind: 'file', size: STORE_READ + 1, bytes: new Uint8Array(cap) };
    }, signal);
    expect(asked).toBe(STORE_READ);
    expect(read).toMatchObject({ ok: false, problem: { code: 'too-large' } });
    const most = `{"format": 1, "terms": {}}${' '.repeat(STORE_LIMITS.size - STORE.length)}`;
    expect(await from({ 'terms.json': most })).toMatchObject({ ok: true });
    expect(await from({ 'terms.json': `${most} ` })).toMatchObject({
      ok: false,
      problem: { code: 'too-large' },
    });
  });

  test('says it couldn’t read one whose reader fails, lies or is stopped', async () => {
    const failing = await readStore(() => Promise.reject(new Error('no')), signal);
    expect(failing).toEqual({
      ok: false,
      problem: { code: 'unreadable', message: "Lo couldn't read terms.json." },
    });
    // More bytes than the cap allows isn't an answer.
    const lying = await readStore(
      async () => ({ kind: 'file', size: 2, bytes: new Uint8Array(3) }),
      signal,
    );
    expect(lying).toMatchObject({ ok: false, problem: { code: 'unreadable' } });
    const stop = new AbortController();
    const waiting = readStore(() => new Promise(() => {}), stop.signal);
    stop.abort();
    expect(await waiting).toEqual({
      ok: false,
      problem: { code: 'unreadable', message: "terms.json wasn't read in time." },
    });
  });
});

// A tab's repository's definitions in the window: from what main says, each file read once in the
// background process for every tab that shows it, what read before staying while a newer file is
// read, and why they can't be used when they can't.

import { STORE_LIMITS } from '@lo/artifact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Problem, StoreState } from '../contract.ts';
import { readTerms } from '../background/index.ts';
import type { TermsRead } from '../jobs.ts';
import {
  failureOf,
  readTermsAgain,
  readTermsWith,
  storedTerm,
  takeStore,
  takeTerms,
  terms,
  type RepoTerms,
} from './terms.ts';

const REPO = { owner: 'rozed-dev', name: 'e2e' };
const FILE = '1'.repeat(40);
const NEWER = '2'.repeat(40);

function termsJson(...names: string[]): string {
  return JSON.stringify({
    format: 1,
    terms: Object.fromEntries(
      names.map((name) => [
        name.toLowerCase(),
        {
          term: name,
          definition: `The [${name}](term:${name.toLowerCase()}).`,
          aliases: [`${name.toLowerCase()}s`],
          written: 'agent',
          by: { login: 'rozed-bot' },
          from: '#80',
          at: '2026-11-27T10:30:00Z',
        },
      ]),
    ),
  });
}

function stateOf(found: StoreState['found'], more: Partial<StoreState> = {}): StoreState {
  return {
    id: 't1',
    repository: REPO,
    found,
    saved: false,
    checkedAt: 1,
    problem: null,
    ...more,
  };
}

const fileOf = (id: string, size = 10): StoreState['found'] => ({
  kind: 'file',
  commit: 'c'.repeat(40),
  id,
  size,
});

/** Files main hands over, by ID, read as the background process reads them, with each read. */
function standIn(files: Record<string, string>) {
  const asked: string[] = [];
  const parse = vi.fn<(bytes: Uint8Array) => Promise<TermsRead>>(async (bytes) => readTerms(bytes));
  const stop = readTermsWith({
    file: async ({ file }) => {
      asked.push(file);
      const text = files[file];
      if (text === undefined) throw new IpcError('moved', 'Not that file.');
      return new TextEncoder().encode(text);
    },
    read: parse,
  });
  return { asked, parse, stop };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let stop: (() => void) | undefined;

beforeEach(() => {
  takeTerms(true);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  takeTerms(false);
});

describe("a tab's repository's definitions", () => {
  it('are read from the file main read, once for every tab, and found by name or alias', async () => {
    const fake = standIn({ [FILE]: termsJson('Bucket', 'Tenant') });
    stop = fake.stop;
    takeStore(stateOf(fileOf(FILE)));
    expect(terms.get('t1')).toEqual({ kind: 'reading' });
    takeStore({ ...stateOf(fileOf(FILE)), id: 't2' });
    await settle();
    const one = terms.get('t1');
    expect(one).toMatchObject({ kind: 'read', repository: REPO, saved: false, checkedAt: 1 });
    if (one.kind !== 'read') throw new Error('Not read.');
    expect([...one.terms.terms.keys()]).toEqual(['bucket', 'tenant']);
    expect(storedTerm(one.terms, 'buckets')?.term).toBe('Bucket');
    expect(storedTerm(one.terms, 'quota')).toBeUndefined();
    expect(one.terms.terms.get('bucket')?.blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'The ' },
          {
            kind: 'link',
            target: { kind: 'term', key: 'bucket' },
            children: [{ kind: 'text', value: 'Bucket' }],
          },
          { kind: 'text', value: '.' },
        ],
      },
    ]);
    expect(terms.get('t2').kind).toBe('read');
    expect(fake.asked).toEqual([FILE]);
    expect(fake.parse).toHaveBeenCalledTimes(1);
  });

  it('keep what was read while a newer file is read', async () => {
    const fake = standIn({ [FILE]: termsJson('Bucket'), [NEWER]: termsJson('Bucket', 'Quota') });
    stop = fake.stop;
    takeStore(stateOf(fileOf(FILE)));
    await settle();
    const before = terms.get('t1');
    takeStore(stateOf(fileOf(NEWER)));
    expect(terms.get('t1')).toBe(before);
    await settle();
    const after = terms.get('t1');
    expect(after.kind === 'read' && after.terms.terms.size).toBe(2);
    // Another repository's are never shown meanwhile.
    takeStore(stateOf(fileOf('3'.repeat(40)), { repository: { owner: 'x', name: 'y' } }));
    expect(terms.get('t1')).toEqual({ kind: 'reading' });
  });

  it('say there are none, or why they can’t be used', async () => {
    stop = standIn({
      [FILE]: '{"format": 1, "terms": {"Bucket": {}}}',
      [NEWER]: JSON.stringify({ format: 1, terms: {} }).padEnd(STORE_LIMITS.size + 1, ' '),
    }).stop;
    const problem: Problem = {
      kind: 'offline',
      cause: { kind: 'offline' },
      message: '',
      retryAt: 1,
    };
    const cases: [StoreState, RepoTerms][] = [
      [stateOf({ kind: 'unknown' }), { kind: 'reading' }],
      [
        stateOf({ kind: 'unknown' }, { problem }),
        { kind: 'unreadable', repository: REPO, why: { kind: 'problem', problem } },
      ],
      [stateOf({ kind: 'none' }), { kind: 'none', repository: REPO, problem: null }],
      [
        stateOf({ kind: 'unreadable', object: FILE, why: 'tooLarge', size: 3_000_000 }),
        { kind: 'unreadable', repository: REPO, why: { kind: 'tooLarge' } },
      ],
      [
        stateOf({ kind: 'unreadable', object: FILE, why: 'notCommit', size: null }),
        { kind: 'unreadable', repository: REPO, why: { kind: 'notStore', why: 'notCommit' } },
      ],
    ];
    for (const [state, expected] of cases) {
      takeStore(state);
      expect(terms.get('t1')).toEqual(expected);
    }
    takeStore(stateOf(fileOf(FILE)));
    await settle();
    expect(terms.get('t1')).toMatchObject({
      kind: 'unreadable',
      why: { kind: 'invalid', problem: { code: 'shape' } },
    });
    takeStore(stateOf(fileOf(NEWER)));
    await settle();
    expect(terms.get('t1')).toMatchObject({ kind: 'unreadable', why: { kind: 'tooLarge' } });
  });

  it('name each limit the store is past, and every other problem as one it can’t read', () => {
    expect(failureOf({ code: 'too-many', message: '' })).toEqual({ kind: 'tooMany' });
    expect(failureOf({ code: 'too-large', message: '' })).toEqual({ kind: 'tooLarge' });
    expect(failureOf({ code: 'syntax', message: 'Not JSON.' })).toEqual({
      kind: 'invalid',
      problem: { code: 'syntax', message: 'Not JSON.' },
    });
  });

  it('are read again after the background process failed, and only then', async () => {
    const fake = standIn({ [FILE]: termsJson('Bucket') });
    stop = fake.stop;
    fake.parse.mockRejectedValueOnce(new IpcError('timeout', 'Too long.'));
    takeStore(stateOf(fileOf(FILE)));
    await settle();
    expect(terms.get('t1')).toMatchObject({
      kind: 'unreadable',
      why: { kind: 'failed', code: 'timeout' },
    });
    // Why they couldn't be read stays while they're read again, as does the note that says it.
    const failed = terms.get('t1');
    const again = readTermsAgain('t1');
    expect(terms.get('t1')).toBe(failed);
    await again;
    await settle();
    expect(terms.get('t1').kind).toBe('read');
    expect(fake.parse).toHaveBeenCalledTimes(2);
  });

  it('wait for main’s word when main has moved on to another file', async () => {
    const fake = standIn({});
    stop = fake.stop;
    takeStore(stateOf(fileOf(FILE)));
    await settle();
    // Said of the file as a failure until main says which it has now.
    expect(terms.get('t1')).toMatchObject({ kind: 'unreadable', why: { kind: 'failed' } });
  });

  it('are forgotten as overviews are turned off, and nothing is taken until they’re on', () => {
    takeStore(stateOf({ kind: 'none' }));
    takeTerms(false);
    expect(terms.get('t1')).toEqual({ kind: 'reading' });
    takeStore(stateOf({ kind: 'none' }));
    expect(terms.get('t1')).toEqual({ kind: 'reading' });
  });
});

import { describe, expect, it } from 'vitest';

import { Blobs, blobId, isBlob } from './blobs.ts';
import { database, idOf } from './test/support.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('blobId', () => {
  it('is the ID git gives the file', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobId(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(blobId(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    // `git hash-object --object-format=sha256`, in a repository that uses it.
    expect(blobId(bytes('hello\n'), 64)).toBe(
      '2cf8d83d9ee29543b34a87727421fdecb7e3f3a183d337639025de576db9ebb4',
    );
    expect(isBlob('ce013625030ba8dba906f756967f9e9ca394464a', bytes('hello\n'))).toBe(true);
    expect(isBlob('ce013625030ba8dba906f756967f9e9ca394464a', bytes('hello!'))).toBe(false);
    expect(isBlob('ce01', bytes('hello\n'))).toBe(false);
  });
});

describe('Blobs', () => {
  it('keeps a file only as the one its ID names', () => {
    const blobs = new Blobs(database());
    const id = idOf('figure');
    expect(blobs.put(id, bytes('another figure'))).toBe(false);
    expect(blobs.has(id)).toBe(false);
    expect(blobs.put(id, bytes('figure'))).toBe(true);
    expect(blobs.get(id)).toEqual(bytes('figure'));
  });

  it("forgets a kept file whose bytes aren't its ID's when it's read", () => {
    const db = database();
    const lines: string[] = [];
    const blobs = new Blobs(db, { log: (line) => lines.push(line) });
    const id = idOf('figure');
    blobs.put(id, bytes('figure'));
    // As if the database were changed outside Lo.
    db.prepare('UPDATE overview_blobs SET bytes = ? WHERE id = ?').run(bytes('figurE'), id);
    expect(blobs.get(id)).toBeUndefined();
    expect(blobs.has(id)).toBe(false);
    expect(lines).toEqual([`forgot a kept file whose bytes aren't ${id}'s`]);
  });

  it('forgets those used least recently past its cap, never the one just kept', () => {
    let now = 1_000;
    const blobs = new Blobs(database(), { cap: 10, now: () => now });
    const [a, b, c] = ['aaaa', 'bbbb', 'cccc'].map((text) => ({ id: idOf(text), text }));
    if (!a || !b || !c) throw new Error('unreachable');
    blobs.put(a.id, bytes(a.text));
    now += 1;
    blobs.put(b.id, bytes(b.text));
    now += 1;
    // Reading `a` makes `b` the least recently used.
    blobs.get(a.id);
    now += 1;
    blobs.put(c.id, bytes(c.text));
    expect([a, b, c].map(({ id }) => blobs.has(id))).toEqual([true, false, true]);
    expect(blobs.size()).toBe(8);

    // One larger than the cap is kept, and everything else goes.
    const large = 'x'.repeat(12);
    now += 1;
    blobs.put(idOf(large), bytes(large));
    expect(blobs.has(idOf(large))).toBe(true);
    expect([a, c].map(({ id }) => blobs.has(id))).toEqual([false, false]);
  });

  it('empties as the cache is cleared', () => {
    const blobs = new Blobs(database());
    blobs.put(idOf('one'), bytes('one'));
    blobs.clear();
    expect(blobs.size()).toBe(0);
    expect(blobs.get(idOf('one'))).toBeUndefined();
  });
});

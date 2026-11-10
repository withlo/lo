import { expect, test, vi } from 'vitest';

import { splitRecords, streamRecords } from './records.ts';

const text = (records: Buffer[]) => records.map((record) => record.toString('latin1'));

test('splits records at each NUL, keeping a last one without one', () => {
  expect(text(splitRecords(Buffer.from('a\0bc\0\0d')))).toEqual(['a', 'bc', '', 'd']);
  expect(text(splitRecords(Buffer.from('a\0')))).toEqual(['a']);
  expect(splitRecords(Buffer.alloc(0))).toEqual([]);
  expect(text(splitRecords(Buffer.from('a\nb\n'), 0x0a))).toEqual(['a', 'b']);
});

test('keeps bytes that aren’t UTF-8 as they are', () => {
  const name = Buffer.from([0x66, 0xff, 0xfe, 0x2e, 0x74]);
  const [record] = splitRecords(Buffer.concat([name, Buffer.from([0])]));
  expect(record).toEqual(name);
});

test('streams records across chunks cut anywhere', async () => {
  const whole = Buffer.from('first\0second record\0\0third');
  for (let size = 1; size <= whole.length; size++) {
    async function* chunks() {
      for (let at = 0; at < whole.length; at += size) yield whole.subarray(at, at + size);
    }
    const records: Buffer[] = [];
    for await (const record of streamRecords(chunks())) records.push(record);
    expect(text(records), `chunks of ${size}`).toEqual(['first', 'second record', '', 'third']);
  }
});

/** The bytes copied while streaming one record of `size` bytes, arriving in pipe-sized chunks. */
async function copiedFor(size: number): Promise<number> {
  const chunk = Buffer.alloc(64 * 1024, 'x');
  async function* chunks() {
    for (let at = 0; at < size; at += chunk.length) yield chunk;
    yield Buffer.from([0, 0x79]);
  }
  const concat = vi.spyOn(Buffer, 'concat');
  try {
    const lengths: number[] = [];
    for await (const record of streamRecords(chunks())) lengths.push(record.length);
    expect(lengths).toEqual([size, 1]);
    return concat.mock.calls.reduce(
      (copied, [list]) => copied + list.reduce((sum, piece) => sum + piece.length, 0),
      0,
    );
  } finally {
    concat.mockRestore();
  }
}

test('streams a record in work that grows with its length alone', async () => {
  const half = await copiedFor(32 * 1024 * 1024);
  const whole = await copiedFor(64 * 1024 * 1024);

  // Each byte is copied once, when its record ends: twice the record, twice the copying. The one
  // more is the last record's, `y`.
  expect([half, whole]).toEqual([32 * 1024 * 1024 + 1, 64 * 1024 * 1024 + 1]);
});

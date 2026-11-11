import { expect, test } from 'vitest';

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

test('streams a record of 64 MB in time that grows with its length alone', async () => {
  const size = 64 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024, 'x');
  async function* chunks() {
    for (let at = 0; at < size; at += chunk.length) yield chunk;
    yield Buffer.from([0, 0x79]);
  }
  const started = performance.now();

  const records: Buffer[] = [];
  for await (const record of streamRecords(chunks())) records.push(record);

  expect(performance.now() - started).toBeLessThan(500);
  expect(records.map((record) => record.length)).toEqual([size, 1]);
});

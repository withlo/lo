import { expect, test } from 'vitest';

import { FrameMeter, HEADER_LIMIT } from './framing.ts';

function message(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body)}\r\nContent-Type: application/json\r\n\r\n${body}`;
}

test('messages within the limit pass, however the stream splits them', () => {
  const stream = Buffer.from(message('{"a":"é"}') + message('') + message('{"b":2}'.repeat(50)));
  for (const size of [1, 3, 7, stream.length]) {
    const meter = new FrameMeter(1024);
    for (let at = 0; at < stream.length; at += size) {
      expect(meter.feed(stream.subarray(at, at + size))).toBeUndefined();
    }
  }
});

test('a message past the limit, or a header too long or without a length, is refused', () => {
  const meter = new FrameMeter(1024);
  expect(meter.feed(Buffer.from(message('{}')))).toBeUndefined();
  expect(meter.feed(Buffer.from('Content-Length: 1025\r\n\r\n'))).toMatch(/past the limit/);
  expect(new FrameMeter().feed(Buffer.from('x'.repeat(HEADER_LIMIT + 1)))).toMatch(/too long/);
  expect(new FrameMeter().feed(Buffer.from('Content-Type: x\r\n\r\n{}'))).toMatch(/length/);
});
